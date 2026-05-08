# Vitalis Hackathon 2026 — Agentic Patient Access
## 1177 → FHIR R4 mapping

**Track:** Build a FHIR R4 proxy/facade for [1177.se](https://1177.se).
**Capture method:** mitmproxy 12.2.2, Chrome with `--proxy-server`, real BankID login.
**Sanitization:** custom Node script (`scripts/sanitize-har.mjs`) with `KNOWN_PII` env override; verified zero leftover personnummer/name/email/phone/JWT.
**Demo HAR:** `scripts/make-demo-har.mjs` rewrites the sanitized HAR (`data/clean/1177-clean.har`) into a presentation-ready synthetic version (`data/clean/1177-demo.har`) using the same Test Testsson identity as the proxy fixtures, and injects two BOOKED appointments into the empty `/api/appointments` response.

---

## Endpoint inventory

| # | Host | Method | Path | Status seen | Used for FHIR |
|---|------|--------|------|-------------|----------------|
| 0 | bokadetider.1177.se | GET | `/api/user` | 412, 200 | Patient |
| 1 | bokadetider.1177.se | GET | `/api/appointments` | 200 (empty `[]`) | Appointment |
| 2 | e-tjanster.1177.se | GET | `/api/core/userprofile` | 200 | Patient |
| 3 | e-tjanster.1177.se | GET | `/api/core/inbox/message` | 200 | Communication |
| 4 | intyg.1177.se | GET | `/api/user` | 403, 200 | Patient (best source — has `personId`) |
| 5 | intyg.1177.se | GET | `/api/info` | 200 | (out of scope) |
| 6 | intyg.1177.se | GET | `/api/filters` | 200 | (out of scope) |
| 7 | intyg.1177.se | POST | `/api/certificate` | 200 | DocumentReference (defer) |
| 8 | intyg.1177.se | GET | `/api/session/ping` | 200 | (auth/session, not data) |
| 9 | tidbok.1177.se | GET | `/api/scheduling/users/current` | 412, 200 | Patient (richest profile) |
| 10 | tidbok.1177.se | GET | `/api/scheduling/user-facilities` | 200 | Organization / HealthcareService (defer) |

> The 412 `Precondition Failed` responses are seen on first call to `/api/user` and `/api/scheduling/users/current` — a Swedish session-bootstrap artefact. Retry succeeds. Proxy should treat 412 as transparent (pass through, no FHIR mapping).

---

## Patient (R4)

Authoritative source priority for the proxy:
`intyg /api/user` (has `personId`) → `tidbok /api/scheduling/users/current` (richest demographics) → `e-tjanster /api/core/userprofile` (firstName/lastName fallback) → `bokadetider /api/user` (last resort).

### Source field → FHIR Patient mapping

| 1177 source | Source field | FHIR R4 path | Notes |
|---|---|---|---|
| intyg `/api/user` | `personId` | `Patient.identifier[0]` | `system = "urn:oid:1.2.752.129.2.1.3.1"` (Swedish personnummer OID), `value = personId` |
| intyg `/api/user` | `personName` | `Patient.name[0].text` | Single concatenated name; split into given/family if possible |
| intyg `/api/user` | `loginMethod` | `Patient.extension` (`https://hackathon.example/se/login-method`) | e.g. `"ELVA77"` — auth metadata; kept as a CodeType extension on the resource root. |
| e-tjanster `/api/core/userprofile` | `firstName` | `Patient.name[0].given[0]` | |
| e-tjanster `/api/core/userprofile` | `lastName` | `Patient.name[0].family` | |
| e-tjanster `/api/core/userprofile` | `agent` | (drop or `Patient.contact`) | If non-null, model proxy/agent as `Patient.contact[].relationship` |
| tidbok `/api/scheduling/users/current` | `firstName` | `Patient.name[0].given[0]` | |
| tidbok `/api/scheduling/users/current` | `lastName` | `Patient.name[0].family` | |
| tidbok `/api/scheduling/users/current` | `name` | `Patient.name[0].text` | Concatenated form |
| tidbok `/api/scheduling/users/current` | `address` | `Patient.address[0].line[0]` | `address.use = "home"` |
| tidbok `/api/scheduling/users/current` | `city` | `Patient.address[0].city` | |
| tidbok `/api/scheduling/users/current` | `zip` | `Patient.address[0].postalCode` | |
| tidbok `/api/scheduling/users/current` | `phone` | `Patient.telecom[0]` | `system = "phone"`, `use = "mobile"` |
| tidbok `/api/scheduling/users/current` | `countyCode` | `Patient.address[0].extension` | Swedish län code (e.g. `"14"` = Västra Götaland). Mapped as extension `https://hackathon.example/se/county-code` (see `PatientMapper.COUNTY_EXT_URL`). |
| tidbok `/api/scheduling/users/current` | `municipalityCode` | `Patient.address[0].extension` | Swedish kommun code (e.g. `"80"`). Extension `https://hackathon.example/se/municipality-code`. |
| tidbok `/api/scheduling/users/current` | `active` | `Patient.active` | direct |
| bokadetider `/api/user` | `name` | `Patient.name[0].text` | |
| bokadetider `/api/user` | `active` | `Patient.active` | |

### Generated structure (target)

```json
{
  "resourceType": "Patient",
  "id": "current-user",
  "active": true,
  "identifier": [
    { "system": "urn:oid:1.2.752.129.2.1.3.1", "value": "<personnummer>" }
  ],
  "name": [
    { "use": "official", "family": "<lastName>", "given": ["<firstName>"], "text": "<full>" }
  ],
  "telecom": [
    { "system": "phone", "value": "<phone>", "use": "mobile" }
  ],
  "address": [
    { "use": "home", "line": ["<address>"], "city": "<city>", "postalCode": "<zip>", "district": "<countyCode>" }
  ]
}
```

### Open questions
- The captured `personId` is 12-digit `YYYYMMDDXXXX`. FHIR Swedish profile typically expects 12-digit form. Confirm whether to add hyphen.
- `loginMethod = "ELVA77"` — do we surface this anywhere? (Probably no — it's not patient demographics.)

---

## Appointment (R4)

> ⚠️ The real capture returned `[]` for `/api/appointments` (the captured user had nothing booked). The shape below is **inferred** from bokadetider portal docs and Swedish booking conventions. The fixture (`fhir-proxy/src/main/resources/fixtures/bokadetider-appointments.json`) and the demo-HAR injector (`scripts/make-demo-har.mjs`) both follow this shape and the validator passes. **If a future capture exposes the real field names, update the fixture, the injector's `DEMO_APPOINTMENTS`, and `AppointmentMapper` together.**

### 1177 source shape (bokadetider `/api/appointments`)

```json
[
  {
    "id": "<uuid>",
    "start": "2026-05-12T09:00:00Z",
    "end":   "2026-05-12T09:30:00Z",
    "status": "BOOKED",
    "reason": "<free text>",
    "facilityName": "Capio Vårdcentral Gårda, Gårda",
    "facilityHsaId": "SE5567695209-5WW",
    "service": "Allmänläkare 30 min"
  }
]
```

### FHIR Appointment mapping

| Source field | FHIR R4 path | Notes |
|---|---|---|
| `id` | `Appointment.id` | |
| `start` | `Appointment.start` | ISO 8601 instant |
| `end` | `Appointment.end` | ISO 8601 instant |
| `status` | `Appointment.status` | Map: `BOOKED`→`booked`, `CANCELLED`→`cancelled`, `COMPLETED`→`fulfilled`, otherwise `proposed` |
| `reason` | `Appointment.description` (or `Appointment.reasonCode`) | Free text → `description`. If structured, use `reasonCode`. |
| `facilityName` | `Appointment.participant[0].actor.display` | + `actor.type = "Location"` |
| `facilityHsaId` | `Appointment.participant[0].actor.identifier` | `system = "urn:oid:1.2.752.29.4.71"` (Swedish HSA-ID OID) |
| `service` | `Appointment.serviceType[0].text` | |
| (always) | `Appointment.participant[1]` | `actor = { reference: "Patient/current-user" }`, `status: "accepted"`, `required: "required"` |

### Validation requirements
- `Appointment.status` is required.
- `Appointment.participant` is required and must contain at least one entry with `status`.

---

## Communication (R4)

Source: `e-tjanster /api/core/inbox/message` — array of inbox-message metadata items.

### Sample 1177 source shape (sanitized)

```json
{
  "id": 312453808,
  "threadTitle": "Kontakt för bokning av tid",
  "threadLabel": "Ärendet avslutat",
  "facilityName": "Capio Vårdcentral Gårda, Gårda",
  "messageDate": "2026-01-08T13:17:53.912Z",
  "readStatus": "READ",
  "favorite": false,
  "messageUrl": "https://arende.1177.se/inkorg/92073896",
  "title": null,
  "messageText": null,
  "facilityHsaId": null,
  "hasAttachment": false,
  "actionLinks": null,
  "messagesInThread": 2,
  "hasCustomServiceLink": false
}
```

### FHIR Communication mapping

| Source field | FHIR R4 path | Notes |
|---|---|---|
| `id` | `Communication.id` | stringify integer |
| `threadTitle` | `Communication.topic.text` | |
| `threadLabel` | `Communication.category[0].text` | values: `Information`, `Ärendet avslutat`, … |
| `facilityName` | `Communication.sender.display` | + `sender.type = "Organization"` |
| `facilityHsaId` | `Communication.sender.identifier` | `system = "urn:oid:1.2.752.29.4.71"`. If null, omit. |
| `messageDate` | `Communication.sent` | ISO 8601 instant |
| `readStatus` | `Communication.status` | Map: `READ`→`completed`, `UNREAD`→`in-progress`, `SENT`→`completed`, `NOT_SENT`→`preparation` |
| `favorite` | extension `https://hackathon.example/se/communication/favorite` | boolean |
| `messageUrl` | `Communication.identifier[0]` | system `https://1177.se/inbox-url`, value=URL — also surface as `Communication.note[0].text` for clients |
| `title` | `Communication.payload[0].contentString` (subject) | only when present |
| `messageText` | `Communication.payload[1].contentString` (body) | only when present (1177 lazy-loads body — separate fetch) |
| `hasAttachment` | extension `https://hackathon.example/se/communication/has-attachment` | boolean — flag only; no `Communication.payload[].contentAttachment` until a per-message fetch is wired. |
| `messagesInThread` | extension `https://hackathon.example/se/communication/messages-in-thread` | integer |
| (always) | `Communication.recipient[0]` | `{ reference: "Patient/current-user" }` |

### Validation notes
- `Communication.status` is required (1..1).
- Lazy-load: 1177 inbox list omits `messageText`; clients fetch `messageUrl` for full body. Proxy may need a second route `GET /Communication/{id}` that fetches the detail.

---

## Out-of-scope for this hackathon scope (deferred)

| Resource | Source | Why deferred |
|---|---|---|
| Schedule, Slot | `tidbok /api/scheduling/user-facilities` | Complex graph (Organization → HealthcareService → Schedule → Slot). Possible stretch goal. |
| DocumentReference, Composition | `intyg /api/certificate` | Capture only shows POST endpoint with no useful body in this trace. Defer. |
| Organization | `facilityHsaId` references | Stub via `display` only; no separate Organization resource for v1. |

---

## Proxy URL → FHIR endpoint mapping (proposed)

| Proxy route | Upstream call(s) | FHIR resource |
|---|---|---|
| `GET /Patient/current-user` | merged: intyg `/api/user` + tidbok `/api/scheduling/users/current` + e-tjanster `/api/core/userprofile` | Patient |
| `GET /Appointment?patient=current-user` | bokadetider `/api/appointments` | Bundle of Appointment |
| `GET /Communication?recipient=Patient/current-user` | e-tjanster `/api/core/inbox/message` | Bundle of Communication |
| `GET /Communication/{id}` | (future) `/api/core/inbox/message/{id}` | Communication with payload |
| `GET /metadata` | (HAPI builds automatically) | CapabilityStatement |

---

## Sanitization audit summary (custom Node script)

| Counter | Hits |
|---|---|
| Cookies redacted | 101 |
| JWTs redacted | 0 |
| Bearer tokens redacted | 0 |
| Personnummer regex hits | 0 (caught earlier by `personId` JSON-key handler) |
| Emails redacted | 0 (none in capture) |
| Phones redacted | 0 (none in capture) |
| UUIDs redacted | 30 |
| JSON PII keys redacted | 36 |

Post-sanitization grep for `Rickard|Ötv|Otvos`, `\d{6,8}-?\d{4}`, email regex, JWT regex, Bearer regex: **0 matches**.

---

## Issues encountered during build (and how we fixed them)

A working log of the gotchas we hit, in case you (or anyone forking this) hit
the same walls.

### 1. `har-sanitizer` is not a Python CLI

Cloudflare's [`har-sanitizer`](https://github.com/cloudflare/har-sanitizer) is a
JS web app — it is **not** on PyPI, so `pipx run har-sanitizer …` fails with
"Could not find a version that satisfies the requirement har-sanitizer".

**Fix:** the custom Node script (`sanitize-har.mjs`) covers the same ground
(cookies, auth headers, JSON PII keys, JWTs, UUIDs, Bearer tokens) plus
Sweden-specific patterns (personnummer regex, known-name fragments via
`KNOWN_PII` env). Verified with grep — zero leftover personnummer / name /
email / phone / JWT.

### 2. HAPI 7.x: "HAPI-2200: No Cache Service Providers found"

`hapi-fhir-validation` has no built-in cache implementation in 7.x — it picks
one off the classpath via Java `ServiceLoader`. Without one, instantiating
`FhirInstanceValidator` throws at validate time:

```
java.lang.RuntimeException: HAPI-2200: No Cache Service Providers found.
  Choose between hapi-fhir-caching-caffeine (Default) and hapi-fhir-caching-guava (Android).
```

**Fix:** add this dep to `pom.xml`:

```xml
<dependency>
    <groupId>ca.uhn.hapi.fhir</groupId>
    <artifactId>hapi-fhir-caching-caffeine</artifactId>
    <version>${hapi.fhir.version}</version>
</dependency>
```

### 3. Validator rejects legitimate R4 codes ("booked", "phone", "home", …)

`DefaultProfileValidationSupport` alone ships profiles (`StructureDefinition`)
but **not** the terminology services that expand FHIR's internal value sets.
Result: every required-binding code field fails:

```
[ERROR] Patient.name[0].use   The value provided ('official') was not found in 'NameUse'
[ERROR] Patient.telecom[0].system  ('phone') not found in 'ContactPointSystem'
[ERROR] Patient.telecom[0].use     ('mobile') not found in 'ContactPointUse'
[ERROR] Patient.address[0].use     ('home')  not found in 'AddressUse'
[ERROR] Communication.status       ('completed') not found in 'EventStatus'
[ERROR] Appointment.status         ('booked') not found in 'AppointmentStatus'
[ERROR] Appointment.participant[*].status   ('accepted')   not found in 'ParticipationStatus'
[ERROR] Appointment.participant[*].required ('required')   not found in 'ParticipantRequired'
```

These codes are all valid R4 — the validator just couldn't expand the value
sets without the terminology layer.

**Fix:** chain three support modules:

```java
ValidationSupportChain chain = new ValidationSupportChain(
    new DefaultProfileValidationSupport(ctx),
    new CommonCodeSystemsTerminologyService(ctx),
    new InMemoryTerminologyServerValidationSupport(ctx)
);
FhirInstanceValidator instanceValidator = new FhirInstanceValidator(chain);
```

### 4. `DefaultProfileValidationSupport` package drift

This class has moved twice across HAPI majors:

| HAPI version | Package |
|---|---|
| 5.x | `org.hl7.fhir.r4.hapi.ctx.DefaultProfileValidationSupport` |
| 6.x — 7.x | `ca.uhn.fhir.context.support.DefaultProfileValidationSupport` |

Old StackOverflow answers and tutorials still reference the 5.x path, which
will compile-error in HAPI 7.x with "cannot find symbol".

**Fix:** `import ca.uhn.fhir.context.support.DefaultProfileValidationSupport;`

### 5. 412 Precondition Failed on first session call

Calling `https://bokadetider.1177.se/api/user` or
`https://tidbok.1177.se/api/scheduling/users/current` for the first time after
login returns `412 Precondition Failed` with a tiny error body. The same call
issued a second later returns `200`. Looks like a session bootstrap step on
1177's side.

**Fix:** `LiveUpstreamSource.get(...)` retries once on 412 before giving up.

### 6. `/api/appointments` returned `[]` for our user

The captured user has no booked appointments, so the **shape of the array
items** in `bokadetider /api/appointments` is inferred (start/end/status/reason/
facilityName/facilityHsaId/service). Validator passes against fixture data with
this shape, but field names in the live response could differ.

**Mitigation in place:** the same inferred shape is used in three places — the
fixture, `make-demo-har.mjs`'s `DEMO_APPOINTMENTS`, and `AppointmentMapper`'s
field reads — so swapping to a corrected shape is a one-pass change. Book a
real test appointment and re-capture to confirm.

### 7. Sanitizer over-redacts public facility/service names

Because `name` is in the `PII_KEYS` set, the script also redacts legitimate
fields like `facilityServices[].name` and the facility-level `name` in
`/api/scheduling/user-facilities`. Those are public clinic/service names, not
PII — but redacting them is the safer default than risking a false negative.

**Trade-off accepted:** the redacted output is what we read for FHIR mapping.
The structural information (key names, types, list lengths) is still visible,
which is enough for mapping work. If a future need requires the actual values,
re-run the script with a narrowed `PII_KEYS` set.

### 8. Sanitizer counter "personnummer: 0" is misleading

The audit summary shows `personnummer: 0` redactions even though there was a
personnummer in the source. Reason: the JSON walker hits `personId` first and
short-circuits with the PII-key handler, so the regex never runs against that
value.

**Real coverage check:** post-sanitization grep for `\b(19|20)?\d{6}[-+]?\d{4}\b`
across the entire HAR — that's the actual safety net, and returns 0 matches.

### 9. Inbox message bodies are lazy-loaded by 1177

`/api/core/inbox/message` returns a list with `messageText: null`. The full
body lives on a separate per-message endpoint that the proxy doesn't yet call.

**Status:** `Communication.payload` is omitted when the source is null, which
is FHIR-valid (payload is 0..*). For full message body, add a
`/api/core/inbox/message/{id}` upstream method and call it from
`CommunicationProvider.read(IdParam)`.

### 10. `dom-6` and "Unknown extension" warnings during validation

These are expected and **not** failure signals:

- `dom-6: 'A resource should have narrative for robust management'` — best
  practice; we don't generate `text.div` narrative since the proxy is for
  machine consumption.
- `Unknown extension https://hackathon.example/se/...` — INFO-level; the
  validator can't find a `StructureDefinition` for our hackathon-namespaced
  extensions (county-code, municipality-code, login-method, favorite,
  has-attachment, messages-in-thread). Production usage would register them.

### 11. No JDK in the scaffolding sandbox

The environment used to scaffold this project had only a JRE, so the Java code
was generated and brace-checked statically — runtime issues (cache provider,
terminology chain) only surfaced once Maven was run on the host. Future cycle:
add a static type-check pass before delivery. (Caught and fixed within the
session.)
