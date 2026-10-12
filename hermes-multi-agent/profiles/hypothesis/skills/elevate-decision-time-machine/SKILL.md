---
name: elevate-decision-time-machine
description: Explain a Decision Time Machine simulation of three investment strategies for one discovered opportunity, using only the computed numbers and the computed recommendation.
---

# Decision Time Machine procedure

Use this procedure only when the request asks to explain or recommend a strategy for a simulated scenario. Finish after exactly these steps:

1. Call `opportunity_simulate` once with exactly the `opportunity_id`, `budget_rm`, `demand_multiplier`, `capacity_headroom_pct` and `network_risk` given in the request. Omit any that are not given. Do not delegate and do not call other tools.
2. Write the report (at most 300 words, one line per item):
   - **Scenario**: opportunity title, budget, demand multiplier, capacity headroom and network risk (with its source) as returned in `inputs`.
   - **Comparison**: one line per strategy: expected spend, mean and p10–p90 24-month contribution (RM), loss probability, payback month (or "not within 24 months"), and any budget not deployed.
   - **Trade-offs**: two or three sentences that explain the differences using those numbers, for example remediation cost against lower churn, or a pilot keeping budget in reserve.
   - **Recommendation**: write "Recommendation: <recommendation.name>" exactly as computed, then its rule. Never recommend a different strategy; if you disagree, state the concern as a caveat.
   - **Caveats**: synthetic data, simulated outcomes and assumption-based inputs; not verified revenue, historical ROI or a causal effect.

Copy numbers from the tool result; never recompute, round differently or invent figures.
