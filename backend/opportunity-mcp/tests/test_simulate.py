"""Decision Time Machine simulation over the small fake network (explicitly synthetic fixtures)."""

from __future__ import annotations

import json

import pytest
from opportunity_mcp import graph, rank, simulate


@pytest.fixture()
def opportunities(built):
    return rank.discover(graph.build(built["intel"], built["ml"], built["sme"]), 3)["opportunities"]


def test_same_inputs_give_identical_results_and_inputs_change_the_seed(opportunities):
    o = opportunities[0]
    first, second = simulate.simulate(o, 20_000), simulate.simulate(o, 20_000)
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)
    assert first["strategies"] != simulate.simulate(o, 50_000)["strategies"]


def test_three_strategies_with_ranges_costs_and_labels(opportunities):
    result = simulate.simulate(opportunities[0], 30_000)
    assert [s["strategy_id"] for s in result["strategies"]] == ["campaign", "network_first", "phased_pilot"]
    for s in result["strategies"]:
        net = s["net_contribution_24m_rm"]
        assert net["p10"] <= net["p50"] <= net["p90"]
        assert 0 <= s["probability_of_loss_24m"] <= 1 and 0 <= s["probability_payback_within_24m"] <= 1
        assert 0 <= s["expected_spend_rm"] <= 30_000 + 100 and s["budget_not_deployed_rm"] >= 0
        assert len(s["monthly_cumulative_p50_rm"]) == simulate.HORIZON_MONTHS + 1
    assert result["labels"] == {"inputs": "assumption-based", "outputs": "simulated", "data": "synthetic"}
    assert result["synthetic"] is True and any("not historical ROI" in line for line in result["limitations"])


def test_recommendation_follows_the_stated_rule(opportunities):
    for o in opportunities:
        for budget in (10_000, 50_000):
            result = simulate.simulate(o, budget)
            strategies = {s["strategy_id"]: s for s in result["strategies"]}
            chosen = strategies[result["recommendation"]["strategy_id"]]
            eligible = [s for s in strategies.values() if s["probability_of_loss_24m"] <= simulate.LOSS_PROBABILITY_LIMIT]
            if eligible:
                assert chosen["net_contribution_24m_rm"]["mean"] == max(s["net_contribution_24m_rm"]["mean"] for s in eligible)
            else:
                assert chosen["probability_of_loss_24m"] == min(s["probability_of_loss_24m"] for s in strategies.values())


def test_assumptions_move_outcomes_in_the_expected_direction(opportunities):
    o = next(o for o in opportunities if o["kind"] != "event_surge") if any(o["kind"] != "event_surge" for o in opportunities) else opportunities[0]
    low = simulate.simulate(o, 30_000, demand_multiplier=0.5)["strategies"][0]
    high = simulate.simulate(o, 30_000, demand_multiplier=1.5)["strategies"][0]
    assert low["customers_acquired"]["p50"] <= high["customers_acquired"]["p50"]
    starved = simulate.simulate(o, 30_000, capacity_headroom_pct=0)["strategies"][0]
    assert starved["customers_acquired"]["p90"] == 0 and starved["probability_of_loss_24m"] == 0.0  # nothing deployable, nothing spent
    safe, risky = simulate.simulate(o, 30_000, network_risk="low"), simulate.simulate(o, 30_000, network_risk="high")
    assert risky["strategies"][0]["net_contribution_24m_rm"]["mean"] <= safe["strategies"][0]["net_contribution_24m_rm"]["mean"]
    assert risky["strategies"][1]["network_remediation_rm"] >= safe["strategies"][1]["network_remediation_rm"]
