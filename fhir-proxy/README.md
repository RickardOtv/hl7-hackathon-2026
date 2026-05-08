# 1177 → FHIR R4 Proxy (Vitalis Hackathon 2026)

A FHIR R4 facade over the non-FHIR Swedish 1177.se patient portal. Built for the
[Agentic Patient Access track](https://hl7.se/fhir/vitalis-hackathon-2026/track-agentic-patient-access.html).

> **Status:** Patient + Appointment + Communication mappers are implemented and
> validated against HAPI's R4 instance validator. Schedule/Slot, DocumentReference,
> and Composition are out of scope for v1 (see `../doc/finding.md`).

## Architecture

```
Browser (React, :5173 dev / :8181 prod)
   │ POST stream      ┌──────────────────────────────────────┐
   │  ───────────────►│ Mastra agent sidecar (Node, :4111)   │
   │                  │   tools: getPatient, searchMessages, │
   │                  │   searchAppointments, transform*, …  │
   │                  └──────────────────────────────────────┘
   │ GET /fhir/*               │ tool calls                  │ /v1/chat/completions
   │ POST /transform/*         ▼                             ▼
   ▼                  ┌─────────────────────────┐  ┌────────────────────┐
┌───────────────────────────────────┐                │ Ollama (:11434)    │
│ Spring Boot · HAPI FHIR (:8181)   │                │ qwen3 · llama3.2 · │
│   PatientProvider                 │                │ mistral · …        │
│   AppointmentProvider             │                └────────────────────┘
│   CommunicationProvider           │
│   TransformController             │
└───────────────────────────────────┘
   │ fetch upstream JSON
   ▼
┌─────────────────────────────────────────┐
│ UpstreamSource (pluggable)              │
│   - FixtureUpstreamSource (default)     │
│   - LiveUpstreamSource (PROXY_MODE=live)│
└─────────────────────────────────────────┘
   │
   ▼
1177 hosts: e-tjanster, bokadetider, intyg, tidbok
```

`UpstreamSource` is the only seam between FHIR and 1177. Mappers are pure
functions over Jackson `JsonNode` — easy to test offline.

## Endpoints

| HTTP | Path | What it does |
|---|---|---|
| GET | `/` | Web GUI (input → FHIR viewer + Ollama chat) |
| GET | `/fhir/metadata` | HAPI-generated CapabilityStatement |
| GET | `/fhir/Patient/current-user` | Merged patient profile |
| GET | `/fhir/Patient` | Single-element bundle (same as above) |
| GET | `/fhir/Appointment?patient=Patient/current-user` | All upcoming appointments |
| GET | `/fhir/Communication?recipient=Patient/current-user` | Inbox messages as Communication[] |
| GET | `/fhir/Communication/{id}` | Single message (looks up id in inbox list) |
| GET | `/fixtures/raw/{name}.json` | Raw 1177 fixture JSON, used by the GUI's input panel |
| POST | `/transform/Patient` | Transform `{etjansterUserprofile?, bokadetiderUser?, intygUser?, tidbokUsersCurrent?}` → FHIR Patient |
| POST | `/transform/Appointment` | Transform raw `bokadetider-appointments` JSON → Appointment Bundle |
| POST | `/transform/Communication` | Transform raw `etjanster-inbox` JSON → Communication Bundle |

The CapabilityStatement at `/fhir/metadata` is the discoverability hook for
agentic clients — point your LLM at it and it learns the surface area.

## GUI

A small React/Vite app lives at `ui/`. It shows the raw 1177 JSON on the left,
the transformed FHIR resource on the right, and a chat box that talks to a
**Mastra agent sidecar** (TypeScript, Node) about the FHIR resource currently
in view. The agent has FHIR tools and decides what to fetch — it doesn't just
get the JSON dumped into its context.

**Drop-to-remix**: drag any sanitized 1177 JSON file onto the left panel and
the FHIR side re-transforms live via `POST /transform/{Patient|Appointment|Communication}`.
Patient takes any subset of `{etjansterUserprofile, bokadetiderUser, intygUser,
tidbokUsersCurrent}` — missing keys fall back to the bundled fixture, so you
can drop one tab at a time. Hit "↺ revert" to go back to fixtures.

### Run the bundled GUI

```bash
cd fhir-proxy
mvn clean package                 # builds Java + React, produces fat jar
java -jar target/fhir-proxy-1177.jar
open http://localhost:8181/       # GUI
```

The GUI bundle is built by `frontend-maven-plugin` (Node 20 is downloaded into
`target/` on first build — adds ~90s once, cached afterwards) and copied into
`src/main/resources/static/`, so it ships inside the same uber-jar.

### Dev workflow with hot reload

```bash
# terminal 1
cd fhir-proxy
mvn spring-boot:run

# terminal 2
cd fhir-proxy/ui
npm install
npm run dev                       # http://localhost:5173, proxies /fhir + /fixtures to :8181
```

### Mastra agent sidecar

Lives in [`../agent/`](../agent/). A Node/TypeScript Mastra app exposing a
single agent (`fhirAgent`) with eight FHIR tools backed by this Spring server:

| Tool | Backed by |
|---|---|
| `getPatient` | GET `/fhir/Patient/current-user` |
| `searchAppointments` | GET `/fhir/Appointment?...` |
| `searchMessages` | GET `/fhir/Communication?...` |
| `getMessage` | GET `/fhir/Communication/{id}` |
| `getCapabilityStatement` | GET `/fhir/metadata` |
| `transformPatient` / `Appointment` / `Communication` | POST `/transform/...` |

The agent receives the **currently-displayed FHIR resource** as initial
context, then decides which tools to call. The chat UI surfaces a collapsible
"🔧 used tools" trace under each assistant reply.

Tool-calling requires an Ollama model that supports the OpenAI tools API
(qwen3, qwen2.5, llama3.1, llama3.2, mistral, command-r). `gemma3` and
`deepseek-r1` won't work — the UI labels them "no tools" in the dropdown.

### Local LLM (free)

```bash
brew install ollama               # or https://ollama.com/download
ollama pull qwen3:4b              # ~2.5 GB, tool-capable, multilingual
# Allow only this app's origins.
OLLAMA_ORIGINS='http://localhost:8181,http://localhost:5173,http://localhost:4111' ollama serve
```

The chat probes `/api/tags`, auto-picks the best installed model (preferring
`qwen3` → `qwen2.5` → `llama3.2` → `llama3.1` → `llama3` → `mistral`), and
shows a `<select>` for manual switching. Reasoning-style models that emit
`<think>…</think>` are supported — those blocks are stripped from the visible
answer.

### Run everything (one command)

From the **repo root**:

```bash
npm install                       # one-time, installs concurrently
npm run install:all               # one-time, installs ui/ and agent/ deps
npm run dev                       # starts Spring Boot, Mastra sidecar, Vite
# open http://localhost:5173/  ← Vite dev (with hot reload)
# open http://localhost:4111/  ← Mastra Studio playground
```

### Evals

Quantifies how well the agent answers grounded FHIR questions:

```bash
npm run eval                          # uses the agent's default model
EVAL_MODEL=qwen3:4b npm run eval      # pin a specific model
```

Output: a console table of contains/cites/tool-use rates per case + a JSON
report under `agent/eval-results/<timestamp>.json`.

## Build

Requires JDK 17+ and Maven 3.9+.

```bash
cd fhir-proxy
mvn clean package
```

Produces `target/fhir-proxy-1177.jar` — a Spring Boot executable jar containing
HAPI, embedded Jetty, the React GUI bundle, and all dependencies.

## Run

### Fixture mode (default, no live login required)

Two equivalent ways:

```bash
mvn spring-boot:run                  # dev — no jar build needed
# or
java -jar target/fhir-proxy-1177.jar # production-style, runs the packaged jar
```

Then:

```bash
curl -s http://localhost:8181/fhir/metadata | jq '.rest[0].resource[].type'
curl -s http://localhost:8181/fhir/Patient/current-user | jq
curl -s 'http://localhost:8181/fhir/Appointment?patient=Patient/current-user' | jq
curl -s 'http://localhost:8181/fhir/Communication?recipient=Patient/current-user' | jq
```

### Live mode (forwards your real 1177 session)

You need a logged-in session cookie from a Chrome window with mitmproxy attached
(see the "Reproducing the capture" section in `../README.md`). Copy the full
`Cookie:` request header from any 1177 request and:

```bash
PROXY_MODE=live PROXY_COOKIE='SESS=...; SAMLSESSIONID=...' \
  java -jar target/fhir-proxy-1177.jar
```

The proxy retries once on `412 Precondition Failed` (a 1177 session-bootstrap
quirk) and surfaces all other upstream errors as FHIR `OperationOutcome`.

### Port

Default port is **8181** (chosen because the user's machine had a Java process
holding 8080). Override with `PROXY_PORT=...`.

## Validate FHIR output

```bash
mvn test
```

Runs `FhirValidationTest` — generates a Patient, two Appointments, three
Communications from fixtures, and asserts HAPI's R4 `FhirInstanceValidator`
emits **zero ERROR-severity messages**. Resource serialisations are printed
to stdout for visual inspection.

WARNING-severity messages on the unknown extension URLs
(`https://hackathon.example/...`) are expected — they're hackathon-namespaced
extensions for fields that don't have a FHIR R4 standard home (county code,
favorite, attachment flag). For a non-hackathon implementation, register them
in a StructureDefinition.

## Mapping rules

See [`../doc/finding.md`](../doc/finding.md) for the full source-field → FHIR-path
mapping table for Patient, Appointment, and Communication, including
authoritative-source priority and validation requirements.

## Adding a new resource

1. Add an `upstream*()` method to `UpstreamSource` and both implementations.
2. Add a fixture under `src/main/resources/fixtures/`.
3. Write a `<Resource>Mapper` (pure `JsonNode` → typed FHIR resource).
4. Write a `<Resource>Provider` (HAPI `IResourceProvider`).
5. Register it in `FhirProxyServer.initialize()`.
6. Add a test case to `FhirValidationTest`.

## Known gaps

- **No Schedule/Slot:** the `tidbok /api/scheduling/user-facilities` response
  exposes a complex graph (Organization → HealthcareService → Schedule → Slot).
  Possible stretch goal.
- **No DocumentReference (intyg):** the captured POST `/api/certificate` had no
  meaningful body.
- **No HSA-ID Organization resource:** facilities are surfaced via
  `Reference.identifier` + `display` only.
- **Single-tenant `id="current-user"`:** the proxy assumes one logged-in user
  per process. Multi-tenant would need a session cache keyed by Cookie hash.
- **Inbox message body is lazy-loaded by 1177:** `messageText` is null in the
  list response. A proper detail fetch (per-id endpoint) is not yet wired.
