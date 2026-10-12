# Business Decision Time Machine (Order 6)

Decision-makers pick one of the three opportunities Order 4 discovered (Johor Bahru, Melaka or George Town). They set a budget and their assumptions, and instantly compare three investment strategies on simulated cost, return range, downside risk and payback. Hermes then explains the trade-offs.

**Everything is synthetic, simulated or assumption-based.**
- The inputs are illustrative assumptions over synthetic data.
- The outputs are uncertainty ranges from a seeded Monte Carlo.
- None of it is historical ROI, verified revenue, a forecast or a causal effect.
- The numbers and the recommendation are computed; the AI explains them and cannot change them.

## Pitch flow (2–3 minutes)

1. Open the workspace **Agents** panel and click **Open Decision Time Machine**. Johor Bahru is preselected, and the map zooms to its area and supporting sites (cyan).
2. At RM 20,000, three strategies appear in about 0.5 s. Click **Pin as baseline**.
3. Drag the budget to RM 50,000. The result updates in about 0.3 s, and each strategy shows its change against the RM 20,000 baseline.
4. Read the computed recommendation and its rule.
5. Click **Explain with AI**. The Business Hypothesis agent explains the trade-offs in about 1.5–2 minutes, using the computed numbers only.

| Johor Bahru, demand ×1.0, graph-default risk (medium) | Campaign | Fix network, then sell | Phased pilot |
|---|---|---|---|
| RM 20,000: mean 24-month contribution (p10 to p90) | RM 10,800 (1,200 to 21,400) | −RM 4,800 (−9,500 to 500) | RM 7,300 (0 to 17,100) |
| RM 20,000: loss probability / payback | 7% / month 15 | 88% / not within 24 months | 10% / month 17 |
| RM 50,000: mean contribution (p10 to p90) | RM 26,900 (2,300 to 53,100) | RM 5,200 (−12,500 to 24,100) | RM 18,400 (−300 to 42,900) |
| RM 50,000: loss probability / payback | 7% / month 15 | 40% / month 20 | 11% / month 17 |

The computed recommendation is the targeted sales campaign at both budgets. The comparison shows the trade-offs:
- Fixing the network first only starts to pay off at the larger budget.
- The pilot keeps an average of RM 9,100 in reserve, at a lower expected return.

Other cases:
- **Melaka:** the event opportunity is demand-limited. Only about RM 1,700 of acquisition spend can be deployed, and the rest is shown as "not deployable".
- **George Town at high network risk:** no strategy meets the loss limit. The rule then shows the least-risky option and advises considering not investing.

## How it works (reuses existing components)

```
Agents panel ─ Decision Time Machine (sliders, charts, baseline)
   │  /api/menara/call → opportunity_simulate        (~40 ms warm; deterministic)
   ▼
backend/opportunity-mcp :8127  simulate.py  ← the Order 4 opportunity from rank.discover (graph over intel/ml + SME seed)
   │
   ├─ Kepler: cyan focus layer "decision-time-machine-focus" (the opportunity and its supporting sites)
   └─ "Explain with AI" → /api/hermes → Hermes "hypothesis" profile → opportunity_simulate (same inputs) → explanation
                                          job.simulation = the computed recommendation; any contradicting prose is flagged
```

No new service, model or database was added. `opportunity_simulate` is a fourth tool on the existing Opportunity Graph MCP. The Business Hypothesis profile gains that tool and a second skill, `elevate-decision-time-machine`. Its explanation run needs no delegation, so it finishes in roughly 90–100 s.

## Calculation

There are 4,000 seeded draws and 24 monthly steps. The seed is a SHA-256 of the inputs, so the same inputs always give the same numbers.

**Inputs from Order 4**, per opportunity:
- addressable demand (SMEs, or event attendees × the historical synthetic booth sign-up rate);
- take-up and ARPU ranges;
- number of sites;
- busy-hour PRB, which sets the default spare capacity as 100 − PRB p95.

The default network risk comes from the graph:
- **high:** availability below 95% or at least 3 congested sites;
- **medium:** at least 1 congested site or at least 3 outages in 30 days;
- **low:** otherwise.

The user can override the risk. The panel also shows Order 4's validated feasibility verdict when one is loaded.

| Assumption (illustrative) | SME fibre | SME fixed wireless | Event surge |
|---|---|---|---|
| Sales cost per acquired customer, RM (triangular) | 250 / 400 / 650 | 180 / 300 / 500 | 40 / 70 / 120 |
| Installation or equipment per connection, RM (triangular) | 600 / 900 / 1,500 | 300 / 500 / 800 | 10 / 20 / 40 |
| Contribution margin on ARPU | 45–60% | 40–55% | 35–50% |
| Base monthly churn | 0.8–1.5% | 1.2–2.2% | 2.5–4.5% |

| Network risk | Churn × | Sales cost × | Remediation that fixes it, RM |
|---|---|---|---|
| low | 1.0 | 1.0 | 6,000 |
| medium | 1.5 | 1.15 | 15,000 |
| high | 2.5 | 1.4 | 30,000 |

The calculation runs in these steps:
- **Customers:** min(budget ÷ cost per customer, demand × demand multiplier, capacity). Capacity is sites × 12 × spare-capacity % ÷ 10, an assumed onboarding capacity per site.
- **Ramp-up:** new customers arrive evenly over 3 months.
- **Monthly contribution:** active customers × ARPU × margin, with churn applied every month.
- **24-month contribution:** total contribution minus spend.
- **Payback:** the first month the cumulative total turns positive.
- **Loss probability:** the share of draws below RM 0 at month 24.

The three strategies:
- **Targeted sales campaign:** the whole budget goes on acquisition from month 1. The network risk stays as it is.
- **Fix network, then sell:** up to half the budget pays for remediation, up to that risk level's cost. The share fixed reduces both the churn penalty and the sales-cost penalty, and each RM 10,000 adds capacity for 60 customers. Remediation is paid at month 0, and acquisition starts at month 3 (a 2-month lead time).
- **Phased pilot:** 35% of the budget funds a 3-month pilot, reaching 40% of demand at sales cost +10%. The remaining 65% is spent from month 4, at sales cost −10%, only when uptake is at least 85% of the mean expectation (about 72% of draws). Otherwise it is held back.

**Recommendation rule (deterministic):** among strategies with a loss probability of 25% or less, pick the highest mean 24-month contribution. If none qualifies, show the least-risky one and say so.

## Agent explanation guard

`elevate_hermes/decision.py` stores the run's last successful simulation as `job.simulation`. That includes its inputs, strategies and computed recommendation.

If the report's recommendation line names a different strategy, the job gets a warning that the report contradicts the computed simulation. The UI's recommendation always comes from the simulation, never from the prose.

## Verification (2026-10-13)

- **Tests:**
  - opportunity-mcp: 9/9, including determinism, three ranged strategies, the recommendation rule, assumption directions, and the server tool and errors;
  - netintel: 20/20;
  - Hermes: 49/49, including the decision contract and that only the Business Hypothesis profile can call the simulator;
  - frontend: 23/23, including the labelling schema, exact explain inputs, verdict-to-risk mapping and baseline deltas.
- **Lint and build:** frontend lint is clean, and `next build` with TypeScript passes.
- **Browser, end to end (headless Chrome against the live dev server):**
  - first result in 0.5 s for Johor Bahru at RM 20,000;
  - pinned baseline, moved to RM 50,000, and the "updating" state showed until the new result arrived about 0.3 s later;
  - correct deltas against the baseline;
  - map focus on Johor Bahru.
- **Explanation, started from the browser:** run `a357e66c…` completed in 92 s. It made one `opportunity_simulate` call with the exact inputs and copied every number and the recommendation, with no contradictions. The earlier API run `6573a12e…` used the pre-installation-cost simulator and is superseded.

## Limitations

- Synthetic data and illustrative assumptions throughout. Contribution is not profit: tax, discounting, depreciation and costs beyond the budget are excluded.
- The strategies are stylised. Fix-network-first is charged in full against the new customers it helps acquire; protecting existing revenue is not counted, so it looks weak unless risk and budget are high.
- Live Order 5 Predictive ML inference is not called. The opportunity reuses Predictive ML data (footfall, booth sign-ups, rain) through the graph. On this Mac the mlpredict models are not trained, and LightGBM needs Homebrew `libomp`, which is not installed.
- The agent's prose can still mischaracterise ratios. For example, it called 7% → 39.5% "nearly doubles". The copied numbers and the recommendation stay correct and are checked.
- After restarting the dev server, a stale `frontend/.next` dev cache caused a page-reload loop. Clearing `.next` fixed it.
