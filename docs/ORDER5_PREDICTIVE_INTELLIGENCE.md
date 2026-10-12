# Order 5: AI Network Intelligence and Predictive ML

Order 5 gives AI Elevate five predictive capabilities. Each one is a read-only MCP tool backed by real local model inference (LightGBM and scikit-learn). The tools share one output contract that the Hermes agents and the Order 4 Opportunity Graph can consume. A scripted live demo calls the real MCP servers and runs the chain **Analyze Network → Predict Future Risk → Identify Demand → Recommend Areas for Investigation**.

**All data is synthetic.** The scores show that the pipeline works on a consistent synthetic Malaysian network. They do not measure real-world accuracy.

This builds on the existing services and does not replace them:
- `backend/netintel-mcp` (port 8125): analysis of recorded network data.
- `backend/mlpredict-mcp` (port 8126): the trained models. Their data, training and metrics are documented in [PREDICTIVE_ML_ECOSYSTEM.md](PREDICTIVE_ML_ECOSYSTEM.md).

## What changed in this order

| Change | Where |
|---|---|
| New tool `get_business_demand_signals` (capability 5), schema `demand-signals-v1` | `mlpredict_mcp/tools.py`, `server.py` |
| Shared `predictions` list (schema `mlpredict-prediction-v1`) added to every predictive tool | `mlpredict_mcp/tools.py` |
| Weather exposure added to the failure-risk output as supporting evidence | `predict_site_failure_risk` |
| Live demo client over MCP | `mlpredict_mcp/demo.py` |
| Fix: NetIntel's busiest hour was nondeterministic for saturated cells (`arg_max` ties) | `netintel_mcp/tools.py` |
| Chat card and agent prompt list the new tool (additive only, no redesign) | `frontend/.../intel-card.tsx`, `frontend/src/lib/ai/agent.ts` |
| `backend/.dockerignore` keeps the host `.venv` and data out of the image | `backend/.dockerignore` |
| Tests: shared contract, demand signals, determinism, refusals, demo chain | `mlpredict-mcp/tests/test_order5.py` |

No data was reseeded and no model was changed. Retraining from the existing `intel.duckdb` (`intel-v2`) and `ml.duckdb` (`ml-v1`) gives byte-identical model files.

## The five capabilities

| # | Capability | MCP tool | Model | Synthetic test result (vs baseline) |
|---|---|---|---|---|
| 1 | Network failure prediction, next 24 h | `predict_site_failure_risk` | LightGBM classifier on KPIs, alarms, outages, maintenance and backhaul | PR-AUC 0.203 vs 0.213 (alarm heuristic); precision in the top 43 is 0.372 vs 0.302 |
| 2 | Congestion forecast, up to 7 days | `forecast_network_congestion` | LightGBM regression on hourly PRB per cell | MAE 6.59 vs 8.80 % PRB (same hour last week) |
| 3 | Aggregate footfall forecast | `predict_area_footfall` | LightGBM quantile regression (P10/P50/P90) | MAE 119.5 vs 196.0 visitors/hour |
| 4 | Anomaly detection with evidence | `detect_network_anomalies` | Isolation Forest on deviations from each cell's usual | precision 0.822, recall 0.837 (fixed thresholds: 0.982 / 0.899) |
| 5 | Business demand signals | `get_business_demand_signals` | Combines models 1–3 and the booth model with stated rules | not a learned model; the rules are listed in each result |

`rank_business_locations` (the booth sign-up model) also feeds capability 5.

**Weather exposure (capability 1).** The synthetic outages are not driven by rain, so the failure model does not use rain as an input. Instead, each site in the result has a `weather_exposure` block next to its score. The block holds:
- the backhaul type;
- rain in the last 3 days at the site's cluster area (`ml.duckdb` `rain_daily`, synthetic);
- the number of heavy-rain days in the last 7 days.

The exposure is `elevated` when a microwave-backhauled site has had a heavy-rain day. In that case the microwave check is added to the recommended checks. For a rain forecast, use NetIntel `assess_weather_network_exposure` (Weather ML).

## Business demand signals (capability 5)

`get_business_demand_signals(day, hour_from=12, hour_to=22, cluster?, area_ids?, limit=10)` looks ahead up to 7 days from the end of the data. It scores all 38 commercial areas, so a filtered call returns the same scores as the full call.

| Output | How it is computed |
|---|---|
| `demand_index` (0–1) | 0.35 × the percentile of forecast footfall + 0.25 × the percentile of uplift against the usual footfall (the median of the same window over the last 4 weeks) + 0.2 × the percentile of booth sign-ups + 0.2 × the percentile of event attendance in reach |
| `capacity_pressure` (0–1) | 0.5 × clip(share of nearby cell-hours forecast at or above 85% PRB ÷ 0.2) + 0.5 × clip((the largest rise of a cell's forecast peak over its usual peak − 10) ÷ 15 points) |
| `reliability_risk` (0–1) | the failure-model level of the riskiest nearby site: HIGH 1.0, MEDIUM 0.6, otherwise up to 0.5 by score |
| `investigation_priority` | 0.45 × demand + 0.35 × pressure + 0.2 × reliability |
| `signal` | `demand_exceeds_capacity` (demand ≥ 0.7 and pressure ≥ 0.6), else `reliability_risk` (a HIGH site), else `demand_with_headroom` (demand ≥ 0.7), else `structural_congestion` (pressure ≥ 0.6), else `steady` |
| `secondary_flags` | the other conditions that also hold |

The results are sorted with actionable signals first, then by priority. "Nearby sites" are the sites of the area's cluster within 2 km, or the 3 nearest when none are that close. Confidence is at most `medium`, because the weights are assumptions and outage risk is a ranking.

## Output contract (for Hermes and the Order 4 Opportunity Graph)

Every result is the Menara envelope: `{synthetic: true, as_of, data, evidence, warnings}`. In `data`, every predictive tool returns:
- `summary`;
- `window` (or `horizon`) as `{utc, myt}`;
- `predictions`;
- `geojson`, with the Order 4 properties `id`, `kind`, `severity`, `score`, `label` and `unit`;
- `provenance`, which includes "no LLM";
- `data_freshness`;
- `limitations`;
- the tool's own detailed fields.

**`predictions[]`, schema `mlpredict-prediction-v1`.** Each row covers one site, cell or area. The same keys appear in all six predictive tools:

```json
{
 "schema": "mlpredict-prediction-v1",
 "subject": {"type": "cell", "id": "CB8519_Shah Alam_021", "name": "CB8519", "cluster": "Shah Alam"},
 "prediction": "peak DL PRB utilisation",
 "window": {"start": {"utc": "2026-10-17T09:00:00Z", "myt": "2026-10-17T17:00:00+08:00"},
            "end": {"utc": "2026-10-17T16:00:00Z", "myt": "2026-10-18T00:00:00+08:00"}, "kind": "forecast"},
 "value": 91.3, "unit": "% PRB", "score": 0.91, "level": "MEDIUM",
 "evidence": ["1 h at or above 85% PRB", "P10-P90 at peak 79.9-100.0%", "up to 38,000 event attendees within 3.5 km"],
 "confidence": "medium",
 "confidence_basis": "distance of the peak from the 85% threshold vs the test-week error band (-11.4/+11.3 points)",
 "synthetic": true
}
```

| Key | Meaning |
|---|---|
| `subject.type` | `site`, `cell` or `area`; `id` is a NetOps Site_ID, cell name or Order 4 `area_id` |
| `value` / `unit` | the forecast or score in its unit (visitors, % PRB, model score, anomaly score, sign-ups, priority) |
| `score` | 0–1 where the tool has one; `null` for counts |
| `level` | LOW / MEDIUM / HIGH / CRITICAL where the tool has levels |
| `confidence` | `low`, `medium` or `high`; `confidence_basis` says why |

**`signals[]`, schema `demand-signals-v1`.** One row per area, keyed by the same `area_id` as the Opportunity Graph's `area` nodes (`intel.duckdb` `area`):

```json
{
 "schema": "demand-signals-v1", "area_id": "AREA-SHAHAL", "name": "Kompleks PKNS Shah Alam", "cluster": "Shah Alam",
 "lat": 3.070619, "lng": 101.517169, "window": {"day_myt": "2026-10-17", "kind": "forecast", "start": {...}, "end": {...}},
 "signal": "reliability_risk", "secondary_flags": ["capacity_pressure", "event_in_reach"],
 "recommended_investigation": "A nearby site ranks high for outage risk: run the preventive checks before any campaign here.",
 "investigation_priority": 0.756, "demand_index": 0.68, "capacity_pressure": 0.714, "reliability_risk": 1.0,
 "indicators": {"footfall_p50": 16634, "footfall_p10": 15184, "footfall_p90": 19070, "footfall_typical": 15476,
                "footfall_uplift_pct": 7.5, "expected_booth_signups": 14.3, "event_attendance_in_reach": 38000,
                "forecast_peak_prb_pct": 98.9, "cells_forecast_congested_share": 0.133, "congested_cell_hours": 45,
                "congested_cell_hours_share": 0.086, "prb_surge_vs_usual_pts": 26.2, "surge_cell": "CB8519_Shah Alam_021",
                "network_availability_14d_pct": 98.91, "worst_site_outage_score": 0.9681, "worst_site_outage_level": "HIGH"},
 "site_ids": ["CK9926", "CC9023", "...", "CB5348"], "worst_site_id": "CC3279", "events": ["EVT-SA-FESTIVAL"],
 "evidence": ["footfall P50 16,634 visitors (P10-P90 15,184-19,070), +7.5% vs usual (...)", "..."],
 "confidence": "medium", "confidence_basis": "capped at medium: ...", "synthetic": true
}
```

**How the Opportunity Graph can consume it.** This is a proposal for the Order 4 developer to agree; `opportunity-mcp` is not changed here.
1. Call `get_business_demand_signals(day=<the next Saturday>, limit=50)` on `http://127.0.0.1:8126/mcp`, or through `mlpredict_call_tool` when the server runs with `--search`.
2. Join on `area_id`, then set `demand_index`, `capacity_pressure`, `reliability_risk` and `indicators.*` as attributes of the `area` node.
3. Use `capacity_pressure` and `reliability_risk` in the `event_surge` family's feasibility score, in place of or next to the 7-day PRB p95.
4. Keep `signal` and `evidence` as provenance for the hypothesis.

The contract is versioned (`schema`). New fields may be added, but existing keys will not be renamed within `-v1`.

**Hermes.** Hermes does not register `mlpredict` or `netintel` yet: its gateway lists NetOps, Weather and Opportunity only. Hermes internals are not changed here. The suggested agent mapping is in [PREDICTIVE_ML_ECOSYSTEM.md](PREDICTIVE_ML_ECOSYSTEM.md#hermes-agent-mapping), with `get_business_demand_signals` added for the Business agent. The Elevate chat already reaches both servers through `/api/menara/call` and draws their cards.

## Running it (Apple Silicon)

LightGBM needs OpenMP. On a Mac without Homebrew `libomp`, run MLPredict in Docker. NetIntel has no ML dependencies, so it runs on the host.

```bash
cd backend
docker build -f mlpredict-mcp/Containerfile -t ai-elevate-mlpredict:0.1.0 .            # ~1 min the first time
docker run --rm -v "$PWD/data":/data ai-elevate-mlpredict:0.1.0 \
  sh -c "python -m mlpredict_mcp.data --if-stale && python -m mlpredict_mcp.train --if-stale"   # ~12 s
(cd mlpredict-mcp && docker compose -p ai-elevate-ml up -d)                             # serve on 127.0.0.1:8126
uv run python -m netintel_mcp --transport streamable-http --port 8125 --search          # NetIntel on the host
uv run python -m mlpredict_mcp.demo --out data/demo_transcript.json                     # the live demo, ~5 s
```

- **Port clash.** If `run_all.py` already serves 8125 or 8126, either stop it or move the container with `MLPREDICT_HOST_PORT=18126`. Then pass `--netintel`/`--mlpredict` URLs to the demo.
- **Tests:** these need LightGBM, so run them in the image:
  ```bash
  docker run --rm --user root -v "$PWD":/app:ro ai-elevate-mlpredict:0.1.0 sh -c "uv pip install --python /opt/venv/bin/python -q pytest; cd /app && /opt/venv/bin/python -m pytest -q -p no:cacheprovider mlpredict-mcp netintel-mcp"
  ```

## Demo scenario and output

The synthetic scenario is `SCN-UPCOMING-EVENT`: a 38,000-person festival at Stadium Shah Alam on Saturday 17 October 2026, 18:00–23:00 MYT. The full output is in [order5/demo_output.txt](order5/demo_output.txt). Each run writes every raw tool result to the transcript. The run makes 9 MCP calls in about 5 seconds. Key lines:

1. **Analyze network.** NetIntel finds 14 of 77 Shah Alam cells at or above 85% PRB in the last 7 days. The anomaly model flags CK8606: availability dropped 99.9 points below its usual level.
2. **Predict future risk.**
   - The two stadium-facing sectors are forecast to peak at 91.3% and 88.2% PRB (P10–P90 79.9–100%).
   - Site CC3279 ranks HIGH for outage risk in the next 24 hours, driven by latency and a recent availability drop.
3. **Identify demand.** Footfall at Kompleks PKNS is forecast at about 16,634 visitors (P10–P90 15,183–19,069), +7.5% against its usual level, with the festival in reach.
4. **Recommend areas.**
   - **#1 Shah Alam** (`reliability_risk`, also flagged for capacity pressure and the event; priority 0.76): run preventive checks on CC3279 and plan capacity for CB8519 (+26 points above its usual peak) before selling.
   - **#2 Kajang** and **#3 Alor Setar** (`demand_with_headroom`): good booth or event-package candidates.
   - The booth check for Shah Alam gives about 18 sign-ups (band 16.8–21.3, RM 900), with the congestion risk flagged.

## Verification (2026-10-13, MacBook Apple Silicon, Docker Desktop)

| Check | Result |
|---|---|
| `mlpredict-mcp` and `netintel-mcp` tests in the image (13 new) | PASS: 49 |
| `opportunity-mcp` and `netintel-mcp` tests on the host | PASS: 25 |
| Retraining gives byte-identical models (all 9 model files and `metrics.json`); metrics match PREDICTIVE_ML_ECOSYSTEM.md | PASS (booth top-3 hit rate is 0.786 here; the doc says 0.762) |
| Same demo output on 4 consecutive runs against the live servers (after the NetIntel tie-break fix) | PASS |
| Image built with the code inside, served by `docker compose`, healthy, about 224 MB RAM, gives the same demo output as the source-mounted run | PASS |
| `ruff` on both packages; `tsc` and `eslint` on the two frontend files | PASS (`tsc` reports only the existing `LayoutProps` error in `src/app/layout.tsx`, which needs Next's generated types) |
| Hermes end to end with these tools | NOT VERIFIED: Hermes does not register these servers yet |
| Chat UI rendering of the new card | NOT VERIFIED in a browser |

## Assumptions and limitations

- **Everything is synthetic.** The models learn the relationships that the generators built in, such as event spill, outage precursors and evening load. The metrics show the method works, not how it performs in the real world.
- **The failure model is a ranking.** It is not a calibrated probability, and it is no better than an alarm heuristic on PR-AUC or ROC-AUC. Its value is in its top picks.
- **The anomaly model loses to fixed thresholds** on these labels, because the thresholds mirror how the incidents were generated. An anomaly score is not a failure probability.
- **The demand-signal weights and thresholds are stated assumptions,** chosen once and not learned. Outage risk is the latest 24-hour score, reused for later days in the window.
- **Footfall is aggregate per area and hour.** No person is modelled or tracked. Areas are one mall per cluster (38).
- **Sign-ups are a proxy for interest,** not revenue. Booth cost is an assumption.
- **Weather is context only:** synthetic recent rain plus backhaul type. It is not a forecast and not a model input.
