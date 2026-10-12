# Commercial Opportunity Applications (Order 7)

Three commercial applications turn the existing intelligence into proposals a judge can read in about 20 seconds:
- the Revenue Leak Hunter;
- the Business Opportunity of Absence;
- Connectivity as a Product.

Each one shows an executive recommendation, a KPI or financial summary, the supporting evidence, map highlights, risks and assumptions, and the next business action.

**Everything is synthetic.** Every figure is calculated by small deterministic functions from the existing synthetic data and the stated assumptions:
- "Exposure" is revenue at risk, not lost revenue.
- "Indicative" prices are cost-plus estimates, not quotes.
- Nothing describes TM revenue, costs or customers.
- No service level is offered.

## Where it lives

```
Agents panel ─ Telco Opportunity Graph block ─ "Open commercial applications" (three tabs)
   │  /api/menara/call → opportunity_revenue_leaks | opportunity_absence_gaps | opportunity_event_packages   (~0.1 s)
   ▼
backend/opportunity-mcp :8127  commercial.py  (graph from Order 4 + intel.duckdb + ml.duckdb, read-only)
   │                           predictive.py  (optional Order 5 demand signals; degrades when mlpredict is not running)
   ├─ Kepler: one replaceable dataset "commercial-applications-focus", framed on the recommended result
   └─ "Explain with AI" → Hermes Business Hypothesis → the same tool → explanation; RM figures not in the result are flagged
```

There is no new service, database or reseeding. The work adds three tools to the existing Opportunity Graph MCP and one skill to the existing Business Hypothesis profile. The UI is a self-contained component mounted with one toggle in the existing opportunity block, so the Agents panel's own layout is unchanged.

## A. Revenue Leak Hunter

**Window:** the last 60 days of `intel.duckdb` (outages, alarms, complaints) and `ml.duckdb` booth outcomes.

- **Avoidable field visits per site.** The count is (outages − 1) for sites with 2 or more outages, plus (repeat VSWR or microwave alarms − 1) for sites with 3 or more such alarms. The first fault is treated as unavoidable and the repeats as avoidable. Equipment alarms are not outages, so nothing is counted twice, and each site belongs to exactly one area.
- **Avoidable opex:** visits × field-visit cost.
- **Preventive fix:** repeat-fault sites × fix cost.
- **Annualised run-rate:** 60-day opex × 365 ÷ 60, labelled as an extrapolation.
- **Fix payback:** fix cost ÷ daily avoidable opex.
- **Revenue exposure:** unique complaints at the affected sites with a network cause (Outage, Congestion, Coverage, Indoor coverage) × churn share × ARPU × 12 months. Each complaint is counted once. This is revenue at risk, not lost revenue.
- **Evidence only, with no RM value:**
  - underused sites (busy-hour PRB p95 below 35%);
  - booth sign-ups during degraded versus normal network. This rests on 12 synthetic booths, so it is a correlation only.

| Assumption | Low / mid / high |
|---|---|
| Field visit, RM | 900 / 1,200 / 2,000 |
| Preventive fix per site, RM | 4,000 / 6,000 / 9,000 |
| Churn after a network complaint | 5% / 8% / 12% |
| ARPU, RM/month | 60 / 80 / 100 |

**Demo (deterministic): Kota Bharu.**
- **Sites:** ED4765 (10 repeat VSWR alarms), ED1056 (3 outages) and EC3827 (2 outages), for 12 avoidable visits.
- **Cost of the repeats:** RM 14,400 (RM 10,800–24,000) in 60 days, or about RM 87,600 a year if the pattern continues.
- **Fix:** RM 18,000 once, paying back in about 75 days.
- **Exposure:** RM 200 over 12 months from 2 network complaints. It is small, and it is reported honestly.
- **Also flagged:** Miri and Butterworth.

## B. Business Opportunity of Absence

Each area is classified from separate kinds of evidence. An area can hold several classes.

| Class | Rule | Meaning |
|---|---|---|
| Verified serviceability gap | fibre-serviceable below 60% (synthetic serviceability records) **and** at least 10 signal measurements | The gap is verified in the synthetic records, and the radio coverage there has been measured |
| Known capacity constraint | busy-hour PRB p95 mean of 70% or more, or 2 or more congested sites | Demand would hit a constrained network |
| Missing or insufficient information | fewer than 10 signal measurements (14 of 38 areas have none) | Coverage is **unverified, not absent**: survey before any investment |

Demand percentile ranks unserved SMEs (SMEs × (1 − TM penetration)), weighted up by broadband enquiries. The strongest-demand area of each class is shown, so all three kinds of evidence are visible.

The indicative opportunity reuses the Order 4 SME assumptions, which fit SME broadband:
- **Fibre-gap and unverified areas:** fixed-wireless economics (take-up 4–8%, ARPU RM 100–200).
- **Capacity areas:** fibre economics (take-up 3–6%, ARPU RM 150–300).

Each figure states its condition, for example "only after the survey or upgrade confirms serviceability".

**Order 5:** if mlpredict-mcp (:8126) answers within 4 s, its `get_business_demand_signals` values are attached as supplementary context. They never change a class, rank or figure. When the service is not running, as on this Mac, the result says "Order 5 predictive service unavailable … graph-derived evidence used".

**Demo:**
- **George Town, verified gap:** 58% fibre-serviceable, 24 measurements showing good RSRP, so a fixed-wireless offer is feasible. RM 9,200–36,700 a month, indicative.
- **Miri, capacity constraint:** PRB p95 71.4%. A capacity study comes first.
- **Tawau, missing information:** 0 measurements. Survey first; do not invest or market yet.

## C. Connectivity as a Product

The default event is the Order 4 event-connectivity opportunity: `EVT-MELAKA-20261025`, "Match in Melaka Tengah", 25 Oct 2026, 37,587 expected attendees (synthetic). Any upcoming event can be selected with `event_id`.

The economics are event-specific (cost items plus a 35% cost-plus margin). The Order 6 SME acquisition model is **not** reused because its assumptions do not fit an event.

- **Attendee peak demand:** attendance × 30% on-network share × 50% peak concurrency × 0.3 Mbps.
- **Headroom:** for each site within 2 km, 450 Mbps × (1 − busy-hour PRB p95).
- **Melaka:** 1,691 Mbps of demand against 1,621 Mbps of headroom from 11 sites, so 96% is covered.

| Package | Cost items (RM) | Conditions | Melaka |
|---|---|---|---|
| Event-day capacity boost | Cell-on-wheels deploy 15,000 + operation 4,000 + tether 3,000 + engineers 1,600 = 23,600 → **RM 31,900** | A fibre site within 2 km to tether to, at 99.0% availability or more with no outage in 30 days | **feasible** (tether SM8109) |
| Vendor and ticketing connectivity | 40 FWA kits 4,800 + 40 SIMs 1,000 + support 2,400 = 8,200 → **RM 11,100** | 800 Mbps left after the attendee peak, alone or with the boost | **conditional**: sell only bundled |
| Media uplink (best effort, no SLA) | Engineering 6,000 + engineer 2,000 + temporary hop 7,500 = 15,500 → RM 20,900 | A fibre site within 1 km with busy-hour PRB p95 below 60% and no 30-day outage | **infeasible**: the best site is at 62.8% |

The engine computes the offered bundle's total: indicative RM 43,000 (cost RM 31,800, margin RM 11,200).

The draft proposal:
- names the offered packages and their prices;
- explicitly rejects the infeasible one and says why;
- says "best effort with no service guarantee; final scope and price follow a site survey".

A package whose conditions are not met is rejected, and it is never priced into the proposal.

## Hermes (explain only)

The Business Hypothesis profile has the three tools and the `elevate-commercial-applications` skill: call the named tool once, then report its headline, figures, evidence, risks and next action.

`elevate_hermes/commercial.py` checks every "RM …" amount in the report against the numbers in the computed result, allowing honest rounding. Anything else is flagged as "RM figures not found in the computed result".

In the first live run, the agent added two package prices together itself (RM 43,000), and the check flagged it. The engine now computes that total, and the re-run (`374d5a8f…`, 88 s) had no flags.

## Verification (2026-10-13, branch `feat/order7-commercial-applications`)

- **Determinism:** identical inputs give identical outputs (hash-checked through Next.js). The Order 4 discovery and Order 6 simulation hashes are unchanged (`6ffff71dfde0`, `bed1c7ca8cd3`).
- **Tests:**
  - opportunity-mcp 15/15, of which 6 are new commercial tests: determinism, figures recomputed from evidence, no double counting, missing data never verified, infeasible packages rejected and kept out of the proposal, and optional predictive enrichment both up and down;
  - netintel 20/20;
  - Hermes 52/52 (the money-figure guard, and only the Hypothesis profile holding the tools);
  - Weather 46/46;
  - frontend 26/26.
- **Lint and build:** frontend lint is clean, TypeScript is clean, and `next build` passes.
- **Browser (headless Chrome, live services):**
  - all three tabs load in under 1.8 s, with labels and map highlights;
  - with the engine stopped, the panel shows "not reachable … Start it with …" and a Retry button, and Retry recovers once the engine is back;
  - no console errors from this code.
- **Screenshots:** [revenue-leak-hunter](order7/revenue-leak-hunter.jpg), [opportunity-of-absence](order7/opportunity-of-absence.jpg), [connectivity-as-a-product](order7/connectivity-as-a-product.jpg).

## Limitations

- All data and assumptions are illustrative and synthetic. Field-visit, fix, churn, ARPU, package costs and prices are not TM figures.
- The Leak Hunter's revenue exposure is small in the current synthetic data, because few network complaints sit on the repeat-fault sites. It is not inflated.
- A "verified gap" is verified only in the synthetic serviceability records. Weak-signal shares are low everywhere (at most 9%).
- Event readiness uses 7-day synthetic KPIs and a simple capacity model. It is not an RF plan or a capacity guarantee.
- Order 5 live demand signals are optional and were not exercised end to end on this Mac (mlpredict is not running). The degraded path was verified live, and the available path only through a unit test with a fake client.
- After adding tools to a running MCP server, the frontend reconnects once when a tool is missing (`lib/menara/call.ts`), so a dev-server restart is no longer needed.
