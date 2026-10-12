# AI Network Intelligence (Order 4)

Evidence-based network investigation over the NetOps data:
- customer complaints;
- congestion;
- incidents across several sites;
- weather exposure;
- maintenance recommendations.

It is served by one MCP server, `backend/netintel-mcp` (port **8125**). Hermes agents and the Elevate chat use it, and every answer is drawn on the Kepler map.

All network data is **synthetic**. The tools rank *plausible* causes from stored evidence using rules; they do not prove root causes. No LLM produces any of the numbers.

## Architecture

```
netops.duckdb (NetOps seed, daily KPIs, NTT, maintenance, complaints, BIN signal)
      │  read-only copy, at build time
      ▼
netintel_mcp.seed ──► backend/data/intel.duckdb   (hourly extension + scenarios, deterministic)
                              │ read-only
                              ▼
                     netintel-mcp :8125 /mcp  ──► Weather ML :8002 /api/predict-sites (optional, read-only)
                              │
            ┌─────────────────┴──────────────────┐
     Hermes agents (MCP)              Elevate chat (MCP) ──► card + map layer (frontend/src/components/map/panels/intel-card.tsx)
```

- **It reuses existing data and duplicates no tools.** NetOps already has daily KPIs, trouble tickets (NTT), planned maintenance, complaints (THD) and BIN signal grids, but no hourly data and no alarms. `intel.duckdb` adds those and keeps the NetOps IDs (`Site_ID`, `Cell_Name`), so every result joins back to NetOps.
- **netops.duckdb is never touched.** The generator copies it to a temporary file and reads the copy, so a running NetOps server is not disturbed.
- **Weather comes only from Weather ML.** `weather-ml-mcp` (Chronos-2 Small) is called over its read-only HTTP endpoint. When it is not running, the tools say so and use no weather values; they do not fall back to the synthetic Menara weather.

## Running it

`python backend/run_all.py` starts `netintel-mcp` with the other servers. On first run it builds `backend/data/intel.duckdb` from `netops.duckdb`, which takes about 30 seconds.

By hand:

```bash
cd backend
uv sync
uv run python -m netintel_mcp.seed                 # build or rebuild backend/data/intel.duckdb
uv run python -m netintel_mcp --transport streamable-http --port 8125   # add --search for BM25 tool search
```

| Setting | Default | Meaning |
|---|---|---|
| `NETINTEL_DB` | `backend/data/intel.duckdb` | data file the server reads |
| `WEATHER_ML_HTTP_URL` | `http://127.0.0.1:8002` | Weather ML service (see `weather-ml-mcp/README.md`; start it with `podman compose -p ai-elevate-weather up -d`) |

Port 8125 was free on the development machine. The Menara servers use 8101–8124, NetOps 8000 and Weather ML 8002.

## Shared output contract

Every tool returns the Menara envelope:

```jsonc
{
  "synthetic": true,
  "as_of": "2026-10-11T16:00:00Z",          // end of the data window, UTC
  "data": {
    "summary": "...",                        // one paragraph, factual
    "geojson": { "type": "FeatureCollection", "features": [ ... ] },
    "provenance": { "dataset": "...", "generator_version": "intel-v2", "seed": "42", "netops_ref_date": "2026-10-12",
                    "window_days_local": "2026-08-13..2026-10-11", "synthetic": true, "method": "rule-based ..." },
    "data_freshness": { "data_end": { "utc": "...Z", "myt": "...+08:00" }, "live": false, "note": "..." },
    "limitations": [ "..." ],
    "...": "tool-specific fields below"
  },
  "evidence": [ { "source": "netintel-mcp", "tool": "kpi_hourly", "call_id": "…", "ref": "…", "confidence": 1.0, "as_of": "…" } ],
  "warnings": [ "Weather ML not reachable at …; no weather values were used." ]
}
```

- **Times.** Times are stored in UTC. Every time in a result is given as `{ "utc": "…Z", "myt": "…+08:00" }`. Inputs without an offset are read as Malaysia time.
- **GeoJSON.** Coordinates are `[lng, lat]` (WGS84). Every feature's `properties` has these fields:

| Field | Meaning |
|---|---|
| `id` | site, cell, complaint or event ID |
| `kind` | `site`, `sector`, `complaint`, `event`, `hub` or `transport_link` |
| `severity` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` or `null` |
| `score` | 0–1 or `null` |
| `label` | short text |
| `unit` | unit of `score`, or `null` |

  Sectors are drawn as a 400 m line from the site along the cell azimuth.
- **Severity.** Every tool uses the same four levels.

  | Colour | Severity |
  |---|---|
  | red `#dc2626` | CRITICAL |
  | orange `#f97316` | HIGH |
  | yellow `#eab308` | MEDIUM |
  | green `#22c55e` | LOW |
  | grey | none |

  On the map, complaints are pink, events violet, and transport hubs and links light blue.
- **Errors.** Bad input (an unknown site, cluster or complaint, or a missing area) is returned as an MCP tool error with a plain message. A missing data file returns: "build it with …".

## Tools

All five tools are read-only (`readOnlyHint: true`, `destructiveHint: false`). Each one selects an area with **one** of:
- `site_ids` (NetOps `Site_ID`, up to 50);
- `cluster` (NetOps cluster name, for example `Shah Alam`);
- `lat` + `lng` + `radius_km`.

### `investigate_customer_complaint`

| Input | |
|---|---|
| `complaint_id` | for example `CMP-SA-0001`, or a NetOps THD `CaseNumber` |
| `lat`, `lng` | the customer location, when there is no complaint ID |
| `hour_from`, `hour_to` | reported hours, Malaysia time, 0–23; wraps past midnight |
| `days` | 1–28, default 28 |
| `description` | optional |

How it works:
1. **Serving cell.** It picks the nearest site, then the sector whose azimuth points closest to the customer. This is an estimate from geometry, not the subscriber's own records.
2. **KPIs.** It compares the serving cell's KPIs in the reported hours against the other hours (PRB load, throughput, active users, latency, packet loss, SINR, availability), and builds an hourly profile with the busy hour.
3. **Signal.** It looks up measured RSRP/RSRQ/SINR from the nearest BIN grid within 600 m.
4. **Records.** It gathers outages, maintenance and alarms on the serving site, its nearby sites and its transport hub, plus crowd events within 2 km.

**Output fields:**
- `complaint`, `serving_cell`, `nearby_sites`
- `kpi_comparison {reported_hours, other_hours, units}`, `hourly_profile_myt`, `busy_hour_myt`
- `signal_quality` (or `null` with a warning)
- `related_records`
- `causes[]`: each has `cause`, `score`, `likelihood` (low/medium/high), `evidence[]` and `gaps[]`. Causes are `congestion`, `coverage`, `interference`, `outage_or_maintenance`, `transport`, `crowd_event`, or `no_network_side_evidence` when no cause scores at least 0.4.
- `recommendations[] {priority, owner, action, rationale}`

**Example** (real output, shortened). Input: `{"complaint_id": "CMP-SA-0001", "hour_from": 19, "hour_to": 22}`.

> Most likely cause: congestion (high). The customer is served by CB5348_Shah Alam_011 (0.32 km away), which averaged 92% PRB between 19:00 and 22:59 MYT over the last 28 days against 44% at other times.

| Cause | Likelihood | Evidence |
|---|---|---|
| congestion | high | throughput 8.2 Mbps against 16.6 Mbps in other hours (51% lower); 28 of 28 days above 85% PRB |
| coverage | low | RSRP −87.5 dBm (good) |

Recommendations:
- **P1:** add a carrier or split the sector on CB5348_Shah Alam_011.
- **P2:** shift load to CK1617, which runs at 52% PRB in the same hours.

### `analyze_network_congestion`

| Input | Values |
|---|---|
| area | `site_ids`, `cluster`, or `lat` + `lng` + `radius_km` |
| `days` | 1–14, default 7 |
| `threshold_pct` | default 85 |
| `limit` | default 20 |

For each cell that reached the threshold, it returns:
- congested hours, hours per day and days with congestion;
- the busy hour (Malaysia time);
- peak, 95th-percentile and average PRB;
- the trend against the previous period of the same length;
- average active users while congested (an estimate of affected users);
- throughput while congested against otherwise;
- severity, and a capacity recommendation.

Severity counts congested hours per day: **CRITICAL** is 4 or more (with a peak of at least 95%), **HIGH** 2 or more, **MEDIUM** 0.75 or more, **LOW** anything above 0. The result also lists crowd events in the area.

**Example** (real, Shah Alam, 7 days): "14 of 77 cells reached 85% PRB in the last 7 days (9 critical, 0 high, 0 medium, 5 low)…". A cell row looks like this:
```json
{"cell_name": "CK8613_Shah Alam_023", "severity": "CRITICAL", "congested_hours": 74, "congested_hours_per_day": 10.57,
 "previous_period_hours": 30, "trend": "rising", "busy_hour_myt": 12, "peak_prb_pct": 99.5, "p95_prb_pct": 99.2,
 "avg_active_users_when_congested": 200.0, "throughput_when_congested_mbps": 6.0, "throughput_otherwise_mbps": 12.0,
 "recommendation": "Capacity expansion: add a carrier or split the sector; plan a new site if neighbours are also hot."}
```

### `correlate_network_incidents`

| Input | |
|---|---|
| area | `site_ids`, `cluster`, or `lat` + `lng` + `radius_km` |
| `start`, `end` | optional ISO times; without an offset they are read as Malaysia time |
| `use_weather` | default true |

**Choosing the time window.** Without a window, it finds the hour when the most of these sites were degraded together, and widens it to the surrounding stretch of such hours. A site-hour counts as **degraded when it is not explained by load**:
- availability is below 95%; or
- packet loss is at least 2%, or latency at least 60 ms, while no cell on the site is above 90% PRB.

**What it correlates.**
- Degraded hours per site.
- Outages, alarms, and maintenance on the sites, their transport hubs, and sites within 10 km.
- Shared attributes: transport hub, TM exchange, cluster, backhaul type, and the largest distance between affected sites.
- Weather ML forecasts, used only when their valid time overlaps the window.

**How hypotheses are ranked.** Each hypothesis is `strong`, `moderate`, `weak` or `unlikely`, with `supporting[]` and `contradicting[]` evidence. A shared hub becomes **strong** when there is maintenance or an alarm on the hub itself.

**Example** (real). Input: `{"site_ids": ["CK3433", "CC1646", "CK4080"]}`. The window found was 26 Sep 14:00–18:00 MYT.

| Hypothesis | Strength | Evidence |
|---|---|---|
| Shared transport: hub CB3550 | strong | `RFC-INTEL-0001 'Microwave hub radio firmware upgrade - CB3550'` on the hub |
| Same alarm on several sites | moderate | `HIGH_PACKET_LOSS` on all three |
| Common TM exchange | weak | — |

Limitations always include "Correlation is not causation".

### `assess_weather_network_exposure`

| Input | |
|---|---|
| area | `site_ids`, `cluster`, or `lat` + `lng` + `radius_km` |
| `horizon_hours` | 6, 12 or 24 |

It covers up to 25 sites, Weather ML's limit per request.

For each site it calls Weather ML `POST /api/predict-sites`. The returned `exposure` (low/elevated/high, from the peak hourly median rainfall), `peak_rainfall_mm`, `forecast_start`/`forecast_end`, `mode` and `model_id` are copied unchanged.

It then adds a **vulnerability** score from 0 to 1:

| Factor | Adds |
|---|---|
| microwave backhaul | +0.3 |
| outage or degradation tickets in 28 days | +0.1 each, up to 0.4 |
| 3 or more alarms | +0.15 |
| average availability below 99% | +0.15 |

**Exposure indicator:**

| Weather ML exposure | Indicator |
|---|---|
| high | HIGH if vulnerability ≥ 0.3, otherwise MEDIUM |
| elevated | MEDIUM if vulnerability ≥ 0.5, otherwise LOW |
| low | LOW |

`weather_mode` is `replay` (a forecast for a past window, using inputs before its cutoff), `live`, or `unavailable`. When it is unavailable, the indicator is `null` and only vulnerability is reported. **The indicator is an exposure heuristic, not a failure probability. Chronos forecasts weather, not equipment failure.**

### `recommend_network_maintenance`

| Input | |
|---|---|
| area | optional: `cluster`, `site_ids`, or `lat` + `lng` + `radius_km`; the default is the whole network |
| `limit` | default 10 |
| `include_weather` | default false |

| Detector | Rule | Example action |
|---|---|---|
| `chronic_congestion` | a site's worst cell is at or above 85% PRB for 28+ hours in 7 days (P1 at 56+ hours) | plan capacity |
| `recurring_radio_alarm` | 3 or more `VSWR_HIGH` alarms in 28 days | inspect antenna, feeder and connectors |
| `recurring_backhaul` | 3 or more `MW_*` alarms in 28 days | investigate microwave degradation |
| `repeated_outage` | 2 or more total or partial outages in 28 days | root-cause review |
| `coverage_complaints` | 3 or more coverage complaints in 28 days | drive test or indoor survey |
| `weather_preparation` (optional) | exposure MEDIUM or HIGH | check backup power, drainage and fade margin |

**Output.** Every recommendation has:
- `priority`, `category`, `site_id`, `cell_name`, `action` and `evidence[]`;
- `draft_ticket {title, sub_network, status: "DRAFT (not created)", requires_human_approval: true}`.

The list is ranked by priority, then by weight. No single category takes more than half of it.

**The tool creates nothing.** Turning a draft into a ticket, a dispatch or a configuration change goes through the existing ticket, field and policy tools. Those require human approval in policy-mcp, as self-heal does.

## Hermes agent mapping

Hermes connects to `http://127.0.0.1:8125/mcp` (streamable HTTP). With `--search` the listing shows `netintel_search_tools` and `netintel_call_tool`; the real tool names above are what `netintel_call_tool` takes.

| Agent | Tools |
|---|---|
| Engineer Agent | `investigate_customer_complaint`, `correlate_network_incidents`, `analyze_network_congestion`, `recommend_network_maintenance` |
| Forecast Agent | `assess_weather_network_exposure` (the weather itself comes from Weather ML tools) |
| Business Agent | `analyze_network_congestion` (affected users, severity), `recommend_network_maintenance` (priorities) |
| Orchestrator | all five; route on the question type and pass `geojson` to the map |

Agent profiles, SOUL.md, memory and orchestration belong to the Hermes developer. This server only provides tools.

## Synthetic data (`intel.duckdb`, generator `intel-v2`, seed 42)

| Table | Rows (real NetOps seed) | Content |
|---|---|---|
| `site`, `cell` | 472, 2,405 | copied from `Site4G` / `Cell4G` (IDs, coordinates, backhaul, exchange, morphology, azimuth) |
| `kpi_hourly` | 3,463,200 | 60 days × 24 hours per 4G cell, 2026-08-13 to 2026-10-11 (Malaysia time): the NetOps daily KPI window |
| `outage` | 186 | NetOps `ntt_granite` tickets in the window, plus scenario tickets |
| `maintenance` | 193 | NetOps `Webe_Plan_Maintenance` in the window, plus `RFC-INTEL-0001` |
| `complaint` | 379 | NetOps `THD` in the window, plus 6 scenario complaints |
| `alarm` | 354 | derived from outages (`S1_LINK_LOST`, `CELL_UNAVAILABLE`, `KPI_DEGRADATION`), outage precursors, plus scenarios |
| `transport_link` | 118 | each microwave site is fed by the nearest fibre site in its cluster (a demo assumption) |
| `grid_quality` | 579 | NetOps `BinKPI` RSRP/RSRQ/SINR/CQI per grid, averaged over the window |
| `area` | 38 | one commercial anchor per NetOps cluster: its best-rated shopping mall in the Overture places (real locations) |
| `event` | 229 | crowd events at the areas over 180 days plus the next 14 (synthetic). Past ones inside the KPI window load the cells within 3.5 km that point at them; `status` is `past` or `upcoming` |
| `scenario`, `meta` | 7, 9 | scenario descriptions, generator version, seed, window, NetOps reference date |

**How the hourly KPIs are made.**
- **PRB load.** Each hourly value is the cell's NetOps daily PRB times an hour-of-day profile (residential, business or mixed by `RFP_Morphology`, weekday or weekend), with 5% noise. The daily mean follows NetOps, and a test checks it within 4 points.
- **Other KPIs.** These are derived from load:
  - throughput falls sharply above 80% PRB, to about half at 92%;
  - latency and packet loss rise above 70% and 82% PRB;
  - SINR drops slightly with load around each cell's measured BIN SINR.
- **Availability.** It comes from records, not from the NetOps daily availability field:

  | Record | Effect on its hours |
  |---|---|
  | total outage | 0% availability; nearby sites take +10 PRB |
  | partial outage | 50% availability |
  | degradation | loss, latency and throughput effects |
  | RAN maintenance | site off air |
  | TX maintenance | loss and throughput effects |

**Scenarios.** These are reproducible and are recorded in the `scenario` table. The tools have no special cases for them; the generic rules find them.

| ID | What happens in the data |
|---|---|
| `SCN-EVENING-CONGESTION` | One Shah Alam sector is at 87–96% PRB from 19:00 to 23:59 every day. Complaints `CMP-SA-0001`…`0005` come from 20:00–21:40, 250–600 m away along its azimuth. |
| `SCN-SHAH-ALAM-EVENT` | A 45k concert at Stadium Shah Alam on the last Saturday, 19:00–23:00. The two sectors facing it get +35 PRB, and there is complaint `CMP-SA-0101`. |
| `SCN-TRANSPORT-HUB` | On 26 Sep, 14:00–18:00, three microwave sites on hub CB3550 degrade during `RFC-INTEL-0001` on the hub, with `MW_LINK_DEGRADED` and `HIGH_PACKET_LOSS` alarms and degradation tickets. |
| `SCN-RECURRING-VSWR` | Three fibre sites raise `VSWR_HIGH` every 5–7 days. |
| `SCN-RECURRING-BACKHAUL` | One microwave site degrades for 1–2 hours on four evenings, with no maintenance planned. |
| `SCN-OUTAGE-PRECURSORS` | About 60% of total/partial outages are preceded, 1–3 days earlier, by a few hours of extra loss and latency and `KPI_DEGRADATION` warnings. This relationship is synthetic; it gives the Order 5 failure model something to learn. |
| `SCN-UPCOMING-EVENT` | `EVT-SA-FESTIVAL`: a 38,000-person festival at Stadium Shah Alam on Saturday 17 Oct, 18:00–23:00 MYT, after the window. Used by the Order 5 forecasts. |

**Provenance.**
- NetOps network data is synthetic (NetOps seed 42).
- Boundaries and places in NetOps are real public data (geoBoundaries, Overture). This server only uses site coordinates.
- Stadium Shah Alam's location is a public landmark.
- Weather values come only from Weather ML: ERA5-based replay or live Chronos inference, labelled as such.
- No real customer data is used.

**Times.** NetOps timestamps are read as Malaysia time (UTC+8, no DST) and stored as naive UTC.

## Tests and validation

Run from `backend/`: `uv run pytest netintel-mcp`. The tests use a small fake `netops.duckdb` built in `tests/conftest.py`, so they do not need the real data.

| Check | Result |
|---|---|
| Generator is deterministic (same input and seed give identical tables; checked on the real NetOps seed and in tests) | PASS |
| Hourly rows cover every cell for the 60-day window; times are UTC (midnight MYT is 16:00 UTC) | PASS |
| Daily mean PRB follows NetOps (within 4 points) | PASS |
| A NetOps total outage takes the site off air for its hours | PASS |
| The seven scenarios are present in the data | PASS |
| Complaint `CMP-SA-0001` gives congestion (high) on the right cell, good signal, and a capacity action | PASS |
| Congestion ranks the evening sector CRITICAL/HIGH with its busy hour at 19–23 | PASS |
| Correlation finds the three sites, the shared hub (strong) and the window 26 Sep 14:00 MYT | PASS |
| Exposure without Weather ML: indicator `null`, vulnerability only, warning given | PASS |
| Exposure with a Weather ML result (mocked in tests): indicator rules applied | PASS |
| Maintenance finds radio, backhaul and outage recommendations; every draft needs human approval | PASS |
| Tools never write to `intel.duckdb` | PASS |
| GeoJSON is valid: FeatureCollection, `[lng, lat]` inside Malaysia, properties contract | PASS |
| MCP server lists 5 read-only tools; envelope returned; bad input gives a tool error; `--search` collapses the listing | PASS |
| Existing backend tests (the other servers) still pass | PASS |
| Chat end to end (DeepSeek V4 Flash, headless Edge): the complaint card and the correlation card render and draw on the map | PASS |
| Live Weather ML (Chronos) from these tools | NOT VERIFIED: the Weather ML container was not running here. The client follows its documented `/api/predict-sites` contract, and tests cover that shape. |
| Podman deployment of Weather ML | NOT VERIFIED here (see `weather-ml-mcp/README.md`) |

## Known limitations

- Everything in the network is synthetic: the tools demonstrate the method on a coherent dataset, not the state of a real network.
- Causes and hypotheses come from transparent rules with thresholds stated in the output; they are plausible explanations, not proof.
- The serving cell is estimated from geometry. The transport topology (microwave site to nearest fibre hub) is a demo assumption.
- "Now" is the end of the synthetic window (2026-10-12 00:00 MYT), not the wall clock.
- Weather ML covers six cached locations. A site uses the nearest one within 50 km, so the result is coarse, and the replay window may not overlap a given incident.
- 4G only: NetOps 5G cells have daily KPIs, but the hourly extension covers the 2,405 4G cells.
- `intel-v2` (Order 5) widened the window from 28 to 60 days and added areas, an event history and outage precursors. The tools still look back at most 28 days by default.
