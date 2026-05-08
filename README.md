# Vitalis HL7 Hackathon 2026 — Agentic Patient Access

![Brasa — 1177 to FHIR R4 viewer](doc/Brasa-preview.png)

A FHIR R4 facade over the non-FHIR Swedish health portal **1177.se**, plus a
Mastra agent and a side-by-side viewer GUI.

> Project name: **Brasa** (Swedish for *bonfire*) — FHIR sounds like *fire*,
> and the dark/orange palette nods to Claude's flame.

## How it works

```
mitmproxy capture → sanitize-har.mjs → fixtures (or live HTTP)
                                            ↓
                                    UpstreamSource (Java)
                                            ↓
                                    Mapper  (pure, JsonNode → FHIR R4)
                                            ↓
                                    IResourceProvider (HAPI)
                                            ↓
                                    /fhir/* REST surface
                                            ↓
                                    Mastra agent + GUI
```

`UpstreamSource` is the only seam between FHIR and 1177 — swap fixtures for live
HTTP without touching the mappers. Mappers are pure and defensive (every field
null-checked). Providers stay thin — fetch, hand to a mapper, return.

## Quick start

```bash
# one-time: install JS deps for UI + agent
npm run install:all

# run everything (Java proxy on :8181, agent, Vite dev server) in one terminal
npm run dev
```

- Proxy + GUI: `http://localhost:8181/`
- FHIR endpoints: `http://localhost:8181/fhir/...`
- Vite UI dev server (hot reload): `http://localhost:5173/`

Proxy-only (no agent, no Vite — uses the bundled UI in the jar):

```bash
cd fhir-proxy
mvn -DskipTests package          # also builds the React GUI into src/main/resources/static/
java -jar target/fhir-proxy-1177.jar
# in another shell:
curl -s http://localhost:8181/fhir/Patient/current-user | jq
curl -s 'http://localhost:8181/fhir/Communication?recipient=Patient/current-user' | jq
```

> The Vite bundle under `fhir-proxy/src/main/resources/static/` is treated as a
> build artifact (gitignored). `mvn package` regenerates it via
> `frontend-maven-plugin`. On a fresh clone you must run `mvn package` (or
> `cd fhir-proxy/ui && npm install && npm run build`) before `java -jar` will
> serve the GUI; the FHIR endpoints work without the bundle.

Live mode (forwards a real 1177 session cookie upstream):

```bash
PROXY_MODE=live PROXY_COOKIE='<raw Cookie header from a logged-in 1177 session>' \
  java -jar fhir-proxy/target/fhir-proxy-1177.jar
```

Validation tests:

```bash
cd fhir-proxy && mvn test     # HAPI R4 instance validator on every mapper output
```

## End-to-end pipeline

1. **Capture** — `mitmweb` + Chrome with `--proxy-server`, log in with BankID.
2. **Export** — `mitmdump -nr data/raw/1177-raw-mitproxy --set hardump=data/raw/1177-raw.har`.
3. **Sanitize** — `KNOWN_PII="<your name fragments>" node scripts/sanitize-har.mjs data/raw/1177-raw.har data/clean/1177-clean.har`.
4. **Demo HAR** — `node scripts/make-demo-har.mjs` (rewrites placeholders into synthetic Test Testsson, injects demo appointments).
5. **Map** — read `doc/finding.md` for endpoint→resource mapping.
6. **Run** — `npm run dev` (or `java -jar fhir-proxy/target/fhir-proxy-1177.jar` for proxy-only).
7. **Validate** — `cd fhir-proxy && mvn test`.
8. **Snapshot output** — e.g. `curl -s http://localhost:8181/fhir/Patient/current-user > data/fhir/Patient-current-user.json`.
9. **Demo it** — follow `doc/DEMO.md`.

## Reproducing the capture

```bash
# start mitmweb
mitmweb --listen-port 8082 --set confdir=~/.mitmproxy

# launch Chrome through the proxy (port 8080 was held by a Java process)
open -na "Google Chrome" --args \
  --user-data-dir=/tmp/mitm-chrome \
  --proxy-server="http=127.0.0.1:8082;https=127.0.0.1:8082" \
  --ignore-certificate-errors

# log into 1177.se with BankID, click around, then export
mitmdump -nr data/raw/1177-raw-mitproxy --set hardump=data/raw/1177-raw.har
```

## Track guide

[Vitalis Hackathon 2026 — Agentic Patient Access](https://hl7.se/fhir/vitalis-hackathon-2026/track-agentic-patient-access.html)