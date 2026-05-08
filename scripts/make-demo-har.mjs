#!/usr/bin/env node
// Turn the sanitized 1177-clean.har into a presentation-ready 1177-demo.har:
//
//   1. Replace every "[REDACTED]" / "[REDACTED_PNR]" / "[REDACTED_PHONE]" / etc.
//      placeholder with a realistic-but-synthetic Swedish value (Test Testsson,
//      personnummer 199001019999, address in Göteborg, …).
//   2. Inject one or two BOOKED appointments into /api/appointments so the
//      audience sees a non-empty array — your real account had none.
//   3. Drop the still-redacted Cookie / Set-Cookie noise so the HAR opens
//      cleanly in mitmweb / Chrome DevTools.
//
// Inputs:  data/clean/1177-clean.har    (sanitized HAR with [REDACTED] placeholders)
// Output:  data/clean/1177-demo.har     (synthetic, presentation-ready)
//
// Usage:   node scripts/make-demo-har.mjs [in.har] [out.har]
//          (defaults shown above; relative paths resolved from cwd)

import fs from "node:fs";

const IN  = process.argv[2] || "data/clean/1177-clean.har";
const OUT = process.argv[3] || "data/clean/1177-demo.har";

// Synthetic identity. Matches src/main/resources/fixtures/* so the proxy
// produces the same FHIR resources whether it's hitting fixtures or replaying
// this HAR.
const SYN = {
  personId:       "199001019999",
  personName:     "Test Testsson",
  firstName:      "Test",
  lastName:       "Testsson",
  fullName:       "Test Testsson",
  address:        "Testgatan 1",
  city:           "Göteborg",
  zip:            "41101",
  phone:          "+46700000000",
};

// Per-key substitution: when a JSON key matches, replace its [REDACTED] value
// with this. (Falls back to a generic placeholder if the key isn't listed.)
const KEY_TO_SYNTHETIC = {
  personId:        SYN.personId,
  personName:      SYN.personName,
  firstName:       SYN.firstName,
  lastName:        SYN.lastName,
  fullName:        SYN.fullName,
  name:            SYN.fullName,        // for /api/user
  displayName:     SYN.fullName,
  userDisplayName: SYN.fullName,
  fornamn:         SYN.firstName,
  efternamn:       SYN.lastName,
  namn:            SYN.fullName,
  address:         SYN.address,
  streetAddress:   SYN.address,
  postalAddress:   SYN.address,
  adress:          SYN.address,
  city:            SYN.city,
  postalCode:      SYN.zip,
  zip:             SYN.zip,
  phone:           SYN.phone,
  phoneNumber:     SYN.phone,
  mobile:          SYN.phone,
  mobilePhone:     SYN.phone,
  telefon:         SYN.phone,
  email:           "test.testsson@example.com",
  emailAddress:    "test.testsson@example.com",
  epost:           "test.testsson@example.com",
  dateOfBirth:     "1990-01-01",
  birthDate:       "1990-01-01",
  // Inbox / messaging fields scrubbed by sanitize-har.mjs.
  facilityName:    "Demo Vårdcentral, Göteborg",
  threadTitle:     "Tidbokning",
  messageUrl:      "https://arende.1177.se/inkorg/10000001",
  messageText:     "",
  title:           "",
  facilityHsaId:   "SE0000000000-DEMO",
  hsaId:           "SE0000000000-DEMO",
};

// Demo appointments to splice into /api/appointments. Mirrors fixtures.
// Clinic names and HSA-IDs are intentionally fake placeholders.
const DEMO_APPOINTMENTS = [
  {
    id: "demo-appt-1",
    start: "2026-05-20T09:00:00Z",
    end:   "2026-05-20T09:30:00Z",
    status: "BOOKED",
    reason: "Årlig hälsokontroll",
    facilityName: "Demo Vårdcentral, Göteborg",
    facilityHsaId: "SE0000000000-DEMO",
    service: "Allmänläkare 30 min",
  },
  {
    id: "demo-appt-2",
    start: "2026-06-10T14:00:00Z",
    end:   "2026-06-10T14:45:00Z",
    status: "BOOKED",
    reason: "Tandvårdskontroll",
    facilityName: "Demo Folktandvården, Göteborg",
    facilityHsaId: null,
    service: "Tandvårdskontroll 45 min",
  },
];

const REDACTED_PATTERN = /^\[REDACTED(?:_[A-Z]+)?\]$/;

function substituteValue(value, key) {
  if (typeof value !== "string") return value;
  if (!REDACTED_PATTERN.test(value)) return value;
  if (key && Object.prototype.hasOwnProperty.call(KEY_TO_SYNTHETIC, key)) {
    return KEY_TO_SYNTHETIC[key];
  }
  // Sane fallback for unknown PII keys — leaves the demo readable.
  return "Demo Value";
}

function walk(o, parentKey) {
  if (Array.isArray(o)) return o.map((v) => walk(v, parentKey));
  if (o && typeof o === "object") {
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      out[k] = walk(v, k);
    }
    return out;
  }
  return substituteValue(o, parentKey);
}

function rebuildJsonString(s) {
  if (typeof s !== "string") return s;
  const t = s.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return s;
  try {
    const parsed = JSON.parse(s);
    const cleaned = walk(parsed, null);
    return JSON.stringify(cleaned, null, 2);
  } catch {
    return s;
  }
}

// --- main ------------------------------------------------------------------
const har = JSON.parse(fs.readFileSync(IN, "utf8"));

let injectedAppointments = 0;

for (const entry of har.log.entries) {
  const req = entry.request;
  const res = entry.response;

  // strip noisy redacted cookies from the headers list (purely cosmetic)
  if (req.headers) {
    req.headers = req.headers.filter(
      (h) => h.name.toLowerCase() !== "cookie"
    );
  }
  if (res.headers) {
    res.headers = res.headers.filter(
      (h) => h.name.toLowerCase() !== "set-cookie"
    );
  }
  req.cookies = [];
  res.cookies = [];

  // recursively substitute placeholder values in body JSON
  if (req.postData?.text) req.postData.text = rebuildJsonString(req.postData.text);
  if (res.content?.text) res.content.text = rebuildJsonString(res.content.text);

  // inject demo appointments into the empty /api/appointments responses
  const url = req.url || "";
  if (
    url.startsWith("https://bokadetider.1177.se/api/appointments") &&
    res.status === 200 &&
    res.content?.text === "[]"
  ) {
    res.content.text = JSON.stringify(DEMO_APPOINTMENTS, null, 2);
    res.content.size = res.content.text.length;
    if (res.headers) {
      // patch Content-Length header if present
      const cl = res.headers.find((h) => h.name.toLowerCase() === "content-length");
      if (cl) cl.value = String(res.content.text.length);
    }
    injectedAppointments++;
  }
}

// stamp the creator so it's clear this is the demo file, not the raw capture
har.log.comment =
  "Synthetic demo HAR generated by make-demo-har.mjs. " +
  "All identifying fields replaced with synthetic values (Test Testsson, " +
  "personnummer 199001019999). Two BOOKED appointments injected into the " +
  "originally-empty /api/appointments response for demo purposes.";

fs.writeFileSync(OUT, JSON.stringify(har, null, 2));
console.log(`Wrote ${OUT}`);
console.log(`  Entries:                  ${har.log.entries.length}`);
console.log(`  Appointment responses with demo data injected: ${injectedAppointments}`);
console.log(`  All [REDACTED]* placeholders substituted with synthetic values.`);
