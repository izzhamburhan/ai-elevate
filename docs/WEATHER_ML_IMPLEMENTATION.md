# Weather ML implementation and acceptance report

Verified on 12 October 2026 (Asia/Kuala_Lumpur), on local branch `feat/weather-ml-mcp`. No commits or pushes were made. The `main` reference remains `9421f9e924caefbfc7a8bf5b491d63c4af292558`. Existing NetOps source/configuration was not changed; no Hermes Ops or XSSHunter container was stopped, restarted, removed, or modified.

## Delivered architecture

`weather-ml-mcp/` is independently deployable using the approved Docker Desktop engine/Compose plugin. No alternative container runtime was installed. Native Linux ARM64 Python 3.12 loads the pinned `autogluon/chronos-2-small` snapshot through `chronos-forecasting` and CPU PyTorch. Actual tensors produce the forecasts; the existing Next.js agent only orchestrates tools and explains results.

```mermaid
flowchart LR
  Jobs[Explicit bootstrap / ingestion] --> Cache[Persistent model and Parquet volumes]
  Cache --> Weather[Local Chronos CPU + six read-only FastMCP tools]
  NetOps[Existing synthetic NetOps inventory] --> Weather
  Weather --> Agent[Existing Next.js AI agent]
  Weather --> Proxy[Fixed-origin read-only weather proxy]
  Proxy --> Panel[Compact Weather panel]
  Panel --> Kepler[Existing Kepler Redux map]
  Agent --> Bridge[Existing Kepler MCP / SSE bridge]
  Bridge --> Kepler
```

Development publishes only `127.0.0.1:8002`, as approved because an existing SSH listener occupied 8001. The container listens on 8001 with `/mcp` streamable HTTP. Compose project `ai-elevate-weather` owns three persistent volumes: `model-cache`, `weather-data`, `evaluation-reports`. Runtime is non-root UID/GID10001, read-only filesystem/artifact mounts, 2 CPUs and 2.5 GiB limit, dropped capabilities, no-new-privileges, bounded logs, health/readiness checks, and `unless-stopped` restart policy.

Model ID `autogluon/chronos-2-small`, revision `ddec01313e50b6bc58ebaa92ede81bc24a3d9f9a`, weight SHA256 `492290ae82bb89f9769e3479ce90b3179de1f33e600c34daa0352531538b23cd`. Framework `chronos-forecasting==2.3.2`; Linux inference `torch==2.9.1+cpu`. No fine-tuning was performed. Dependency graph and Python/uv multi-architecture base digests are locked. Model/data caches are separate from the image and are never downloaded at server startup.

Explicit Open-Meteo ERA5 ingestion acquired 1,464 hourly records each for Kuala Lumpur, Penang and Johor Bahru, 1 August–30 September 2026. Precipitation, temperature, humidity, pressure, wind and cloud cover are validated with units/provenance/checksums and stored as Parquet. Inference initially uses univariate precipitation and temperature; other variables are cached for a later evaluated covariate experiment.

Default replay cutoff is `2026-09-25T23:00:00Z`; inputs after that time are excluded even though later observations exist in the cache. Outputs carry UTC and MYT valid times, median/q0.1/q0.9 values, acquisition/freshness metadata, nearest-location distance and warnings. Live mode refuses inputs older than six hours. ERA5 is retrospective gridded reanalysis, not an independent station feed; the initial archive cannot support a current live forecast.

The frontend adds a built-in connector and Weather tab without replacing the agent or existing map tools. The panel provides locations, 6/12/24-hour horizons, explicit historical/live mode, precipitation/temperature values, source/model links, a weather exposure legend and layer visibility controls. Weather-owned datasets use the `weather-ml-` prefix; switching/hiding them preserves existing map layers. An opt-in `LOCAL_LLM_REASONING_EFFORT=none` adapter setting was needed for the installed Ollama thinking model's stream; other models and unset behavior remain unchanged.

## Acceptance criteria

PASS means the stated check was actually performed or the delivered artifact was inspected. NOT VERIFIED marks an unexecuted deployment/quality claim; it does not mean a stub forecast is substituted. FAIL identifies a real unmet condition.

| Criterion | Status | Evidence / limit |
|---|---|---|
| Isolated requested branch, main and remote unchanged | PASS | Local feature branch; original main hash; no commits/pushes |
| Existing Next.js / Kepler / NetOps architecture retained | PASS | Additive connector/panel/service; NetOps source diff empty; existing agent still used |
| Existing MCP tools not renamed or removed | PASS | Existing NetOps MCP discovers 62 tools; Kepler original 12 remain; six new weather names do not collide |
| Actual pretrained ML, not LLM-generated weather | PASS | Direct Chronos tensor inference plus 108 backtest calls; existing agent returned the ML tool's structured forecast |
| Published Chronos interface and immutable weights | PASS | Official DataFrame method used; model-card revision and cache hashes verified |
| Python 3.12 ARM64 CPU compatibility | PASS | Actual image reports Linux ARM64, Python 3.12.15, torch2.9.1+cpu, CUDA unavailable |
| Linux AMD64 container execution | NOT VERIFIED | Multi-architecture bases and CPU dependency resolution supplied; AMD64 build/runtime not executed |
| No paid weather/inference service | PASS | Explicit public archive and model downloads; CPU inference/local Ollama agent check; no cloud inference called |
| Docker Desktop exclusively | PASS | Existing desktop-linux engine and Compose used; no alternative runtime installed |
| Independent Compose project and localhost binding | PASS | `ai-elevate-weather`; host 8002 / internal 8001; bound to 127.0.0.1 |
| Existing Hermes Ops / XSSHunter containers preserved | PASS | Existing container IDs retained; all lifecycle commands targeted only new weather resources |
| Locked dependencies, non-root, resource/security limits | PASS | uv.lock + pinned base digests; UID 10001; inspected 2 CPU / 2.5 GiB/read-only/capability settings |
| Container build, startup, health and readiness | PASS | Real Compose build/up; healthy container; `/healthz` and `/readyz` HTTP 200 |
| Structured application/runtime logs | PASS | JSON application/FastMCP/Uvicorn logs; library weight-loading progress is informational startup output |
| Persistent model and data caches | PASS | Exact model/data manifest hashes equal before/after restart; ready after recreation and restart |
| Explicit model bootstrap; no startup downloads | PASS | Bootstrap job acquires pinned snapshot; runtime offline flags + local_files_only; artifact mounts read-only |
| Reproducible separate ingestion and Parquet provenance | PASS | Three real archive acquisitions, request/unit/grid/acquisition/hash manifests; inference does not acquire data |
| UTC normalization and MYT display | PASS | Unit tests, real output timestamps, browser panel showing UTC cutoff 23:00 as MYT 07:00 next day |
| Coordinate/unit/duplicate/missing-record validation | PASS | Automated positive/negative cases; actual cache validation |
| No future observations in context | PASS | Cutoff filtering and causal-context tests; held-out chronological evaluation |
| Honest replay/live separation | PASS | Schema/tool/UI labels; stale live input rejected in real offline-cache check |
| Current live forecast with sufficiently fresh data | NOT VERIFIED | Supplied historical cache is stale; no fresh independent observation feed configured |
| Offline cached inference | PASS | Actual `--network none` container; read-only volumes; socket attempts forbidden; both targets returned valid forecasts |
| Six read-only MCP tools discoverable and callable | PASS | Actual streamable HTTP client discovers all six and invokes every tool; read-only annotations checked |
| Rainfall/temperature at 6/12/24 h | PASS | Both targets called at each horizon over MCP; direct evaluation of every horizon; validated output schema |
| Unavailable model/data never fabricated | PASS | Automated load/error/gap/staleness cases produce explicit errors; no fixture fallback in production |
| Source, model version, freshness, quantiles and warnings | PASS | Pydantic outputs and frontend contracts verified with actual results |
| NetOps geographic exposure join | PASS | 129 actual synthetic inventory sites joined to three cached weather locations; explicit distance/cap warnings |
| Exposure is transparent and not an outage classifier | PASS | Peak hourly median thresholds 2.5/10 mm/hour; synthetic flag and disclaimers; no LightGBM/outage claim |
| AI Elevate receives weather results | PASS | Real Next proxy validates 132 GeoJSON features; existing AI SDK MCP inspection discovers 6 tools |
| Existing AI agent invokes local weather inference | PASS | Local qwen3.5:9b with opt-in thinking disabled called `predict_rainfall`; structured output contained Chronos model ID, replay mode and six hourly points; no paid model used |
| Geography renders in Kepler | PASS | Automated browser generation and visible green weather/site points; saved screenshot |
| Weather visibility / existing layers preserved | PASS | Browser switch and MCP state checks; weather hidden while existing cities layer stayed visible; datasets retained |
| Compact panel and mode/source/unit/legend display | PASS | Browser screenshot/AX checks; table-clipping defect found and corrected |
| Mandatory backtesting and baseline comparisons | PASS | Chronological 60/20/20 split, rolling origins, 108 direct calls, persistence/seasonal 24 h comparison; full actual report retained |
| MAE/RMSE/rainfall error/interval coverage by horizon | PASS | Actual metrics and diagnostics in evaluation report |
| Inference latency and memory measured | PASS | Mean 31.6 ms / p95 35.0 ms warm inference; peak whole-evaluation RSS 535.3 MiB; runtime snapshot 349 MiB |
| Operational forecasting skill / calibrated intervals | NOT VERIFIED | Small reanalysis replay, poor interval coverage in several cases, no independent station holdout |
| Automated backend/frontend tests | PASS | 46 container tests + six frontend tests; frontend lint, TypeScript/production build; deployment/offline checks |
| Root repository is already open-source licensed | FAIL | No root LICENSE/COPYING; public hosting grants no license |
| Upstream selected model/software/data licenses reviewed | PASS | Official sources; 104 installed distributions inventoried; 156 available license/NOTICE files preserved in report volume |
| Application-license assignment and full binary redistribution audit | NOT VERIFIED | Owner approval absent; root/service license not selected; metadata inventory does not prove full wheel/image obligations |
| Docker Desktop itself open source | FAIL | Explicit owner-approved proprietary runtime exception |
| Complete docs/startup/shutdown/troubleshooting | PASS | Service README, this report, evaluation, attribution/license audit, verification scripts |

## Actual verification results

Backend: `docker compose -p ai-elevate-weather run --rm tests` returned **46 passed**, including data/causality/schema/staleness/model/error/offline fixtures, all six MCP tools, HTTP health/readiness, NetOps adapter and GeoJSON. Fixtures are clearly synthetic unit-only inputs. Frontend: `npm run test:weather` returned **six passed**; full ESLint and production build/TypeScript passed. The test command retains an informational Node module-format warning rather than changing the existing package's module semantics.

Real deployment verification called both forecast targets at all three horizons, site prediction, metrics, status and GeoJSON. The map response contains 132 points: three weather locations and 129 synthetic telecom sites. A separate container with networking disabled loaded cached weights/data and predicted both targets. Configuring those same stale inputs as live raised `STALE_OBSERVATIONS` without a forecast.

Next `/api/weather` accepted actual valid output and rejected unsupported 48 h requests. The app's normal `/api/mcp/inspect` connected to the weather server through AI SDK. The existing agent then called `predict_rainfall` through `/api/chat` with a local model and correctly described its output as historical replay. The local thinking-model stream failed before setting the opt-in reasoning option; this is documented and tested rather than replacing the agent.

Browser checks verified visible forecast geography and values, table layout, MYT labels, attribution links, and the visibility switch. Existing Kepler state retained `cities`; disabling weather affected only `weather-ml-low`. Existing NetOps MCP still returned 472 4G, 104 5G and 142 MOCN sites through its original inventory tool. No existing NetOps source files or tool names changed.

![Verified Weather panel and Kepler overlay](weather-ml/weather-overlay.jpg)

## Predictive performance and limits

Read [actual evaluation](WEATHER_ML_EVALUATION.md) and [full numeric/provenance artifact](weather-ml/evaluation-report.json). Three locations,61 days, three test origins per location, and direct 6/12/24 h forecasts are a basic integration backtest, not a national operational validation.

| Target | Horizon | Chronos MAE | Chronos RMSE | Nominal80% interval coverage |
|---|---|---:|---:|---:|
| Precipitation (mm/hour) | 6h | 0.1607 | 0.2796 | 61.1% |
| Precipitation | 12h | 0.2766 | 1.0048 | 53.7% |
| Precipitation | 24h | 0.3735 | 1.0840 | 59.7% |
| Temperature (°C) | 6h | 0.2567 | 0.3283 | 74.1% |
| Temperature | 12h | 0.4773 | 0.7209 | 81.5% |
| Temperature | 24h | 0.9343 | 1.3397 | 56.9% |

Chronos beat both baselines on pooled hourly MAE in 12/12 comparisons. It did **not** win every rainfall diagnostic: seasonal naive had lower wet-hour MAE at 6 h and 24 h, and slightly lower 24 h accumulated-rainfall MAE (8.2778 vs 8.2868mm/window). Rainfall bias and undercoverage are material limitations. Keep this as experimental intelligence; enlarge wet/dry-season origins and locations, obtain an independent station holdout, evaluate past-only covariates, and calibrate intervals on a separate calibration set before stronger claims. No fine-tuning was justified by this small sample.

Historical reanalysis was acquired after replay dates and may contain revisions unavailable at the forecast origin. Application timestamp leakage is prevented; pretrained corpus overlap cannot be ruled out from the model card. Raw quantiles are not rainfall-event confidence, and summing hourly medians does not create a probabilistic accumulated-rainfall estimate.

## Startup, configuration and remaining work

Use [serviceREADME](../weather-ml-mcp/README.md) for exact bootstrap/ingest/evaluate/Compose/verification/shutdown commands. Running development URLs are `http://127.0.0.1:8002/mcp` and `http://127.0.0.1:3001`. The frontend uses `WEATHER_ML_HTTP_URL=http://127.0.0.1:8002`; the built-in connector defaults to that port. NetOps remains independently available on 8000. Local agent verification uses `LOCAL_LLM_MODEL=qwen3.5:9b`, `LOCAL_LLM_REASONING_EFFORT=none`; the existing picker label remains its configured catalog label.

For an open browser map with a generated overlay, the integration verification can also inspect the real Kepler bridge:

```bash
docker compose -p ai-elevate-weather run --rm --entrypoint python tests \
  scripts/verify_deployment.py --url http://weather:8001 \
  --frontend-url http://host.docker.internal:3001 \
  --frontend-mcp-url http://127.0.0.1:8002/mcp
```

The frontend's pre-existing peer-lock inconsistency prevents a clean `npm ci` on this host; the verified no-lock-change workaround is documented in the serviceREADME. It remains a separate reproducibility issue. Existing application hardening/UI redesign was not undertaken beyond the tiny Link lint fix necessary to pass checks.

[License audit](WEATHER_LICENSE_AUDIT.md) explicitly records the missing application license and Docker Desktop exception. No license was chosen on behalf of the owner. [Installed dependency metadata](weather-ml/dependency-licenses.json) and preserved upstream notices are evidence, not a complete binary redistribution clearance. Fresh live observations, independent weather validation, AMD64 execution and a full license decision/review remain **NOT VERIFIED**. The verified deliverable is local historical replay and its working MCP/map integration, not an official/current weather service.
