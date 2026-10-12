# Predictive ML Ecosystem (Order 5)

Order 5 trains and serves five local machine-learning models on one CPU inference server, `backend/mlpredict-mcp` (port **8126**). The models answer:
- crowd and footfall forecasts;
- the best areas for a temporary sales booth;
- which sites risk an outage in the next 24 hours;
- hourly congestion forecasts up to a week ahead;
- network anomaly detection.

The models are LightGBM and an Isolation Forest (scikit-learn). Every number comes from model inference; no LLM produces any of them.

**All data is synthetic. Every metric below is a synthetic benchmark:** it shows the pipeline works and how each model compares with a simple baseline on held-out later data. It does not measure real-world accuracy.

## Architecture

```
netops.duckdb ──► netintel_mcp.seed ──► intel.duckdb (intel-v2: 60 days hourly KPIs, outages, alarms, areas, events)
                                             │
                                             ├──► mlpredict_mcp.data  ──► ml.duckdb (ml-v1: footfall, rain, holidays, booth outcomes)
                                             │                                 │
                                             └──────────────► mlpredict_mcp.train ──► backend/data/models/ (5 models, metrics, manifest)
                                                                                    │
                    mlpredict-mcp :8126 /mcp  (run_all, or the Podman container) ◄──┘
                       │
        Hermes agents (MCP)          Elevate chat ──► card + map layer (frontend/src/components/map/panels/intel-card.tsx)
```

- **One small server holds all five models** and loads them once. Inference takes 0.1–2.6 seconds per call, and the container uses about 180 MB of RAM.
- **Training is a separate, explicit step** and takes about 15 seconds on a laptop CPU. Models are saved with a manifest (hashes, versions, data generators), so a restart never retrains or downloads anything.
- **The ML data builds on the Order 4 data.** It uses the same site and cell IDs and the same events, so footfall, events, congestion, outages and booths all describe one world.
- **Weather ML (Chronos-2 Small) is not used by these models.** The booth ranking points to it for rain on the day, and `assess_weather_network_exposure` (Order 4) combines it with site vulnerability.

## Running it

`python backend/run_all.py` (or `run_all.py mlpredict`) prepares the data and models before starting the servers. Each step runs only when its output is missing or older than its generator:
1. `netintel_mcp.seed --if-stale`
2. `mlpredict_mcp.data --if-stale`
3. `mlpredict_mcp.train --if-stale`

After `cd backend && uv sync`, you can also run each step by hand:

```bash
uv run python -m netintel_mcp.seed        # intel.duckdb (~40 s)
uv run python -m mlpredict_mcp.data       # ml.duckdb (~30 s)
uv run python -m mlpredict_mcp.train      # backend/data/models (~15 s), prints the metrics
uv run python -m mlpredict_mcp --transport streamable-http --port 8126 --search
```

**Podman** (Docker Desktop is not used). Run these from `backend/mlpredict-mcp`. The machine was `podman-machine-default` (WSL, 2 GB).

```bash
podman machine start
podman build -f Containerfile -t ai-elevate-mlpredict:0.1.0 ..        # ~80 s the first time
podman run -d --name mlpredict -p 127.0.0.1:8126:8126 --memory 1g --cpus 2 -v <backend/data>:/data:ro ai-elevate-mlpredict:0.1.0
# or, with a compose provider (no docker-compose is installed here, so use podman-compose through uv):
uvx podman-compose -p ai-elevate-ml up -d          # serve (data mounted read-only)
uvx podman-compose -p ai-elevate-ml run --rm train # rebuild data/models when stale (writes backend/data)
uvx podman-compose -p ai-elevate-ml down
```

Things to know:
- **Port.** Do not run the container and `run_all.py mlpredict` at the same time, because both use 8126. Set `MLPREDICT_HOST_PORT` to move the container.
- **The image** is `python:3.13-slim-bookworm` plus `libgomp1`, with the workspace locked by `uv.lock` (`uv sync --frozen --no-dev --package mlpredict-mcp`). It runs as a non-root user.
- **Data and models** stay on the host in `backend/data` (not in Git) and survive container restarts.

| Setting | Default | Meaning |
|---|---|---|
| `NETINTEL_DB` | `backend/data/intel.duckdb` | network data (Order 4, `intel-v2`) |
| `MLPREDICT_DB` | `backend/data/ml.duckdb` | footfall, booths, holidays |
| `MLPREDICT_MODELS` | `backend/data/models` | trained models, `metrics.json`, `manifest.json` |

## Synthetic data

**Network data: `intel.duckdb` (`intel-v2`, seed 42).** See `docs/AI_NETWORK_INTELLIGENCE.md`. Order 5 extended it:

| Change | Detail |
|---|---|
| Longer window | 60 days of hourly KPIs (2026-08-13 to 2026-10-11 MYT), up from 28 |
| Areas | 38 `area` anchors: the best-rated real shopping mall of each NetOps cluster (Overture places) |
| Events | 229 `event` rows over 180 days plus the next 14 days. Past events load the cells within 3.5 km that point at them. |
| `SCN-OUTAGE-PRECURSORS` | About 60% of outages show warning signs 1–3 days earlier (synthetic) |
| `SCN-UPCOMING-EVENT` | `EVT-SA-FESTIVAL`: a 38,000-person festival at Stadium Shah Alam, Saturday 17 Oct 18:00–23:00 MYT |

**ML data: `ml.duckdb` (`ml-v1`, seed 42).** Same inputs and seed give identical tables (tested).

| Table | Rows | Content |
|---|---|---|
| `footfall_hourly` | 164,160 | visitors per area and hour, 180 days ending with the network data. **Aggregate counts only**; no person is modelled. |
| `rain_daily` | 6,840 | daily rain per area. Synthetic seasonal pattern (wetter October–December and on the east coast); not Weather ML. |
| `holiday` | 15 | Malaysia's 2026 federal public holidays. **Real calendar**; Islamic and lunar dates are marked `tentative`. |
| `booth_outcome` | 720 | past booth-days (12 a day on weekends and holidays): area, hours, staff, footfall during the booth, event nearby, rain, network availability, **sign-ups**, and cost. |

**Footfall is driven by:**
- an hour-of-day shape (weekday or weekend);
- public holidays (+12%) and payday at month-end (+8%);
- heavy rain (+5%: people go indoors to malls);
- each area's size and a slow trend;
- events;
- noise.

An event's crowd spills into areas within `2 km + 1 km per 10,000 people`, more for sales and festivals than for matches. Each area's traffic is pinned to a real mall location.

**Booth sign-ups** are a synthetic proxy for interest, **not revenue**. They are a Poisson draw driven by:
- footfall during the booth hours (a strong effect);
- an event nearby (+25%);
- heavy rain (−15%);
- network availability near the area;
- staff count;
- each area's hidden "appetite", which the model has to learn from history.

`cost_rm` is a stated assumption (RM 25 per staff-hour plus a RM 300 booth fee), not data.

**Privacy.** The data holds only aggregate counts per area and hour, and synthetic network data. No individual movement, no identifiers and no scraped data are used.

## Models

All splits are chronological: train on earlier time, test on later time. Every metric is computed on the test rows only.

### 1. Footfall: `predict_area_footfall`

| | |
|---|---|
| Model | LightGBM quantile regression, three models (P10, P50, P90), 400 rounds |
| Features | area, hour, weekday, weekend, holiday, payday, event attendance in reach, sale attendance, visitors 1 and 2 weeks earlier |
| Baseline | same hour last week |
| Split | train on the first 138 days (after a 14-day warm-up), test on the last 28 days; 125,856 / 25,536 rows |

| Test, last 28 days | MAE (visitors/hour) | RMSE |
|---|---|---|
| **Model (P50)** | **119.5** | **207.4** |
| Baseline | 196.0 | 383.9 |
| Event hours only (275 rows): model / baseline | **246.5** / 444.4 | |

- **P10–P90 coverage is 77.4%**, against 80% nominal, so the band is slightly too narrow.
- **Horizon:** up to 7 days past the data. The weekly lag must be known, so there is no recursive forecasting.

### 2. Booth locations: `rank_business_locations`

| | |
|---|---|
| Model | LightGBM Poisson regression on sign-ups; areas are ranked by the prediction. At inference its footfall input is the footfall model's P50 for the window. |
| Features | area, footfall during the booth, event nearby, holiday, weekend, staff, start hour, hours open, network availability |
| Baseline | rank by footfall alone |
| Split | test on the last 42 days of booth history: 14 booth days, 168 booths; 552 training booths |

| Test | Model | Baseline |
|---|---|---|
| NDCG@3 (per booth day) | **0.957** | 0.925 |
| Top-3 hit rate | 0.762 | 0.762 (tie) |
| Sign-ups MAE | **2.80** | 3.13 |

Each recommendation also gives:
- a sign-up band: the booth model rerun with footfall at P10 and P90;
- the three biggest factors, from the model's own feature contributions;
- estimated cost;
- risks: forecast network congestion near the area (from model 4), low recent availability, and weather not being included.

### 3. Site outage risk, next 24 h: `predict_site_failure_risk`

| | |
|---|---|
| Model | LightGBM binary classifier, class-weighted |
| Features | alarms (1 and 3 days), warnings (3 days), major alarms (7 days), maximum packet loss (1 and 3 days), maximum latency, minimum availability (7 days), outages (30 days), maintenance planned for tomorrow, microwave backhaul, mean load (7 days) |
| Label | a total or partial outage starts at the site the next day |
| Baseline | `alarms_3d + 2·warnings_3d + max_loss_1d` |
| Split | train on days 8–44 (17,464 site-days), test on the last 15 labelled days (7,080 site-days, 43 outages, base rate 0.61%) |

| Test | Model | Baseline |
|---|---|---|
| PR-AUC | 0.203 | **0.213** |
| ROC-AUC | 0.723 | **0.737** |
| Precision and recall in the top 43 | **0.372** | 0.302 |

**What this means:**
- Both scorers beat chance by a wide margin: PR-AUC is about 33× the base rate.
- **The model is not better than the simple alarm baseline on PR-AUC or ROC-AUC.** It is better only on its top picks.
- About 40% of outages have no warning sign at all, by construction.
- With 43 test outages, these differences are within noise.

Treat the score as a **relative ranking for preventive checks, not a calibrated probability.**

Risk levels:
- **HIGH:** above the 99th percentile of test scores;
- **MEDIUM:** above the 95th percentile.

Each site also lists its top contributing factors (feature contributions) and matching preventive checks.

### 4. Congestion forecast: `forecast_network_congestion`

| | |
|---|---|
| Model | LightGBM regression on hourly DL PRB per 4G cell, 300 rounds |
| Features | hour, weekday, weekend, holiday, PRB 1, 2 and 3 weeks earlier and their mean, event attendance within 3.5 km, event attendance in the direction the cell points, band, morphology |
| Baseline | same hour last week |
| Split | train on hours 504 to 1,272 (35% sample, 646,509 rows), test on the last 168 hours for all 2,405 cells (404,040 rows) |

| Test, last week | MAE (% PRB) | RMSE | Busy hours ≥ 85% (recall / precision) |
|---|---|---|---|
| **Model** | **6.59** | **9.09** | 0.681 / **0.814** |
| Baseline | 8.80 | 12.63 | **0.694** / 0.704 |
| Event hours only (1,744 rows): model / baseline MAE | **8.79** / 11.34 | | |

**Interval.** The model's P10–P90 error on the test week was −11.4 to +11.3 points, reported around each peak. It is not calibrated per cell.

**Inputs.**
- **Window:** `start`/`end`, up to 7 days ahead.
- **Area:** a cluster, a circle or a list of sites.
- **Event:** `event_id` forecasts the cells within 3.5 km of an event for its hours.

**Example** (`event_id: EVT-SA-FESTIVAL`). The two sectors facing the stadium rank first:

| Cell | Forecast peak PRB |
|---|---|
| `CB8519_Shah Alam_021` | 91.3% |
| `CB8519_Shah Alam_011` | 88.2% |

Both reach the threshold for only 1–2 hours, so they are MEDIUM risk.

### 5. Anomalies: `detect_network_anomalies`

| | |
|---|---|
| Model | Isolation Forest (200 trees) over each cell-hour's deviation from that cell's median for the same hour of the week. The deviations cover PRB, throughput ratio, loss, latency and availability. |
| Threshold | 99.5th percentile of training scores |
| Labels | cell-hours inside recorded incidents: outages, degradations, maintenance, backhaul alarms |
| Baseline | fixed thresholds (availability below 95%, or loss ≥ 2% / latency ≥ 60 ms below 90% PRB) |
| Split | fit on 200,000 cell-hours before the last 14 days, test on those 14 days for 600 sampled cells (201,600 rows, 1,661 labelled) |

| Test | Precision | Recall |
|---|---|---|
| Model | 0.822 | 0.837 |
| Baseline | **0.982** | **0.899** |

Model PR-AUC is 0.855.

**The baseline wins, and that is expected:** its thresholds mirror how the incidents were written into the data. The model's value is that it needs no hand-set thresholds and also flags unusual *quiet* hours, such as traffic drops. **An anomaly score is not a probability of failure.**

**Example.** Over 26 Sep 12:00–20:00 MYT it flags all three sites of the transport-hub incident (`SCN-TRANSPORT-HUB`).

## Tools (MCP, read-only)

All seven tools are read-only (`readOnlyHint: true`). With `--search`, the listing shows only `mlpredict_search_tools` and `mlpredict_call_tool`.

| Tool | Main inputs | Main outputs |
|---|---|---|
| `predict_area_footfall` | `day` (YYYY-MM-DD MYT; default next Saturday), `hour_from`/`hour_to` (default 16–20), area selection | areas ranked by expected visitors (P10/P50/P90), peak hour, hourly P50, events in reach; actual counts when the window is a backtest |
| `rank_business_locations` | `day`, hours (default 12–19), `top_k` (3), `staff` (3), `cluster`/`area_ids` | top areas with expected sign-ups, band, visitors, factors, risks, cost |
| `predict_site_failure_risk` | cluster, circle, `site_ids` or the whole network; `limit` | sites with score, level, contributing factors, preventive checks |
| `forecast_network_congestion` | area or `event_id`, `start`/`end` (default the coming weekend), `threshold_pct` | cells with risk, forecast peak, busy hours, interval, event attendance; events |
| `detect_network_anomalies` | area, `start`/`end` (default the last 24 h of data) | sites with anomalous cell-hours, score, worst hour with its KPIs and deviations, impact |
| `get_ml_model_metrics` | `model` (optional) | the evaluation above, per model |
| `get_ml_model_status` | — | ready or not, versions, training time, data generators, library versions |

Every prediction carries:
- **The window** as `{utc, myt}` timestamps.
- **Units** (`units`).
- **Uncertainty** where the model has it.
- **Provenance:** the model per tool, model version, training time, data generators, library versions, and "no LLM".
- **Data freshness:** the data ends 2026-10-12 00:00 MYT, and forecasts start there, not at the wall clock.
- **Limitations and warnings.**
- **A GeoJSON FeatureCollection** using the Order 4 property contract (`id`, `kind`, `severity`, `score`, `label`, `unit`). Areas, sites, sectors and events are drawn by the same chat card.

**Refusals.** Out-of-range requests are refused with a plain message, for example:
- more than 7 days ahead;
- an anomaly window in the future;
- an unknown event or cluster.

### Hermes agent mapping

| Agent | Tools |
|---|---|
| Forecast Agent | `predict_area_footfall`, `forecast_network_congestion`, `get_ml_model_metrics`, `get_ml_model_status` |
| Business Agent | `rank_business_locations`, `predict_area_footfall` |
| Engineer Agent | `predict_site_failure_risk`, `detect_network_anomalies`, `forecast_network_congestion` (with the Order 4 tools) |
| Orchestrator | all; pass `geojson` to the map |

Hermes connects to `http://127.0.0.1:8126/mcp`.

**The brief's scenario, end to end:**
1. `predict_area_footfall(cluster="Shah Alam")`: the festival in reach.
2. `forecast_network_congestion(event_id="EVT-SA-FESTIVAL")`: the two sectors facing the stadium.
3. `investigate_customer_complaint("CMP-SA-0101")` (Order 4): the complaint from the concert.
4. `rank_business_locations(...)`: booth options with the congestion risk flagged.

## Licences

Every dependency is permissive, and no root licence was added:

| Component | Licence |
|---|---|
| LightGBM | MIT |
| scikit-learn, NumPy, SciPy, joblib | BSD-3-Clause |
| DuckDB | MIT |
| FastMCP | Apache-2.0 |
| Python base image | PSF / Debian packages |
| libgomp | GPL-3 with the GCC runtime library exception |

**Data sources:**
- Shopping-mall locations: Overture Maps Places (CDLA-Permissive-2.0), from the NetOps seed.
- Public-holiday dates: public facts.
- Everything else is generated synthetic data.

## Tests and validation

Run from `backend/`: `uv run pytest mlpredict-mcp netintel-mcp`. The tests build a small fake network, then all the data, then train the models, so they don't need the real data.

| Check | Result |
|---|---|
| ML dataset is deterministic (same input and seed give identical tables) | PASS |
| Footfall is aggregate only (no person fields), hourly, and ends with the network data; events add visitors; weekends are busier | PASS |
| Holiday calendar: fixed dates present, lunar dates marked tentative | PASS |
| Training writes every model, metrics with a baseline and a chronological split for each, and a manifest with hashes and versions | PASS |
| Footfall forecast: P10 ≤ P50 ≤ P90, ranked, horizon limit enforced | PASS |
| Booth ranking: band contains the estimate, factors and risks present, "not revenue" stated | PASS |
| Failure risk: scores in [0, 1], ranked, 24 h horizon, levels | PASS |
| Congestion forecast for `EVT-SA-FESTIVAL`: forecast window, event listed, intervals ordered; far future refused | PASS |
| Anomalies find the transport-hub incident; future windows refused | PASS |
| Status and metrics tools; "not ready" when no models are trained | PASS |
| MCP server lists 7 read-only tools; errors are tool errors | PASS |
| GeoJSON contract (coordinates inside Malaysia, `[lng, lat]`, properties) | PASS |
| Order 4 tests on `intel-v2` | PASS |
| Full backend suite (all servers) | PASS: 605 tests. One existing `scam-mcp` test sometimes fails at random on its own; it is unrelated. |
| Training on the real NetOps-derived data: 15 s, metrics above | PASS |
| Podman: image builds; container serves MCP and gives the same answer as on the host; 184 MB RAM; `podman-compose up` healthy, `down` clean | PASS |
| Chat end to end (DeepSeek V4 Flash, headless Edge): booth ranking card with map points; event congestion card | PASS |
| Same-machine Weather ML combined with these models | NOT VERIFIED (not part of these models; see Order 4) |
| Linux AMD64 build on another machine | NOT VERIFIED (built and run here: Windows host, Podman WSL machine) |

## Known limitations

- **Everything is synthetic.** The models learn relationships the generators put in, such as event spill, the payday bump and outage precursors. The benchmarks show the method, not real-world skill.
- **The failure model** is no better than a simple alarm heuristic on PR-AUC or ROC-AUC, and many outages are unpredictable by design. Use it as a ranked shortlist for preventive checks.
- **The anomaly model** is beaten by fixed thresholds on these labels.
- **Forecast horizons** are capped at 7 days. Rain is not a footfall or booth input, because future rain is unknown here. For that, use Weather ML.
- **Sign-ups** are a proxy for interest. No revenue is forecast, and cost is a stated assumption.
- **Areas** are one mall per cluster (38), so smaller venues and neighbourhoods are not modelled.