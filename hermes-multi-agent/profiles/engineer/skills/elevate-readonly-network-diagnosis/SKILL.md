---
name: elevate-readonly-network-diagnosis
description: Investigate actual NetOps synthetic inventory, RAN KPIs, congestion and incident records with date alignment, evidence-based recommendations and no state-changing operations.
---

# Read-only network investigation

For any Selangor/Shah Alam rainfall-exposure or network-health request (Shah Alam is the bounded representative Selangor cluster), finish after this sequence, even if the coordinator's wording suggests other tools:

1. `get_sites(technology="4g", cluster="Shah Alam", page_size=3)`. Use page_size 3, not a larger page.
2. Copy an exact returned `site_id` into `get_ran_kpi(level="site", site_id=<returned ID>, kpi="dl_prb_utilization,dl_user_throughput,cell_availability", technology="4g", start_date="2026-09-25", end_date="2026-09-25")`.
3. Always call `get_ntt_tickets(technology="4g", site_id=<the same returned IDs>, start_date="2026-09-25", end_date="2026-09-26", page_size=10)` before stating anything about incidents.

Do not pass a `site_name` such as `CB5348_SHAHALAM` where `site_id` such as the source-confirmed `CB5348` is required. Do not guess unsupported `throughput`, `latency`, or `packet_loss` KPI names. Do not request hourly granularity because the existing service supplies daily/weekly/monthly records. Report the actual daily evidence and its limitations, then stop instead of repeating diagnosis calls. You have no weather tools; weather analysis is the Forecast specialist's task.

For other investigations:

1. Discover relevant inventory with `get_sites` (`technology`, optional `region`/`cluster`) or `search_sites` (`site_id` partial ID/name). A Shah Alam investigation uses `get_sites(technology="4g", cluster="Shah Alam")`; retain returned IDs.
2. Read `get_site_info` or `get_ran_site_info` for selected returned sites. Coordinates are WGS84. `get_site_cells` supplies cell identity details when needed.
3. Read `get_ran_kpi_summary` for the actual KPI catalogue and available date range. Query `get_ran_kpi` with `level="site"`, selected site IDs, `technology="4g"`, and supported KPI names such as `dl_prb_utilization`, `dl_user_throughput`, `cell_availability`. These are daily metrics unless a supported aggregation is requested.
4. For the Chronos replay use explicit network dates September 25–26, 2026. Query `get_ntt_tickets` for selected site/date windows. Use `get_congested_cells`, maintenance or coverage tools only when useful and disclose the returned snapshot dates.
5. Correlate synthetic evidence conservatively. Higher PRB and lower throughput support a congestion hypothesis only when the actual tool values support it. Weather exposure cannot establish an outage cause, and daily KPI data cannot demonstrate an evening-hour pattern.
6. Return evidence with source references, units, dates, exact IDs/coordinates, known limitations and proposed diagnostic/maintenance checks. All recommendations require human execution.
7. Record a concise source-linked investigation note in your own private Hermes memory.

Never use ticket mutation tools or unrestricted shell. A missing NetOps service must produce an explicit failure. No new predictive outage or network ML model is included here.
