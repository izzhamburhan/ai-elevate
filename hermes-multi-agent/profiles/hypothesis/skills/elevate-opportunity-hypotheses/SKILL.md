---
name: elevate-opportunity-hypotheses
description: Discover ranked TM opportunities from the Telco Opportunity Graph, form one testable hypothesis each, have Engineer validate network feasibility, and report where, why and what to do.
---

# Opportunity discovery procedure

Finish after exactly these steps:

1. Call `opportunity_discover(top_k=3)` once. Keep each opportunity's rank, opportunity_id, area, supporting_site_ids, scores, confidence, indicative range and risks exactly as returned.
2. Call `delegate_specialist` once with `agent_id="engineer"`. In the task, list every supporting Site_ID from all three opportunities and ask for:
   `get_ran_kpi(level="site", site_id="<all IDs comma-separated>", kpi="dl_prb_utilization,dl_user_throughput,cell_availability", technology="4g", start_date="2026-10-11", end_date="2026-10-11")` and
   `get_ntt_tickets(technology="4g", site_id="<same IDs>", start_date="2026-09-12", end_date="2026-10-11", page_size=20)`, reporting values per Site_ID. Say explicitly: exactly two calls, all IDs comma-separated in one site_id string, no per-site calls.
3. Write the final report. For each opportunity, in rank order:
   - **Where**: area and supporting Site_IDs.
   - **Why**: the one or two strongest returned signals.
   - **Hypothesis**: one testable sentence.
   - **Network feasibility**: "supported", "supported with risk" or "not validated", citing the Engineer's actual values (PRB %, availability %, tickets). Availability below 99.5% or PRB at or above 80% is a risk.
   - **What TM should do**: the returned action, adjusted only to add a validation risk.
   - **Indicative potential**: the returned RM range with "indicative, synthetic assumptions".
   - **Confidence and risks**: as returned.

Keep each field to one line and stop after opportunity 3: no closing summary section. Do not call other tools, repeat discovery, or delegate more than once. All data is synthetic.
