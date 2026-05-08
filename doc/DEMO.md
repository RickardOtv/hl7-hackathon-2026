# Demo runbook — 1177 → FHIR R4 facade

This is the script for showing the work without exposing your real BankID
session. The whole demo runs against `data/clean/1177-demo.har` (a synthetic
substitute for your real capture) and the proxy's fixture mode. Audiences see:

1. What 1177 actually sends (raw JSON, replayed in mitmweb).
2. What the proxy converts it to (FHIR R4, served at `http://localhost:8181/fhir/*`).
3. That the FHIR output is conformant (HAPI's instance validator passes).

## Privacy posture

| File | Real PII? | Show in demo? |
|---|---|---|
| `data/raw/1177-raw.har` | yes — real BankID session | no, never |
| `data/raw/1177-raw-mitproxy` | yes | no |
| `data/clean/1177-clean.har` | no, but full of `[REDACTED]` placeholders | not pretty |
| `data/clean/1177-demo.har` | no — synthetic Test Testsson + injected demo appointments | **yes, demo this** |
| `fhir-proxy/src/main/resources/fixtures/*.json` | no — synthetic | yes |

The demo HAR was produced by:

```bash
node scripts/make-demo-har.mjs
# reads:  data/clean/1177-clean.har
# writes: data/clean/1177-demo.har
```

It substitutes every `[REDACTED]*` placeholder with the same synthetic identity
the proxy fixtures use, so the upstream JSON the audience sees and the FHIR
output the proxy emits line up perfectly.

## One-time setup

```bash
# Build the proxy fat jar (~22 MB)
cd fhir-proxy && mvn -q package
cd ..
```

## The demo (≈ 5 minutes)

### 1. Architecture in one breath

> "1177 is a non-FHIR Swedish portal. We capture its API traffic with mitmproxy,
> sanitize the PII, map each endpoint to a FHIR R4 resource, and put a HAPI FHIR
> server in front so any FHIR-aware agent — or LLM — can read 1177 data through
> standard `/Patient`, `/Appointment`, `/Communication` calls."

Open `finding.md` and show the endpoint inventory + Patient mapping table.

### 2. What 1177 sends — replay in mitmweb

```bash
# Terminal 1
mitmweb --listen-port 8082 --set confdir=~/.mitmproxy --rfile data/clean/1177-demo.har
```

mitmweb opens at `http://127.0.0.1:8081`. Show:

- The 22 captured requests across `e-tjanster`, `bokadetider`, `intyg`, `tidbok`.
- Click `GET /api/scheduling/users/current` (entry #20) — show the Swedish JSON
  with `firstName`, `lastName`, `address`, `city`, `phone`, `countyCode`,
  `municipalityCode`. Audience reaction: *"this is bespoke, not FHIR."*
- Click `GET /api/appointments` (entry #2) — show the two demo appointments.
- Click `GET /api/core/inbox/message` (entry #4) — show the array of inbox
  message metadata.

### 3. What the proxy returns — FHIR R4

```bash
# Terminal 2
java -jar fhir-proxy/target/fhir-proxy-1177.jar
```

Then in another terminal:

```bash
# CapabilityStatement — the discoverability hook for agentic clients
curl -s http://localhost:8181/fhir/metadata | jq '.rest[0].resource[].type'
# -> ["Patient", "Appointment", "Communication"]

# Patient: merged from intyg + tidbok + e-tjanster + bokadetider
curl -s http://localhost:8181/fhir/Patient/current-user | jq

# Appointments — note status="booked", start, end, participant[Patient]
curl -s 'http://localhost:8181/fhir/Appointment?patient=Patient/current-user' | jq

# Communications — inbox surfaced as Communication[]
curl -s 'http://localhost:8181/fhir/Communication?recipient=Patient/current-user' | jq
```

Talking points while the JSON streams by:

- **Patient identifier** uses `urn:oid:1.2.752.129.2.1.3.1` — the registered
  Swedish personnummer OID. An agent that knows FHIR knows that's a personal
  identifier without us telling it.
- **Appointment.participant** has both the patient (`Patient/current-user`) and
  the facility (with `urn:oid:1.2.752.29.4.71` HSA-ID identifier).
- **Communication.status** maps the 1177 `READ` / `UNREAD` / `SENT` /
  `NOT_SENT` enum onto FHIR's `EventStatus` value set.

### 4. Prove it's valid R4

```bash
cd fhir-proxy && mvn -q test
```

Show the test output — three tests pass, each one runs HAPI's
`FhirInstanceValidator` against a generated resource and asserts zero
ERROR-severity messages. Worth saying out loud:

> "These aren't a happy-path mock — they're using HAPI's official R4 instance
> validator with the full terminology chain (`DefaultProfileValidationSupport`
> + `CommonCodeSystemsTerminologyService` +
> `InMemoryTerminologyServerValidationSupport`). If a status enum or value-set
> binding is wrong, this fails."

### 5. Optional flourish — live mode

Skip unless you have time and a fresh BankID session. Don't run this in front
of an audience while logged into your real account.

```bash
PROXY_MODE=live PROXY_COOKIE='SESS=...; SAMLSESSIONID=...' \
  java -jar fhir-proxy/target/fhir-proxy-1177.jar
```

The proxy will hit `https://*.1177.se` directly with the cookie you provide
and translate live responses on the fly. Retries `412 Precondition Failed`
once (Swedish session bootstrap quirk).

## What to call out on questions

- **Why a facade and not a fork?** 1177 is a real production portal; we don't
  control it. A facade lets agentic FHIR clients work today, against the API
  that already exists.
- **Why HAPI?** It's the canonical FHIR R4 implementation. Built-in validator,
  built-in CapabilityStatement, built-in content negotiation. We don't
  hand-craft FHIR JSON anywhere.
- **What's not in this demo?** Schedule/Slot from `tidbok`, DocumentReference
  from `intyg/api/certificate`, full lazy-load of inbox message bodies, and
  multi-tenant session handling. See `finding.md` "Out-of-scope" for the
  full punch list.
- **Why is `id="current-user"`?** Single-tenant per process — one logged-in
  1177 user, one FHIR Patient. Multi-tenant would key on a hash of the
  upstream Cookie.

## Recovering quickly mid-demo

| Symptom | Fix |
|---|---|
| Port 8181 in use | `PROXY_PORT=9000 java -jar fhir-proxy/target/fhir-proxy-1177.jar` |
| `curl` returns OperationOutcome with 500 | check terminal for stack trace; usually a fixture path typo |
| mitmweb shows no entries | ensure you used `--rfile` not `-r` (or `mitmproxy -nr ...` for CLI replay) |
| Validator test fails after edits | most likely a code-system value drift; check `finding.md` mapping for the affected resource |
