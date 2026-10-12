# Weather ML MCP

Experimental, local CPU forecasts from `autogluon/chronos-2-small`, using the published `chronos-forecasting` DataFrame interface. No LLM generates weather values. No paid inference or weather API is used. Predictions are not official meteorological forecasts or telecom outage predictions.

The standalone Compose project is `ai-elevate-weather`. On the verified Apple Silicon host, port **8002** was approved because an existing SSH listener occupies 8001. The container listens on 8001; only `127.0.0.1:8002` is published. Set `WEATHER_HOST_PORT` for another host. This project does not operate existing Hermes Ops/XSSHunter containers or alter NetOps container configuration.

## First-time bootstrap

Use the existing Docker Desktop engine and Compose plugin. Do not install another runtime.

```bash
cd /Users/saf/Desktop/Hackathon/ai-elevate/weather-ml-mcp
docker compose -p ai-elevate-weather build
docker compose -p ai-elevate-weather run --rm bootstrap
docker compose -p ai-elevate-weather run --rm ingest \
  --start 2026-08-01 --end 2026-09-30 \
  --locations kuala-lumpur,penang,johor-bahru
docker compose -p ai-elevate-weather run --rm evaluate \
  --data-dir /data --model-dir /models/chronos-2-small \
  --output-dir /reports --origins-per-split 3
docker compose -p ai-elevate-weather up -d
docker compose -p ai-elevate-weather ps
curl --fail http://127.0.0.1:8002/readyz
```

Dependencies are locked in `uv.lock`; Python and uv base images use immutable multi-architecture digests. Linux uses the explicitly selected PyTorch CPU wheel index, including ARM64. ARM64 image execution was verified; Linux AMD64 execution remains unverified.

Bootstrap pins model commit `ddec01313e50b6bc58ebaa92ede81bc24a3d9f9a`, saves its card/config/weights and SHA256 manifest to `model-cache`. Downloads occur only in the explicit bootstrap job. Ingestion stores Parquet and source/request/acquisition/hash manifests in `weather-data`. Evaluation persists in `evaluation-reports`. Inference mounts all three volumes read-only; restarting does not bootstrap or ingest.

The initial ERA5 cache contains 1,464 hourly records per location for August–September 2026. Six curated locations are supported by ingestion: Kuala Lumpur, Penang, Johor Bahru, Kuantan, Kota Kinabalu, and Kuching. Coordinates are WGS84; timestamps are UTC, with Asia/Kuala_Lumpur display times. All six input variable units are validated. Repeated, missing, nonfinite, physically invalid, or misaligned records are detected. Incomplete model contexts are refused, without interpolation or fabricated values.

## Modes and interpretation

Default `WEATHER_MODE=replay`, `WEATHER_REPLAY_CUTOFF=2026-09-25T23:00:00Z`. The inputs end at that cutoff; later cached values cannot enter model context. Outputs have historical valid times and are prominently labeled replay.

`WEATHER_MODE=live` forecasts after the latest cached input and refuses observations older than `WEATHER_FRESHNESS_HOURS` (default 6). The initial archive is deliberately stale for current forecasting. ERA5 has a publication delay and contains retrospective reanalysis, not independent station observations. Genuine live operation needs a separately acquired, sufficiently fresh and appropriately licensed input feed; do not reinterpret API future forecasts as observed context. No live acquisition runs inside inference.

Each output includes model revision/framework/license, source and acquisition time, cache hash, input cutoff, forecast generation and valid times, units, q0.1/q0.5/q0.9, warnings, and proximity to its cached weather location. Rainfall medians/quantiles are clipped at zero and that transformation is disclosed. Raw quantiles are uncalibrated prediction intervals, not rainfall-event or outage probabilities. Accumulated rainfall is the sum of hourly medians, not the median or quantile of accumulated rainfall.

Weather exposure uses maximum hourly median precipitation: low <2.5 mm/hour, elevated >=2.5, high >=10. Thresholds and the maximum cached-location distance (50 km) are configurable. Nearby synthetic NetOps sites inherit the nearest cached location's forecast; this is a coarse geographic exposure overlay, not a site-specific forecast or outage classifier. The default inventory query caps at 200 4G sites and explicitly reports truncation/exclusions.

## Endpoints and tools

- `/mcp`: streamable HTTP, compatible with the existing AI Elevate MCP client.
- `/healthz`: process liveness. `/readyz`: cached model plus data/mode readiness; HTTP 503 when unavailable.
- `/api/status`, `/api/metrics`, `/api/forecast-geojson?region=all&horizon_hours=6`: read-only HTTP.
- `POST /api/predict-sites`: a read-only query accepting site IDs and horizon.

| MCP tool | Inputs |
|---|---|
| `predict_rainfall` | `latitude`, `longitude`, `horizon_hours` (6/12/24) |
| `predict_temperature` | `latitude`, `longitude`, `horizon_hours` |
| `predict_weather_for_sites` | `site_ids` (1–25 exact inventory IDs), `horizon_hours` |
| `get_weather_model_metrics` | None; compact results from actual evaluation |
| `get_weather_model_status` | None; readiness, freshness, mode and locations |
| `get_weather_forecast_geojson` | `region` (all/location/NetOps region), `horizon_hours` |

All tools advertise read-only/non-destructive behavior and write no files during inference. NetOps integration calls only its inventory endpoints. Missing weights/data, stale live inputs, unknown sites and invalid arguments produce structured errors; they never produce invented values.

## AI Elevate integration

The frontend includes a Weather ML built-in connector and compact Weather tab. Defaults are:

```dotenv
NEXT_PUBLIC_WEATHER_MCP_URL=http://127.0.0.1:8002/mcp
WEATHER_ML_HTTP_URL=http://127.0.0.1:8002
```

The fixed-origin `/api/weather` proxy validates requests and forecast responses. The Weather tab offers 6/12/24-hour horizons, cached locations, source/model attribution, replay/live status, exposure legend and a selective weather-layer visibility switch. Existing map/network layers remain available. The existing AI agent remains in place and can invoke the six tools through the normal connector.

For the installed local thinking model, verified agent streaming used `LOCAL_LLM_MODEL=qwen3.5:9b` and opt-in `LOCAL_LLM_REASONING_EFFORT=none`. This uses the existing provider/agent and disables thinking output for that local configuration; unset behavior and cloud providers remain unchanged. Restart the frontend after environment changes and select its local model entry. This setting affects chat orchestration only; all weather values still come from Chronos CPU inference.

For host-run NetOps, Compose uses `WEATHER_NETOPS_URL=http://host.docker.internal:8000`. Linux uses the included host-gateway mapping; a loopback-only Linux host server may need a reachable interface/address configured explicitly. If NetOps is unavailable, standalone cached location forecasts still work and the overlay reports the missing inventory.

## Repeatable cached pitch

After first-time bootstrap/ingestion, keep the existing NetOps server on 8000 and cached Ollama model running. These commands operate only Weather ML and this frontend; they never seed/reset a database or download model/data during startup:

```bash
cd /Users/saf/Desktop/Hackathon/ai-elevate/weather-ml-mcp
# Prepare this production build before the pitch (font acquisition may need Internet).
bash scripts/demo.sh build
# Start only the cached Weather container and the frontend on localhost:3001.
bash scripts/demo.sh start
# In a second terminal, after opening Weather and generating its overlay:
bash scripts/demo.sh check
```

The script defaults to the already-cached `qwen3.5:9b` agent model; set `LOCAL_LLM_MODEL` and optionally `NEXT_PUBLIC_LOCAL_LLM_LABEL` before **both build and start** to use a different installed local model. `WEATHER_DEMO_FRONTEND_PORT` changes the frontend port if necessary. An occupied port is an error; no unrelated process is stopped. The script uses the existing Docker Desktop/Compose engine, `--no-build --pull never`, and replay cutoff `2026-09-25T23:00:00Z`. It requires prebuilt images/artifacts and fails explicitly when dependencies are unavailable.

`NEXT_PUBLIC_WEATHER_DEMO_MODE=1` is baked into the frontend build: it selects Kepler's `no_map` basemap, a bundled coarse public-domain Natural Earth outline, and the existing local-model picker entry. Normal mode retains CARTO basemaps, which require Internet. Next fonts are self-hosted in the prepared build. Attribution links can still require Internet when clicked. A full browser test with all Internet access disabled remains a separate verification limit; network-disabled Chronos inference is tested directly.

For a deterministic walkthrough, choose **all cached locations / 24 hours**, generate the overlay, and explain the valid period **26 September 2026 UTC / 26 September 08:00–27 September 07:00 MYT**. Approximate totals are Johor Bahru **1.179 mm**, Kuala Lumpur **0.753 mm**, Penang **1.439 mm**. All exposure categories are **low** at the documented thresholds; do not invent a flood/outage scenario or lower thresholds to suggest a model success. Coordinates and telecom site IDs come from the existing synthetic NetOps inventory, joined to nearby cached real ERA5 locations. This join does not establish historical telecom incidents at the weather replay time.

An agent smoke prompt is: “Call predict_rainfall for latitude 3.139, longitude 101.6869, horizon_hours 6. State the mode and model, and explain that this is historical replay.” Enable Weather ML in Connectors. The separate Menara Weather connector contains synthetic scenario data; do not portray its values as Chronos predictions.

To repeat: reload the page, reopen Weather, and regenerate the same selection; use **New chat** for a fresh conversation. This clears only transient map/session state. Existing browser chat history, databases, caches and containers are retained. Stop the foreground frontend with Ctrl+C; `docker compose -p ai-elevate-weather stop weather` stops only Weather. Restart with `bash scripts/demo.sh start`. Never invoke a Menara reset or `down -v` for this walkthrough.

Upstream `main` relocated NetOps source to `backend/netops-mcp/`; its code and Menara integrations are preserved. This Mac's previously running NetOps process and database under `netops-mcp/data/` were left intact. If a future NetOps restart is needed, explicitly point `NETOPS_DB_PATH` at that existing database when running the relocated source. Do not run a seeding command over the preserved database.

## Verification

```bash
docker compose -p ai-elevate-weather run --rm tests
docker compose -p ai-elevate-weather run --rm --entrypoint python tests \
  scripts/verify_deployment.py --url http://weather:8001
docker compose -p ai-elevate-weather run --rm --entrypoint python tests \
  scripts/license_inventory.py
```

Actual offline verification, with every network connection prohibited and caches read-only:

```bash
docker run --rm --network none --read-only --memory 2560m --cpus 2 \
  --tmpfs /tmp:size=256m,mode=1777 \
  -e WEATHER_MODE=replay -e WEATHER_REPLAY_CUTOFF=2026-09-25T23:00:00Z \
  -v ai-elevate-weather_model-cache:/models:ro \
  -v ai-elevate-weather_weather-data:/data:ro \
  ai-elevate-weather-ml:0.1.0 python scripts/verify_offline.py
```

`verify_deployment.py` needs running NetOps and a cached successful evaluation report. It calls all six MCP tools, exercises both targets at all three horizons, validates GeoJSON and joins a real inventory response. Unit fixtures are deterministic synthetic test cases, never reported as observed weather.

Read [implementation/acceptance report](../docs/WEATHER_ML_IMPLEMENTATION.md), [actual ML evaluation](../docs/WEATHER_ML_EVALUATION.md), and [license audit](../docs/WEATHER_LICENSE_AUDIT.md). The small replay evaluation is not evidence of operational weather accuracy. Quantile calibration needs further work.

## Operations and troubleshooting

```bash
docker compose -p ai-elevate-weather logs -f weather
docker compose -p ai-elevate-weather restart weather
docker compose -p ai-elevate-weather stop weather
docker compose -p ai-elevate-weather up -d
# Remove only this project's containers/network while retaining caches:
docker compose -p ai-elevate-weather down
```

Do not use `down -v` unless intentionally discarding this project's caches. No instruction here stops unrelated containers. Runtime is UID/GID10001, with a read-only root filesystem, dropped capabilities, no-new-privileges, 2 CPU/2.5 GiB limits, bounded logs and a restart policy. It was measured below those memory limits on the approved Docker Desktop host.

- Readiness 503: inspect `/api/status`; explicitly bootstrap missing/corrupt weights or ingest missing data. Start period allows model imports/checksum verification.
- Stale live data: use labeled replay or supply a fresh licensed observation dataset through the separate pipeline. Increasing the freshness limit does not make historical data current.
- Unsupported location: acquire that curated location explicitly or choose an existing cache; no global weather interpolation is implemented.
- Port conflict: set `WEATHER_HOST_PORT` and both frontend weather URL variables; leave the existing listener untouched.
- No site overlay: check the configured NetOps URL and cached-location distance. Synthetic site coverage is intentionally limited and labeled.
- No metrics: run the evaluation job. Full report is `/reports/report.json`; MCP returns a compact summary.
- Local agent reports a stream ending without a finish reason: for compatible Ollama thinking models, set the opt-in reasoning effort to `none` and restart the frontend. The installed qwen3.5:9b configuration was exercised through the existing `/api/chat` route and weather tool.
- Frontend installation: the pre-existing lock has unresolved peer entries for `npm ci` on this host. Verified fallback without changing dependency declarations/lock: `npm install --package-lock=false --legacy-peer-deps`, then `npm install --no-save --package-lock=false --legacy-peer-deps @deck.gl/mapbox@9.3.11`. Frontend lock repair is a separate unresolved repository issue.

No repository application license was selected or modified. Upstream model/dependency licenses and data attribution are audited in `ATTRIBUTIONS.md` and the license report. Docker Desktop is the owner's approved proprietary runtime exception. Open-Meteo's free hosted API is restricted to non-commercial use; data CC BY4.0 and access terms are separate.
