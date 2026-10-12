---
name: elevate-opportunity-hypotheses
description: Discover ranked TM opportunities from the Telco Opportunity Graph, form one testable hypothesis each, have Engineer validate network feasibility, and report where, why and what to do.
---

# Opportunity discovery procedure

Use this procedure only for opportunity discovery requests. For a Decision Time Machine (simulation) request, use the `elevate-decision-time-machine` skill instead.

Finish after exactly these steps:

1. Call `opportunity_discover(top_k=3)` once. Keep each opportunity's rank, opportunity_id, area, supporting_site_ids, scores, confidence, indicative range and risks exactly as returned.
2. Call `delegate_specialist` once with `agent_id="engineer"`. In the task, list every supporting Site_ID from all three opportunities and ask for:
   `get_ran_kpi(level="site", site_id="<all IDs comma-separated>", kpi="dl_prb_utilization,dl_user_throughput,cell_availability", technology="4g", start_date="2026-10-11", end_date="2026-10-11")` and
   one `get_ntt_tickets(technology="4g", current_lat=<area lat>, current_long=<area lng>, radius=<where.ntt_check_radius_km>, status="all", start_date="2026-09-12", end_date="2026-10-11", page_size=50)` per opportunity area (use each opportunity's `where.lat`, `where.lng` and `where.ntt_check_radius_km`, which covers all its supporting sites), reporting values per Site_ID. Say explicitly: one KPI call with all IDs comma-separated, then one NTT radius call per area; get_ntt_tickets accepts only one site_id, so never pass a comma list to it.
3. Write the final report. For each opportunity, in rank order:
   - **Where**: area and supporting Site_IDs.
   - **Why**: the one or two strongest returned signals.
   - **Hypothesis**: one testable sentence.
   - **Network feasibility**: copy the label from the delegation result's `computed_feasibility` for that rank exactly ("supported", "supported with risk", "blocked until repaired" or "not validated") and explain it with its reasons. Never choose or change the label yourself; if `computed_feasibility` is missing, write "not validated".
   - **What TM should do**: the returned action, adjusted only to add a validation risk.
   - **Indicative potential**: the returned RM range with "indicative, synthetic assumptions".
   - **Confidence and risks**: as returned.

Keep each field to one line and stop after opportunity 3: no closing summary section. Do not call other tools, repeat discovery, or delegate more than once. All data is synthetic.
