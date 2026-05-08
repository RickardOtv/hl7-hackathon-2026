# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Where to read first

- **`doc/finding.md`** — authoritative source-field → FHIR-path mapping for `Patient`, `Appointment`, `Communication`. Includes which 1177 endpoint wins on conflict and the OIDs to use (`urn:oid:1.2.752.129.2.1.3.1` for personnummer, `urn:oid:1.2.752.29.4.71` for HSA-ID). The "Issues encountered" section at the bottom is a working log of HAPI 7.x gotchas. **Read before editing any mapper.** Update it when mappings change.
- **`README.md`** (top-level) — the capture/sanitize/build/run pipeline plus the `npm run dev` orchestrator that boots Java + Mastra agent + Vite together.
- **`fhir-proxy/README.md`** — endpoints, build/run, "Adding a new resource" recipe, known gaps.
- **`doc/DEMO.md`** — 5-minute presentation runbook against the synthetic demo HAR.

## Project shape

Three independent pieces:

1. **`scripts/`** (Node) — HAR processing.
   - `sanitize-har.mjs`: scrubs PII from a mitmproxy HAR. `raw → clean`. Pass extra fragments via `KNOWN_PII="Rickard,Ötvös,Otvos"`.
   - `make-demo-har.mjs`: rewrites `[REDACTED]` placeholders into a synthetic Test Testsson identity and injects two BOOKED appointments into the empty `/api/appointments` response. `clean → demo`. The synthetic identity matches the proxy fixtures, so replaying the demo HAR through the proxy yields identical FHIR output.
2. **`fhir-proxy/`** (Java 17 + Spring Boot 3.3 + HAPI FHIR 7.4, embedded Jetty via `spring-boot-starter-jetty`) — FHIR R4 facade plus a bundled React/Vite GUI. Single-tenant: there is one logged-in user, exposed at the magic id `current-user`.
3. **`agent/`** (Node + TypeScript, Mastra) — sidecar agent on port 4111 that exposes `fhirAgent` with FHIR tools backed by the proxy. The GUI's chat drawer streams from `/api/agents/fhirAgent/stream`. Has an eval harness under `agent/evals/`.

Data convention:

- `data/raw/` — captures with real PII. **Never commit/share.**
- `data/clean/1177-clean.har` — sanitized capture (placeholder values, not pretty).
- `data/clean/1177-demo.har` — synthetic, presentation-ready (this is what `doc/DEMO.md` replays).
- `data/examples/` — alternate "Anna Andersson" identity (different from the "Test Testsson" fixtures). Used by the GUI's drag-and-drop input panel to feed `POST /transform/{Patient,Appointment,Communication}` and prove the mappers handle a second identity.
- `data/fhir/` — snapshots of converted FHIR resources (output destination, optional).

## Common commands

```bash
# Run everything (Java proxy + Mastra agent + Vite dev) from repo root
npm run install:all              # one-time, installs ui/ and agent/ deps
npm run dev                      # concurrently: mvn spring-boot:run + agent + vite

# Build the Spring Boot uber-jar (target/fhir-proxy-1177.jar)
cd fhir-proxy && mvn -q package

# Run the proxy alone (fixture mode, default — uses bundled GUI in the jar)
java -jar fhir-proxy/target/fhir-proxy-1177.jar
# or, dev mode without rebuilding the jar:
cd fhir-proxy && mvn spring-boot:run

# Run in live mode (forwards a real 1177 session cookie upstream)
PROXY_MODE=live PROXY_COOKIE='<raw Cookie header>' java -jar fhir-proxy/target/fhir-proxy-1177.jar

# Override port (default 8181 — chosen because 8080 was held)
PROXY_PORT=9000 java -jar fhir-proxy/target/fhir-proxy-1177.jar

# Run all validation tests
cd fhir-proxy && mvn -q test

# Run a single test
cd fhir-proxy && mvn -q -Dtest=FhirValidationTest#patient_validates test

# Run agent evals
npm run eval                                 # default model
EVAL_MODEL=qwen3:4b npm run eval             # pin a specific Ollama model

# Sanitize a fresh HAR capture
KNOWN_PII="<names>" node scripts/sanitize-har.mjs data/raw/1177-raw.har data/clean/1177-clean.har

# Build the synthetic demo HAR from the sanitized one
node scripts/make-demo-har.mjs   # (defaults: data/clean/1177-clean.har -> data/clean/1177-demo.har)

# Replay the demo HAR in mitmweb (for the demo / GUI screenshot work)
mitmweb --listen-port 8082 --set confdir=~/.mitmproxy --rfile data/clean/1177-demo.har

# Snapshot a FHIR resource to disk (proxy must be running)
curl -s http://localhost:8181/fhir/Patient/current-user > data/fhir/Patient-current-user.json
```

## Architecture invariants

Three-layer pipeline under `se.hackathon.proxy`:

```
UpstreamSource (abstract)  →  Mapper (static, pure)  →  IResourceProvider (HAPI REST)
```

When extending or refactoring, preserve these properties:

- **`UpstreamSource` is the only seam** between FHIR and 1177. Both `FixtureUpstreamSource` and `LiveUpstreamSource` live in this file as nested static classes. Don't let HTTP details (cookies, hosts, URLs) leak into mappers or providers.
- **Mappers are pure and defensive.** They consume `JsonNode` (or `null`), never make I/O calls, and null-check every field via the `isPresent` / `text` / `bool` / `firstNonBlank` helpers. Statuses fall back to safe defaults (`proposed`, `unknown`). This is what makes them trivially testable from fixtures.
- **Providers stay thin.** Fetch via `UpstreamSource`, hand to a mapper, return. No business logic.
- **Patient merge priority is encoded in argument order** of `PatientMapper.build(intyg, tidbok, etjanster, bokadetider)` — see `doc/finding.md`. Don't reorder without updating the mapping doc.
- **412 Precondition Failed is auto-retried once** in `LiveUpstreamSource` — Swedish session-bootstrap quirk, not an error.
- **Hackathon-namespaced extensions use `https://hackathon.example/se/...`** (intentional placeholder, not a real domain — e.g. `/se/county-code`, `/se/municipality-code`, `/se/login-method`, `/se/communication/favorite`, `/se/communication/has-attachment`, `/se/communication/messages-in-thread`). The R4 validator emits `WARNING`/`INFO` messages for unknown extension URLs — that is expected and the test ignores them. Only `ERROR`/`FATAL` fail the build.
- **Three-source validation chain.** `DefaultProfileValidationSupport` alone is not enough — it ships profiles but no value-set expansion, so legitimate codes like `booked`, `phone`, `home`, `completed` fail. The test composes `DefaultProfileValidationSupport` + `CommonCodeSystemsTerminologyService` + `InMemoryTerminologyServerValidationSupport`. Mirror this chain anywhere else you instantiate a validator. Also note: HAPI 7.x requires a cache SPI on the classpath (`hapi-fhir-caching-caffeine`) or the validator throws `HAPI-2200`.

## Spring Boot wiring, servlets, transform endpoints, and the GUI

`ProxyApp` is a `@SpringBootApplication` (entry: `se.hackathon.proxy.ProxyApp`). It maps the env vars `PROXY_PORT` / `PROXY_MODE` / `PROXY_COOKIE` onto Spring properties before the context starts. The HTTP surface mounted on the embedded Jetty:

- `/fhir/*` — HAPI `RestfulServer` (`FhirProxyServer`), registered as a servlet bean in `ServletConfig` so it lives outside Spring MVC.
- `/fixtures/raw/*` — `RawFixtureServlet` serves the bundled fixture JSONs verbatim from the classpath, with a hard-coded whitelist. The GUI's "input" panel calls these to show the upstream JSON next to the FHIR output.
- `/transform/{Patient,Appointment,Communication}` — `TransformController` (`@RestController`) accepts raw 1177 JSON and re-runs the mappers. `Patient` accepts any subset of `{etjansterUserprofile, bokadetiderUser, intygUser, tidbokUsersCurrent}` — missing keys fall back to the bundled fixture, so the GUI's drop zone can drop one tab at a time. Distinct from `/fhir/*` so the HAPI servlet stays purely conformant.
- `/` — the React/Vite GUI, served by Spring Boot's default static handler from classpath `/static/`.

The GUI source lives at `fhir-proxy/ui/` (React 18 + TypeScript + Vite, with Shiki + react-markdown). On `mvn package`, the `frontend-maven-plugin` downloads Node 20 into `target/` (cached after first build, ~90s once), runs `npm install` + `npm run build`, and Vite emits the bundle into `src/main/resources/static/` (see `ui/vite.config.ts`) so it ships inside the Spring Boot uber-jar. **The `static/` dir is gitignored — treat it as a build artifact.** On a fresh clone, `mvn package` (or `cd ui && npm install && npm run build`) must run before `java -jar` will serve the GUI; the FHIR endpoints work without it. For hot-reload dev work, run the proxy via `mvn spring-boot:run` and start `npm run dev` in `ui/` — Vite proxies `/fhir`, `/fixtures`, and `/transform` to the running proxy.

The GUI's chat drawer (`ChatDrawer.tsx`) probes `localhost:11434/api/tags` directly to discover Ollama models, and streams chat responses from the **Mastra agent sidecar** at `http://localhost:4111/api/agents/fhirAgent/stream`. The agent (in `agent/`) is the one that actually calls Ollama and the FHIR tools — the browser does not stream chat completions from Ollama directly. See `fhir-proxy/README.md` for the auto-detect behaviour, the tool-capable model list (qwen3, qwen2.5, llama3.x, mistral, command-r), and the `OLLAMA_ORIGINS` CORS requirement (pin to `http://localhost:8181,http://localhost:5173,http://localhost:4111` rather than `*` so a malicious HTTP page can't read the FHIR JSON the chat sends to Ollama).

## Tests

`fhir-proxy/src/test/java/.../FhirValidationTest.java` runs each mapper on bundled fixtures and asserts HAPI's official R4 `FhirInstanceValidator` emits zero `ERROR`-severity messages. Resources are also printed to stdout for visual inspection. Add a case here whenever a new mapper is added.
