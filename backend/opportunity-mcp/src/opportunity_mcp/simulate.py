"""Business Decision Time Machine (Order 6): simulate three intervention strategies for one Order 4 opportunity.

A seeded Monte Carlo (numpy, 4,000 draws, 24 monthly steps) over transparent synthetic assumptions. Demand, ARPU and
take-up come from the opportunity's own Order 4 commercial assumptions; capacity and network risk from its graph
signals. Every output is a simulated range under stated assumptions: not historical ROI, not verified revenue and
not a causal effect. Same inputs give the same numbers.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

import numpy as np

DRAWS = 4_000
HORIZON_MONTHS = 24
LOSS_PROBABILITY_LIMIT = 0.25
RISK_LEVELS = ("low", "medium", "high")

# Illustrative synthetic assumptions per opportunity family (not TM pricing, cost or churn data).
FAMILY = {
    # cpa: sales/marketing cost per acquired customer; connect: installation/equipment per connection (fibre drop, FWA CPE, SIM)
    "sme_fibre": {"cpa_rm": (250, 400, 650), "connect_rm": (600, 900, 1500), "margin": (0.45, 0.60), "churn_monthly": (0.008, 0.015)},
    "sme_fwa": {"cpa_rm": (180, 300, 500), "connect_rm": (300, 500, 800), "margin": (0.40, 0.55), "churn_monthly": (0.012, 0.022)},
    "event_surge": {"cpa_rm": (40, 70, 120), "connect_rm": (10, 20, 40), "margin": (0.35, 0.50), "churn_monthly": (0.025, 0.045)},
}
RISK = {  # how network quality changes churn and acquisition cost, and what remediation would cost
    "low": {"churn_multiplier": 1.0, "cpa_multiplier": 1.0, "remediation_rm": 6_000},
    "medium": {"churn_multiplier": 1.5, "cpa_multiplier": 1.15, "remediation_rm": 15_000},
    "high": {"churn_multiplier": 2.5, "cpa_multiplier": 1.4, "remediation_rm": 30_000},
}
CUSTOMERS_PER_SITE_PER_10PCT_HEADROOM = 12  # new connections a site can onboard per 10% spare busy-hour capacity
CAPACITY_CUSTOMERS_PER_RM10K = 60  # extra onboarding capacity bought by network spend
RAMP_MONTHS = 3
STRATEGIES = {
    "campaign": {"name": "Targeted sales campaign", "summary": "All budget on acquisition from month 1; network risk unchanged."},
    "network_first": {"name": "Fix network, then sell", "summary": "Up to half the budget remediates and adds capacity (2-month lead time); the rest acquires from month 3."},
    "phased_pilot": {"name": "Phased pilot", "summary": "35% budget pilot for 3 months (sales cost +10%); scale the remaining 65% (sales cost -10%) only if uptake reaches 85% of expectation, otherwise stop and keep it."},
}
LIMITATIONS = [
    "Simulated with synthetic data and illustrative assumptions; not historical ROI, verified revenue or a forecast.",
    "Outputs are uncertainty ranges from random draws of the stated assumptions, not causal effects of an investment.",
    "Contribution is ARPU x assumed margin minus spend (sales cost plus installation/equipment per connection, paid from the budget); tax, discounting, depreciation and opex beyond the budget are excluded.",
]


def default_risk(opportunity: dict[str, Any]) -> str:
    """Graph-derived default: congestion or recent outages on the area's synthetic network raise the risk level."""
    nf = opportunity["network_feasibility"]
    if nf["availability_pct"] < 95 or nf["congested_sites"] >= 3:
        return "high"
    if nf["congested_sites"] >= 1 or nf["outages_30d"] >= 3:
        return "medium"
    return "low"


def default_headroom(opportunity: dict[str, Any]) -> float:
    prb = opportunity["network_feasibility"]["busy_prb_p95_mean"]
    return round(max(0.0, 100.0 - (prb if prb is not None else 100.0)), 1)


def _seed(*parts: Any) -> int:
    return int(hashlib.sha256(json.dumps(parts, sort_keys=True).encode()).hexdigest()[:16], 16)


def _demand(opportunity: dict[str, Any], rng: np.random.Generator, demand_multiplier: float) -> np.ndarray:
    cp = opportunity["commercial_potential"]
    if opportunity["kind"] == "event_surge":
        rate = cp.get("historical_signups_per_1k_footfall", 0) / 1000
        return cp["addressable"] * rate * rng.uniform(0.7, 1.3, DRAWS) * demand_multiplier
    low, high = cp["take_up_pct_assumed"]
    return cp["addressable"] * rng.uniform(low, high, DRAWS) / 100 * demand_multiplier


def _run(acquire: list[tuple[int, np.ndarray, np.ndarray]], churn: np.ndarray, revenue_per_customer: np.ndarray,
         spends: list[tuple[int, np.ndarray]]) -> dict[str, np.ndarray]:
    """acquire: (start month, customers, ramp) blocks; spends: (month, RM). Returns monthly cumulative contribution."""
    active = np.zeros(DRAWS)
    cumulative = np.zeros((HORIZON_MONTHS + 1, DRAWS))
    cash = np.zeros(DRAWS)
    for month in range(HORIZON_MONTHS + 1):
        for when, amount in spends:
            if when == month:
                cash -= amount
        if month > 0:
            active *= 1 - churn
            for start, customers, ramp in acquire:
                if start <= month < start + RAMP_MONTHS:
                    active += customers / RAMP_MONTHS * ramp
            cash += active * revenue_per_customer
        cumulative[month] = cash
    return {"cumulative": cumulative, "active": active}


def simulate(opportunity: dict[str, Any], budget_rm: float, demand_multiplier: float = 1.0,
             capacity_headroom_pct: float | None = None, network_risk: str | None = None) -> dict[str, Any]:
    kind = opportunity["kind"]
    family = FAMILY[kind]
    risk = network_risk or default_risk(opportunity)
    headroom = default_headroom(opportunity) if capacity_headroom_pct is None else float(capacity_headroom_pct)
    inputs = {"opportunity_id": opportunity["opportunity_id"], "budget_rm": round(float(budget_rm), 2), "demand_multiplier": round(demand_multiplier, 3),
              "capacity_headroom_pct": round(headroom, 1), "network_risk": risk,
              "network_risk_source": "user" if network_risk else "graph default", "horizon_months": HORIZON_MONTHS, "draws": DRAWS}
    rng = np.random.default_rng(_seed(inputs))
    demand = _demand(opportunity, rng, demand_multiplier)
    arpu = rng.uniform(*opportunity["commercial_potential"]["arpu_rm_month_assumed"], DRAWS)
    margin = rng.uniform(*family["margin"], DRAWS)
    base_churn = rng.uniform(*family["churn_monthly"], DRAWS)
    low, mode, high = family["cpa_rm"]
    connect = rng.triangular(*family["connect_rm"], DRAWS)
    cpa = rng.triangular(low, mode, high, DRAWS) * RISK[risk]["cpa_multiplier"] + connect
    capacity = opportunity["network_feasibility"]["sites"] * CUSTOMERS_PER_SITE_PER_10PCT_HEADROOM * headroom / 10
    revenue = arpu * margin
    ones = np.ones(DRAWS)
    results = {}

    # Targeted campaign: everything on acquisition now.
    customers = np.minimum.reduce([budget_rm / cpa, demand, np.full(DRAWS, capacity)])
    spend = customers * cpa
    results["campaign"] = (_run([(1, customers, ones)], base_churn * RISK[risk]["churn_multiplier"], revenue, [(0, spend)]),
                           spend, customers, budget_rm - spend)

    # Network first: remediation/capacity (fixing risk proportionally), acquisition after a 2-month lead time.
    remediation = min(budget_rm * 0.5, RISK[risk]["remediation_rm"])
    fixed = remediation / RISK[risk]["remediation_rm"]
    churn_multiplier = 1 + (RISK[risk]["churn_multiplier"] - 1) * (1 - fixed)
    cpa_fixed = (cpa - connect) / RISK[risk]["cpa_multiplier"] * (1 + (RISK[risk]["cpa_multiplier"] - 1) * (1 - fixed)) + connect
    capacity_nf = capacity + remediation / 10_000 * CAPACITY_CUSTOMERS_PER_RM10K
    customers = np.minimum.reduce([(budget_rm - remediation) / cpa_fixed, demand, np.full(DRAWS, capacity_nf)])
    acquisition = customers * cpa_fixed
    results["network_first"] = (_run([(3, customers, ones)], base_churn * churn_multiplier, revenue, [(0, np.full(DRAWS, remediation)), (2, acquisition)]),
                                remediation + acquisition, customers, budget_rm - remediation - acquisition)

    # Phased pilot: 35% now (small-scale CPA +10%, 40% of demand reachable); scale only if uptake clears the threshold.
    pilot_cpa = (cpa - connect) * 1.1 + connect
    pilot = np.minimum.reduce([budget_rm * 0.35 / pilot_cpa, demand * 0.4, np.full(DRAWS, capacity * 0.4)])
    scale = demand >= 0.85 * demand.mean()  # pilot uptake at least 85% of the mean expectation
    remaining_capacity = np.maximum(capacity - pilot, 0)
    scale_cpa = (cpa - connect) * 0.9 + connect
    scaled = np.where(scale, np.minimum.reduce([budget_rm * 0.65 / scale_cpa, demand - pilot, remaining_capacity]), 0.0)
    pilot_spend, scale_spend = pilot * pilot_cpa, scaled * scale_cpa
    results["phased_pilot"] = (_run([(1, pilot, ones), (4, scaled, ones)], base_churn * RISK[risk]["churn_multiplier"], revenue,
                                    [(0, pilot_spend), (3, scale_spend)]),
                               pilot_spend + scale_spend, pilot + scaled, budget_rm - pilot_spend - scale_spend)

    strategies = []
    for key, (run, spent, customers, unused) in results.items():
        net = run["cumulative"][-1]
        paid = run["cumulative"] >= 0
        payback = np.where(paid[1:].any(axis=0), paid[1:].argmax(axis=0) + 1, np.inf)
        within = np.isfinite(payback)
        p = lambda values, q: float(np.percentile(values, q))  # noqa: E731
        strategies.append({
            "strategy_id": key, **STRATEGIES[key],
            "expected_spend_rm": round(float(spent.mean()), -2), "budget_not_deployed_rm": round(float(np.maximum(unused, 0).mean()), -2),
            "customers_acquired": {"p10": round(p(customers, 10)), "p50": round(p(customers, 50)), "p90": round(p(customers, 90))},
            "net_contribution_24m_rm": {"mean": round(float(net.mean()), -2), "p10": round(p(net, 10), -2), "p50": round(p(net, 50), -2), "p90": round(p(net, 90), -2)},
            "monthly_contribution_m12_rm_p50": round(p(run["cumulative"][12] - run["cumulative"][11], 50), -1),
            "probability_of_loss_24m": round(float((net < 0).mean()), 3),
            "payback_month_p50": int(np.percentile(payback[within], 50)) if within.mean() >= 0.5 else None,
            "probability_payback_within_24m": round(float(within.mean()), 3),
            "scale_probability": round(float(scale.mean()), 3) if key == "phased_pilot" else None,
            "network_remediation_rm": remediation if key == "network_first" else 0,
            "monthly_cumulative_p50_rm": [round(p(run["cumulative"][m], 50), -2) for m in range(HORIZON_MONTHS + 1)],
        })
    eligible = [s for s in strategies if s["probability_of_loss_24m"] <= LOSS_PROBABILITY_LIMIT]
    if eligible:
        best = max(eligible, key=lambda s: (s["net_contribution_24m_rm"]["mean"], -s["probability_of_loss_24m"]))
        rule = f"Highest mean simulated 24-month contribution among strategies with loss probability <= {LOSS_PROBABILITY_LIMIT:.0%}."
    else:
        best = min(strategies, key=lambda s: (s["probability_of_loss_24m"], -s["net_contribution_24m_rm"]["mean"]))
        rule = f"No strategy meets the {LOSS_PROBABILITY_LIMIT:.0%} loss-probability limit; the least-risk option is shown. Consider not investing at this budget."
    return {
        "summary": f"{len(strategies)} strategies simulated for {opportunity['title']} at RM {budget_rm:,.0f}: recommended {best['name']} "
                   f"(mean 24-month contribution RM {best['net_contribution_24m_rm']['mean']:,.0f}, loss probability {best['probability_of_loss_24m']:.0%}).",
        "opportunity": {k: opportunity[k] for k in ("opportunity_id", "rank", "kind", "title", "where")},
        "inputs": inputs, "strategies": strategies,
        "recommendation": {"strategy_id": best["strategy_id"], "name": best["name"], "rule": rule, "computed": True},
        "assumptions": {"family": {k: list(v) for k, v in family.items()}, "network_risk": {"level": risk, **RISK[risk]},
                        "capacity_customers": round(capacity), "customers_per_site_per_10pct_headroom": CUSTOMERS_PER_SITE_PER_10PCT_HEADROOM,
                        "capacity_customers_per_rm10k_network_spend": CAPACITY_CUSTOMERS_PER_RM10K, "ramp_months": RAMP_MONTHS,
                        "demand_basis": opportunity["commercial_potential"]["assumption_basis"],
                        "arpu_rm_month": opportunity["commercial_potential"]["arpu_rm_month_assumed"]},
        "labels": {"inputs": "assumption-based", "outputs": "simulated", "data": "synthetic"},
        "limitations": LIMITATIONS, "synthetic": True,
    }
