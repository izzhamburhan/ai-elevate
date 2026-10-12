# Hermes Multi-Agent Foundation — Order 2

This implementation adds four independent, persistent Nous Research Hermes profiles to AI Elevate. The existing agent, Weather ML, NetOps, Kepler, Menara, HEAL and frontend pages remain intact. It does not implement the separate UI redesign, network predictive models, footfall models, business ML or deferred production hardening roadmap.

## Architecture

```text
AI Elevate /workspace · Hermes panel
              │ same-origin /api/hermes
              ▼
Next.js server-side validated adapter
              │ configured HERMES_API_URL (localhost:8011)
              ▼
Independent ai-elevate-hermes Docker project
  FastAPI investigation coordinator + SQLite evidence ledger
              │ native isolated Hermes worker processes
              ├─ orchestrator → delegate_specialist
              ├─ forecast     → 6 approved Weather ML tools
              ├─ business     → 7 approved geographic/inventory tools
              └─ engineer     → 13 read-only diagnostic NetOps tools
                          │ restricted validated MCP gateway
                          ├─ existing Weather ML localhost:8002
                          └─ existing NetOps localhost:8000

All workers → local /ollama/v1 transport adapter → native Ollama /api/chat
             existing qwen3.5:9b localhost:11434
Source-backed geographic points → existing Kepler command bridge
```

Four profiles share one lightweight container but never load different Hermes homes in the same worker process. A worker sets `HERMES_HOME=/state/profiles/<agent_id>` before importing Hermes, because the native framework captures profile paths at import time. The API serializes turns per profile and runs one investigation at a time to bound local resource use. Coordination and specialist sessions are distinct; all factual MCP evidence is recorded separately from private agent memory.

The coordinator provides asynchronous investigation creation/polling rather than holding a Next.js request open during local inference. A local `delegate_specialist` tool starts an actual specialist Hermes worker and returns its status, summary, source references and warnings. The specialist receives the user's original request alongside the Orchestrator's task wording, so a vague paraphrase cannot steer it away from its skill procedure or widen its tools. It cannot access the specialist's private memory. Internal activity/evidence/delegation routes require an active task and a per-investigation worker token. Specialist prose without a successful MCP call is marked failed rather than accepted as verified findings. Two deterministic report checks run after every turn: process narration the local model writes before its first `##` heading is dropped (recorded as `runtime.narration_trimmed`), and a report that names an approved tool the task never executed gets an explicit warning that those statements are unverified.

Two small integration adapters are used. The coordination adapter adds an application-specific specialist delegation/evidence ledger around native `AIAgent`, profile creation, SOUL loading, memory, skills and sessions. The model transport adapter translates Hermes chat-completions requests into Ollama's documented native `/api/chat` format so a per-request context window is actually applied. Both preserve real Hermes reasoning and real local model/tool execution. Built-in broad delegation, shell, filesystem, browser, web and scheduling bundles are not enabled.

## Verified framework and licensing

| Item | Selection / evidence |
|---|---|
| Official framework | [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) |
| Pinned release/revision | `v0.21.7`, `71d34bad1045610252eda02ee79549436896e784` |
| Source archive SHA-256 | `a88ae3f634a3fd45050d3418d80b30ee5af51c89b9de40ec1ea3039d3024d77a` |
| Upstream license | [MIT at the pinned revision](https://github.com/NousResearch/hermes-agent/blob/71d34bad1045610252eda02ee79549436896e784/LICENSE); retained at `/opt/hermes/LICENSE` in the image |
| Python | Pinned image's Python 3.14 runtime; actual ARM64 image reports Python 3.14.8 |
| Installation | Official checksum-verified source under `/opt/hermes`; locked core dependencies in `uv.lock`; no unsupported Hermes wheel |
| Local reasoning | Existing native Ollama `qwen3.5:9b`, through the container-local chat-completions/native-Ollama adapter with thinking disabled per request |
| ML weather | Existing local Chronos-2 Small service, preserved without reimplementation |
| Runtime exception | Docker Desktop is the user's approved proprietary host runtime |

The framework API and profile structures were checked against the pinned official implementation, particularly [native profile creation](https://github.com/NousResearch/hermes-agent/blob/71d34bad1045610252eda02ee79549436896e784/hermes_cli/profiles.py), [the actual agent loop](https://github.com/NousResearch/hermes-agent/blob/71d34bad1045610252eda02ee79549436896e784/run_agent.py), SOUL/system-prompt handling, [native memory](https://github.com/NousResearch/hermes-agent/blob/71d34bad1045610252eda02ee79549436896e784/tools/memory_tool.py), skills, sessions and tool registration. Current upstream functionality beyond this pinned revision is not assumed.

Ollama's [native chat API](https://docs.ollama.com/api/chat) accepts messages, function tools, runtime options and `think`. Its [context documentation](https://docs.ollama.com/context-length) explains the memory cost of larger contexts and how to inspect actual allocation. [OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility) covers only a subset of the client protocol. Initial calls through the host's compatible route ignored the requested `options.num_ctx` and stayed at 32768; the new `/ollama/v1/chat/completions` adapter sends real native `/api/chat` requests with `options.num_ctx=65536`, bounded output and `think=false`. Five actual `/api/ps` samples confirmed 65536 afterward. The adapter wraps only completed real replies, including actual tool calls and token-usage counts. Its optional streaming envelope is emitted after the native reply completes, so it is not token-by-token live streaming. No host model, global Ollama settings, weights or daemon are modified.

No repository/application license has been added. Public repository visibility does not license the application's original code. The owner must approve a root license after contributor-rights review. Hermes's retained MIT notice and the existing Weather license/data attribution obligations still apply. A complete transitive dependency/image redistribution audit remains NOT VERIFIED; see the existing [Weather license audit](WEATHER_LICENSE_AUDIT.md) for previously documented obligations.

## Profiles, skills, memory and sessions

| Profile | Identity and dedicated skill | Approved capabilities |
|---|---|---|
| `orchestrator` | Strategic telecommunications coordinator; `elevate-coordination` | Actual specialist delegation, evidence synthesis, private memory and read-only skill discovery |
| `forecast` | Cautious meteorological analyst; `elevate-weather-replay` | Real Weather ML status, rainfall/temperature/site forecasting, metrics and geographic exposure |
| `business` | Evidence-driven commercial strategist; `elevate-geographic-suitability` | Existing Malaysian geographic and synthetic network inventory comparisons; explicit missing demand/cost evidence |
| `engineer` | Read-only RAN/NOC engineer; `elevate-readonly-network-diagnosis` | Existing synthetic inventory, RAN KPIs, congestion, incidents, maintenance records and coverage (no weather tools; Forecast owns weather evidence) |

Each native profile has:

```text
/state/profiles/<agent_id>/
  SOUL.md
  config.yaml
  deployment.json
  skills/<dedicated-skill>/SKILL.md
  memories/MEMORY.md
  memories/USER.md
  state.db                       # native Hermes sessions
```

`initialize_profiles` uses native `create_profile(no_alias=True, no_skills=True)`. `SOUL.md`, the dedicated skill and `config.yaml` are deployment-managed role identity and are refreshed from `hermes-multi-agent/profiles/` on every start. Private `memories/` and the native `state.db` session database are only seeded when absent and otherwise preserved. Seeds contain known capability/limitation notes and clearly say that no previous investigation has occurred; they contain no fictional execution history.

Hermes v0.21.7 normally collapses large tool catalogs behind `tool_search`/`tool_describe`/`tool_call`, which would let a model reach tools by name outside the schema list. Each profile config sets `tools.tool_search.enabled: off`, so the explicit allowlisted schemas are the whole surface. Only native `memory`, `skills_list`, `skill_view`, and approved role tools reach each `AIAgent`. Native skill mutation is excluded. The worker validates its actual registered tool list and checks the role's SOUL heading in its built system prompt before reasoning. After a turn, the adapter uses the native Hermes memory tool to retain a concise investigation/task reference and actual outcome. Factual network and weather records remain in their existing services and the structured evidence ledger.

## MCP permissions and evidence

The gateway discovers actual registered schemas using FastMCP and validates arguments against them. Permission checks occur before any network call. Explicit destructive tool annotations are rejected. Tools are not approved simply because their name starts with `get_`.

| Agent | Exact approved external tools |
|---|---|
| Forecast / Weather | `predict_rainfall`, `predict_temperature`, `predict_weather_for_sites`, `get_weather_model_metrics`, `get_weather_model_status`, `get_weather_forecast_geojson` |
| Engineer / NetOps | `get_sites`, `search_sites`, `get_site_info`, `get_site_cells`, `get_ran_site_info`, `get_ran_kpi`, `get_ran_kpi_summary`, `get_worst_cells`, `get_congested_cells`, `get_ntt_tickets`, `get_ntt_summary`, `get_coverage_layer`, `get_plan_maintenance` |
| Business / NetOps | `get_sites`, `get_site_info`, `search_locations`, `list_location_categories`, `lookup_admin_area`, `list_admin_areas`, `get_admin_boundary` |
| Orchestrator | No direct source-service access; local `delegate_specialist` with only the three specialist IDs |

Ticket writes/deletes, email, attachments, unrestricted subscriber data, shell and arbitrary agent-selected URLs are absent. Gateway responses carry `{ok, data, error, warnings, source}`. Provenance includes service/tool, retrieval time, read-only status, data class and an untrusted-response marker. Weather model/replay timing metadata is retained. Normal tool invocation never bootstraps weights or alters source datasets.

The ledger preserves original raw results, arguments, execution timestamps, actual Hermes profile identity and source references. The model receives a bounded copy for context use; truncation is disclosed and does not mutate the full evidence. Numeric map coordinates come only from successful validated MCP outputs, never by interpreting agent prose. Failed calls create no map evidence.

## Demonstration scenario and labels

The repeatable investigation uses actual existing synthetic 4G sites around Shah Alam and the cached Chronos historical replay. For example, NetOps returns `CB5348` at `3.057310, 101.524117` and `CB7552` at `3.061262, 101.515552`. These are existing synthetic telecom identities with realistic Malaysian coordinates; the implementation does not reset, reseed or invent a replacement inventory.

Network dates should be explicitly pinned to September 25–26, 2026, inside the current RAN available range. The existing KPI service provides daily/weekly/monthly metrics, so it cannot establish evening-hour congestion patterns from hourly telemetry. Inventory status and congestion snapshots may describe different dates; those differences must be disclosed.

Weather model context ends September 25, 2026 at 23:00 UTC and predicts September 26 UTC. Cached weather observations are real ERA5 gridded historical reanalysis obtained through Open-Meteo, with source attribution. Chronos medians/quantiles are actual local ML research predictions. They are not official forecasts, current conditions, calibrated rainfall-event probabilities or outage forecasts. A low-rainfall result remains low rainfall.

Valid cached Weather geography selections include `all`, `kuala-lumpur`, `penang`, `johor-bahru`, their cached names, and matching cached NetOps regions. Shah Alam is not a cached weather-location ID; use the appropriate nearby Kuala Lumpur/Central geography and disclose the grid-to-site distance. Six, twelve and twenty-four hour horizons retain existing validation.

Business can query actual synthetic inventory around KLCC, Bukit Bintang and Bangsar. Optional real POI and administrative datasets are currently missing in the existing NetOps runtime; their tools return explicit `upstream_error` responses. This foundation does not silently fabricate places, events, attendance, crowd counts, measured demand or validated revenue. A business recommendation based on network-location evidence is a limited agent recommendation requiring permissions, measured demand and cost checks.

Repeated replay uses identical cached weather inputs and deterministic telecom records. The local LLM's prose, tool ordering, session/memory references and elapsed time can vary. Three successful consecutive actual investigations must be recorded to qualify repeatability; identical wording is not promised.

## Docker and startup

The independent project is `ai-elevate-hermes`. It contains one native ARM64 runtime with four isolated native profile homes and worker processes. The source build uses digest-pinned Python/uv images and a locked dependency graph. Native AMD64 manifests exist, but actual AMD64 deployment is NOT VERIFIED.

The service is non-root UID/GID 10001, localhost-only `127.0.0.1:8011`, with a read-only root, persistent `/state`, a bounded temporary directory, two CPU allocation and 1536 MiB memory limit. Its restart policy is `unless-stopped`. Health checks test API liveness; `/readyz` separately reports Ollama/model, Weather and NetOps reachability plus profile readiness. Health alone does not prove inference.

Persistent state lives in Docker's `ai-elevate-hermes_state` volume. It contains four private native profiles, sessions, the coordinator's `investigations.sqlite` ledger, and private worker logs under `/state/runs`. Logs and full evidence are local state, not automatically committed artifacts. Schedules are disabled by default and no Hermes cron/gateway process is started.

Docker-to-host connectivity has been tested rather than assumed. The new service uses `host.docker.internal` for existing native Ollama, NetOps and Weather. It does not expose those services to the LAN, modify Hermes Ops Portal or gateway `10.44.18.213`, change tunnel port 18002, or touch XSSHunter/PostgreSQL containers.

```bash
cd /Users/saf/Desktop/Hackathon/ai-elevate/hermes-multi-agent
./scripts/dev.sh build
./scripts/dev.sh up
./scripts/dev.sh check
./scripts/dev.sh status
```

Hermes needs the existing host services. NetOps is not containerised; start it read-only against the existing seeded synthetic database (seed 42, reference date 2026-10-12, not reseeded):

```bash
cd /Users/saf/Desktop/Hackathon/ai-elevate/backend/netops-mcp
uv sync
NETOPS_DB_PATH=../../netops-mcp/data/netops.duckdb NETOPS_READ_ONLY=1 \
  uv run python -m netops_mcp.server --http      # http://127.0.0.1:8000/mcp
```

The seeded `netops.duckdb` lives in the git-excluded legacy `netops-mcp/data/` folder at the repository root; `backend/netops-mcp/data/` is empty on this machine. Weather ML runs in its own `ai-elevate-weather` Compose project on 8002. The frontend runs on 3001 with `npm run dev -- -H 127.0.0.1 -p 3001`.

Optional settings are documented in `.env.example`. The startup script checks the selected published port and refuses to displace another listener. It operates only the new Compose project.

For the Next.js server, use server-only `HERMES_API_URL=http://127.0.0.1:8011` and the existing frontend startup convention. Open the `/workspace` Hermes panel. An already running frontend is not terminated by the startup script. Build-time fonts should be cached/prepared while online; the existing offline Weather outline can be retained, while normal basemap providers still require network access.

```bash
./scripts/dev.sh logs
./scripts/dev.sh restart
./scripts/dev.sh check
./scripts/dev.sh stop
```

Stopping/restarting only this project preserves its volume. Do not use `down -v`. In-flight tasks are marked interrupted after restart and must be resubmitted; they are not falsely marked complete. Other containers, SSH listeners and source databases are untouched.

## Frontend and future integration contracts

The new Next.js route is `/api/hermes`:

| Operation | Browser/server contract |
|---|---|
| Agent status | `GET /api/hermes?action=agents` → four identities, availability, capabilities, warnings |
| Start investigation | `POST /api/hermes` with `{agent_id, prompt, session_id?}` → investigation ID and queued status |
| Poll investigation | `GET /api/hermes?action=investigation&id=<id>` → tasks, summaries, errors, source references and optional GeoJSON |

The route uses a fixed configured server origin, validates known agent IDs and request/response schemas, and rejects cross-origin browser writes. It does not introduce a separate authentication system or expose credentials to the browser. The underlying local API is a development-local boundary, not a production authentication deployment.

The compact map panel adds agent selection, readiness, actual task/tool activity, summaries and explicit errors. Session references stay separated by agent. `Show findings on map` uses the existing Kepler command bridge. It replaces only `hermes-investigation-findings`; Weather, HEAL and per-chat datasets remain intact. WGS84 point features retain synthetic/source labels and timestamps.

Orders 4/5 can later contribute source-validated evidence using the existing investigation envelope: investigation/task IDs, agent identity, execution time, source references, raw structured results, warnings and optional GeoJSON. Existing site/cell IDs and UTC timestamps should be retained, and source records must explicitly distinguish synthetic telecom, real geography, historical weather, ML predictions and recommendations. New model tools require explicit schema and permission review before registration. No future predictive model or fake crowd/revenue inference is implemented here.

## Qualification commands

```bash
cd /Users/saf/Desktop/Hackathon/ai-elevate/hermes-multi-agent
docker compose -p ai-elevate-hermes exec -T hermes python -m pytest -q /app/tests

python3 scripts/verify_runtime.py \
  --url http://127.0.0.1:8011 \
  --frontend-url http://127.0.0.1:3001 \
  --runs 3 --timeout 1200 \
  --agents-smoke business,engineer \
  --report /tmp/ai-elevate-hermes-qualification.json

cd /Users/saf/Desktop/Hackathon/ai-elevate/frontend
npm run test:weather
npm run test:hermes
npm run lint
npm run build
```

The runtime script checks actual successful tool execution, native Hermes/SOUL metadata, timestamps, source references, map coordinates and the optional Next.js boundary. Mock fixtures and static profile files never qualify real runtime execution. Existing Weather regression tests remain separate and must also pass.

## Qualification record — 2026-10-12 (final)

All rows below are actual local executions on the Apple Silicon MacBook unless marked otherwise. Unit-test fixtures are counted only as unit tests, never as runtime evidence. Full JSON reports were written by `scripts/verify_runtime.py`; they are local evidence, not committed.

| Required check | Status | Evidence |
|---|---|---|
| Hermes Docker build, start, health | PASS | ARM64 image rebuilt; `ai-elevate-hermes-hermes-1` healthy on `127.0.0.1:8011`; `/readyz` ready with Ollama, Weather and NetOps reachable |
| Four agent profiles | PASS | Four native homes under `/state/profiles`; every completed task reports `runtime.profile`, `soul_loaded=true` and its own dedicated skill |
| Each SOUL loads in real reasoning | PASS | Worker checks the SOUL heading inside the built Hermes system prompt before inference; true for all four roles in final runs |
| Dedicated skills available only to their agent | PASS | `skills_loaded` = `elevate-coordination` / `elevate-weather-replay` / `elevate-geographic-suitability` / `elevate-readonly-network-diagnosis` |
| Ollama inference (`qwen3.5:9b`) | PASS | All agent turns run through the native `/api/chat` adapter with real tool calls |
| Weather MCP execution | PASS | Forecast executed `get_weather_model_status` + `get_weather_forecast_geojson(region="kuala-lumpur", horizon_hours=6)` in every run (Chronos-2 Small, historical replay context ending 2026-09-25 23:00 UTC) |
| NetOps MCP execution | PASS | Engineer executed `get_sites` (Shah Alam, 4G), `get_ran_kpi` (CB5348/CB7552/CB8519, 2026-09-25) and `get_ntt_tickets` (2026-09-25–26, 0 tickets) in every final run; reported KPI values match raw records (e.g. CB5348 PRB 44.947 %) |
| Orchestrator delegation | PASS | Each run has distinct Orchestrator, Forecast and Engineer tasks, each with its own native session ID |
| Three consecutive successful investigations | PASS | Through the Next.js `/api/hermes` proxy with the verbatim demo prompt: `f3f1df4f…` 349.8 s, `787dee27…` 365.5 s, `7aac4fa9…` 384.1 s; all `completed`, 177 source-backed points each, zero ungrounded tool claims |
| Business independent geographic analysis | PASS | Direct smoke `29e55516…` completed in 97.4 s using `get_sites` for KLCC / Bukit Bintang / Bangsar, 30 mapped sites, no invented demand or revenue; a UI run (`bccecef4…`) mapped 50 sites |
| Forecast / Engineer direct smokes | PASS | `99c494f3…` (129.8 s, 177 points); `e2d86377…` (118.7 s, all three NetOps tools) |
| Memory persistence across restart | PASS | Two container recreations: `/readyz` memory SHA-256, byte counts and session counts identical before/after for every profile (the single deliberate Engineer seed-line edit excepted) |
| Memory isolation | PASS | Each profile's `MEMORY.md` contains only its own investigation references (strictly diagonal count); no worker has file, shell or another profile's memory tool |
| Tool allowlist enforcement | PASS | Live gateway against the real services: Engineer→`predict_weather_for_sites`, Engineer→`create_ntt_ticket`, Forecast→`get_sites`, Business→`get_ran_kpi`, Orchestrator→`get_sites` all `PERMISSION_DENIED` before any connection; approved calls succeed. `tool_search` disabled; worker rejects unexpected registered tools |
| Unavailable-service behaviour | PASS | With NetOps stopped: `/readyz` `ready=false`, Engineer/Business unavailable, UI start disabled; a direct API submission failed with `MCPDiscoveryError`, no tool calls and no map output |
| Interrupted-run recovery | PASS | An in-flight run during redeploy was marked `failed` — "Service restarted during this investigation; submit again. No completion is implied." |
| Frontend integration | PASS | `/workspace` → Agents tab on `127.0.0.1:3001`: four-agent readiness, agent selection, live task/tool status, summaries, sources, warnings; Orchestrator (`3b86940b…`) and Business runs submitted from the browser |
| Kepler map integration | PASS | "Show findings on map" loaded 177 points (Orchestrator) and 50 points (Business) as the `hermes-investigation-findings` layer over Kuala Lumpur/Selangor |
| Backend automated tests | PASS | 38 passed (foundation, MCP access, Ollama adapter; fixtures only) |
| Frontend automated tests | PASS | `test:hermes` 6/6, `test:weather` 8/8 |
| Weather regression tests | PASS | Weather Python suite 46/46 in its running container + 8 frontend = 54 |
| Frontend lint and production build | PASS | `eslint` clean; `next build` compiled all routes including `/api/hermes` (one pre-existing `providers.ts` tracing warning) |
| Existing containers and tunnels preserved | PASS | Only `ai-elevate-hermes-hermes-1` was recreated; other container IDs unchanged |
| AMD64 deployment | NOT VERIFIED | Manifests exist; not run |
| Business with real POI/boundary data | NOT VERIFIED | Optional Parquet files absent; `search_locations` returns an explicit upstream error |

Defects found and fixed during this qualification:

1. Engineer used its two weather tools instead of NetOps KPIs and ran into the 240 s timeout. Weather tools were removed from Engineer (Forecast owns weather) and its skill now always runs `get_sites` → `get_ran_kpi` → `get_ntt_tickets`.
2. Engineer's final answer leaked unfinished reasoning ("The response is truncated… Let me parse…"). Reports must start with a `##` heading; any preceding narration is dropped and flagged.
3. Engineer claimed a `get_ntt_tickets` result it never executed, and the Orchestrator repeated it. The NTT call is now a required step, and a deterministic ledger check warns on any report naming an unexecuted approved tool.
4. Orchestrator paraphrases (e.g. "get_network_exposure for Selangor") misled specialists. Specialists now also receive the original user request.
5. SOUL/skill template changes never reached existing profiles (only absent files were seeded). SOUL and skills are now refreshed on start; memory and sessions are untouched.
6. `/api/hermes` POST returned 403 for a browser on `127.0.0.1:3001` because Next dev reports `request.url` as `localhost`. The same-origin check now compares against the `Host` header; cross-origin is still rejected.
7. Repeated synthetic-data warnings produced duplicate React keys in the panel; warnings are now de-duplicated.
8. Specialist turns of 100–240 s exceeded the 240 s budget; defaults are now 360 s per task and 1080 s per investigation.

Earlier Codex-era records (`cea3022d…` and before) and run `aaaa1bef…` (pre-fix, 574.5 s) are not counted. The intermediate run `20484165…` passed but preceded fixes 3, 5 and 7 and is also not counted.

## Integration with main — 2026-10-12

`origin/main` (Orders 4/5 netintel/mlpredict, unified workspace design, subscriber trail playback) was merged into this branch without conflicts. The only shared file, `kepler-panels.tsx`, keeps main's glass fullscreen layer and phone collapse button alongside the Agents tab. The new MCPs use ports 8125/8126 and do not touch 8011 or Hermes code.

Integration qualification found one pre-existing defect: after about ten investigations every private memory reached the native 2,200-character limit and `memory_saved` became false (reported as a warning, not hidden). The worker now rotates the oldest investigation references until the new one fits.

On the integrated code: backend 38/38, Weather 46/46 + 8, Hermes frontend 6/6, lint clean, `next build` (including TypeScript) passes; all four profiles ready; orchestrated investigation `81c713c5…` PASSED through the Next.js proxy in 361.7 s (Forecast and Engineer with all their tools, 177 points, no ungrounded claims, `memory_saved=true` for every agent); a browser-submitted Business run `41b21b45…` mapped 50 sites on Kepler; memory and sessions persisted across the container recreation.

## Known limitations and troubleshooting

- An orchestrated investigation takes about 6 minutes locally (Forecast ~1.6–1.9 min, Engineer ~1.8–2.3 min, Orchestrator reasoning ~2 min); one investigation runs at a time and later submissions queue. Timeouts and incomplete specialist tasks are reported explicitly.
- LLM prose can still be imprecise even when every number is grounded, e.g. "no heavy rainfall event" where the evidence is "none predicted", or a Forecast column labelled median that holds the six-hour total. The raw ledger is authoritative; the ungrounded-tool check catches invented tool results but not wording.
- The demo is bounded: Shah Alam (3 sites) represents Selangor for network KPIs, and the Forecast map covers the 177 Kuala Lumpur-grid features. Weather and network evidence are joined geographically by the Orchestrator's narrative, not by a site-level weather join.
- The ungrounded-tool warning is conservative: a report that merely says a tool "was not invoked" is also flagged.
- NetOps runs as a host process, not under Compose, and must be started separately (see Docker and startup).
- Optional POI/boundary source files are absent; business geographic recommendations currently rely on available synthetic telecom inventory. No measured crowd, event attendance, revenue, footfall model or outage classifier is supplied.
- Weather is cached historical replay. Forecast interval calibration, operational live meteorological validation and full browser airgap behavior retain the existing documented limitations.
- The 65536 context is verified through the narrow native-Ollama adapter and increases native model memory to about 7.60 GiB outside Docker. The original compatible route ignored context options; that compatibility issue is resolved without reconfiguring or restarting the host daemon. Only the required text/function-tool protocol is implemented; multimodal input is unsupported, and streaming waits for a completed native reply.
- Private profile memories are concise and bounded (2,200 native characters, about ten investigation references); when full, the worker removes the oldest `Investigation …` reference through the native memory tool before adding the new one. Seed identity notes are never rotated. They are not a factual database. Shared findings use explicit task results. One writer per profile prevents concurrent native memory/session conflicts.
- The local API is deliberately localhost-bound; production authentication, internet deployment, retries, scaling and full security hardening are outside Order 2.
- Build/setup can require internet for pinned source/dependencies and existing frontend fonts. Cached runtime investigation calls use local Ollama/MCP; normal basemaps can still use external providers.
- If readiness is false, inspect `./scripts/dev.sh logs`, the reported service, and configured Docker-to-host URLs. Do not reset source databases or terminate protected listeners. If port 8011 is occupied, use a verified available port in this project's `.env` and matching Next.js server URL.
- Restart during a task marks it interrupted. Wait for readiness and resubmit; completed evidence and memories remain in the volume.

## Files and Git

New service files are contained in `hermes-multi-agent/`: Docker/Compose/config/lock files, four profiles, initializer, actual worker, restricted MCP gateway, investigation API/ledger/contracts, tests and startup/qualification scripts. Frontend changes are limited to the Hermes route/contracts/map overlay/panel, map-tab registration, environment example and test script. This report is new documentation.

Implementation branch: `feat/hermes-multi-agent`. Initial base: `7b23a4897ee738ce9c72b1d273b20ef07f0b1d40`, preserving the prior Weather merge `bba884e1e9828ad27e7691d1306ad19a50cb874b` and newer upstream fullscreen/data-MCP work. As of 2026-10-12 neither local `main` nor the last-fetched `origin/main` has commits beyond this base (no new fetch was made). The Order 2 work is committed locally on this branch; nothing is pushed or merged without the user's explicit approval. Startup/runtime state that is deliberately not committed: the Docker `ai-elevate-hermes_state` volume (memories, sessions, ledger, worker logs), the git-excluded `netops-mcp/data/netops.duckdb`, and local qualification JSON reports.
