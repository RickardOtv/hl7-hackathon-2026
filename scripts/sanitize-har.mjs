#!/usr/bin/env node
// Sanitize a mitmproxy HAR by scrubbing PII before AI/code reads bodies.
// Targets: personnummer, names, emails, phone numbers, cookies, auth headers,
// bearer tokens, and well-known PII keys in JSON bodies.
//
// Usage:
//   node sanitize-har.mjs <input.har> <output.har>

import fs from "node:fs";
import path from "node:path";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("Usage: node sanitize-har.mjs <input.har> <output.har>");
  process.exit(1);
}

const stats = {
  personnummer: 0,
  emails: 0,
  phones: 0,
  bearer: 0,
  cookies: 0,
  authHeaders: 0,
  jsonPii: 0,
  uuids: 0,
  hsaIds: 0,
};

// --- Regex catalogue -------------------------------------------------------
// Personnummer (Swedish SSN): YYYYMMDD-XXXX, YYMMDD-XXXX, YYYYMMDDXXXX, YYMMDDXXXX
const RE_PERSONNUMMER = /\b(?:19|20)?\d{6}[-+]?\d{4}\b/g;
// Email
const RE_EMAIL = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
// Swedish phone (very permissive): +46..., 0046..., 07x-..., 08-...
const RE_PHONE = /(?:\+46|0046|0)\s?[1-9](?:[\s\-]?\d){6,9}\b/g;
// Bearer tokens / JWTs in any header value
const RE_BEARER = /Bearer\s+[A-Za-z0-9\-._~+\/=]{10,}/gi;
// JWT-looking tokens: aaa.bbb.ccc
const RE_JWT = /\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b/g;
// UUID v4-ish (used for session ids etc — keep but redact)
const RE_UUID = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
// Swedish HSA-ID (healthcare provider org id): SE + 10 digits + - + alphanumerics.
// Identifies which clinic/region/municipality the user is bound to, so treat as PII.
const RE_HSA_ID = /\bSE\d{10}-[A-Z0-9]+\b/g;

// JSON keys whose VALUE is treated as PII regardless of pattern
const PII_KEYS = new Set([
  "firstName", "lastName", "fullName", "name", "givenName", "familyName",
  "email", "emailAddress", "phone", "phoneNumber", "mobile", "mobilePhone",
  "personalNumber", "personnummer", "personalId", "personId", "ssn",
  "address", "streetAddress", "postalAddress", "city", "postalCode", "zip",
  "dateOfBirth", "birthDate",
  // 1177-specific keys
  "displayName", "userDisplayName", "userId", "patientId",
  "personName", "userName", "userFirstName", "userLastName",
  "fornamn", "efternamn", "namn", "epost", "telefon", "adress",
  // Inbox/messaging — reveal which clinics the user contacted and when.
  "facilityName", "threadTitle", "messageUrl", "messageText", "title",
  "facilityHsaId", "hsaId",
]);

// Identifying fragments (e.g. real name) — pass via env KNOWN_PII="Rickard,Ötvös,Otvos"
const KNOWN_PII_FRAGMENTS = (process.env.KNOWN_PII || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// --- Helpers ---------------------------------------------------------------
function redactString(s, keep = 0) {
  if (typeof s !== "string") return s;
  if (s.length <= keep) return "[REDACTED]";
  return "[REDACTED]";
}

function scrubText(s) {
  if (typeof s !== "string" || !s) return s;
  let out = s;
  out = out.replace(RE_JWT, (m) => { stats.bearer++; return "[REDACTED_JWT]"; });
  out = out.replace(RE_BEARER, (m) => { stats.bearer++; return "Bearer [REDACTED]"; });
  out = out.replace(RE_PERSONNUMMER, (m) => { stats.personnummer++; return "[REDACTED_PNR]"; });
  out = out.replace(RE_EMAIL, (m) => { stats.emails++; return "redacted@example.com"; });
  out = out.replace(RE_PHONE, (m) => { stats.phones++; return "[REDACTED_PHONE]"; });
  out = out.replace(RE_UUID, (m) => { stats.uuids++; return "00000000-0000-0000-0000-000000000000"; });
  out = out.replace(RE_HSA_ID, (m) => { stats.hsaIds++; return "SE0000000000-DEMO"; });
  for (const frag of KNOWN_PII_FRAGMENTS) {
    if (!frag) continue;
    const re = new RegExp(frag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    out = out.replace(re, () => { stats.jsonPii++; return "[REDACTED]"; });
  }
  return out;
}

function scrubJsonValue(value, keyHint) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => scrubJsonValue(v, keyHint));
  if (typeof value === "object") return scrubJsonObject(value);
  if (typeof value === "string") {
    if (keyHint && PII_KEYS.has(keyHint)) {
      stats.jsonPii++;
      return "[REDACTED]";
    }
    return scrubText(value);
  }
  return value;
}

function scrubJsonObject(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = scrubJsonValue(v, k);
  }
  return out;
}

function tryScrubJsonString(s) {
  if (typeof s !== "string" || !s.trim().startsWith("{") && !s.trim().startsWith("[")) {
    return scrubText(s);
  }
  try {
    const parsed = JSON.parse(s);
    const cleaned = scrubJsonValue(parsed, null);
    return JSON.stringify(cleaned, null, 2);
  } catch {
    return scrubText(s);
  }
}

function scrubHeaderArray(headers) {
  return headers.map((h) => {
    const name = (h.name || "").toLowerCase();
    if (name === "cookie" || name === "set-cookie") {
      stats.cookies++;
      return { ...h, value: "[REDACTED_COOKIE]" };
    }
    if (name === "authorization" || name === "x-auth-token" || name === "x-csrf-token") {
      stats.authHeaders++;
      return { ...h, value: "[REDACTED]" };
    }
    return { ...h, value: scrubText(h.value) };
  });
}

function scrubCookies(cookies) {
  return (cookies || []).map((c) => ({ ...c, value: "[REDACTED]" }));
}

function scrubQueryString(qs) {
  return (qs || []).map((q) => {
    const name = (q.name || "").toLowerCase();
    if (["token", "access_token", "id_token", "code", "state", "session"].includes(name)) {
      return { ...q, name: scrubText(q.name), value: "[REDACTED]" };
    }
    return { ...q, name: scrubText(q.name), value: scrubText(q.value) };
  });
}

function scrubPostParams(params) {
  return (params || []).map((p) => ({
    ...p,
    name: scrubText(p.name),
    value: scrubText(p.value),
  }));
}

// --- Main ------------------------------------------------------------------
const har = JSON.parse(fs.readFileSync(inPath, "utf8"));
for (const entry of har.log.entries) {
  const req = entry.request;
  const res = entry.response;

  if (req.url) req.url = scrubText(req.url);
  if (req.headers) req.headers = scrubHeaderArray(req.headers);
  if (req.cookies) req.cookies = scrubCookies(req.cookies);
  if (req.queryString) req.queryString = scrubQueryString(req.queryString);
  if (req.postData?.text) req.postData.text = tryScrubJsonString(req.postData.text);
  if (req.postData?.params) req.postData.params = scrubPostParams(req.postData.params);

  if (res.headers) res.headers = scrubHeaderArray(res.headers);
  if (res.cookies) res.cookies = scrubCookies(res.cookies);
  if (res.redirectURL) res.redirectURL = scrubText(res.redirectURL);
  if (res.content?.text) {
    res.content.text = tryScrubJsonString(res.content.text);
  }
}

fs.writeFileSync(outPath, JSON.stringify(har, null, 2));
console.log(`Wrote ${outPath}`);
console.log("Scrub counts:", stats);
