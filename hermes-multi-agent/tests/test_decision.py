"""Order 6 Decision Time Machine contract. Fixtures are explicitly synthetic, not runtime evidence."""
from elevate_hermes.decision import contradictions, from_tasks
from elevate_hermes.mcp_access import AGENT_TOOL_ALLOWLISTS


def simulation_call(ok=True, recommended="campaign"):
    names = {"campaign": "Targeted sales campaign", "network_first": "Fix network, then sell", "phased_pilot": "Phased pilot"}
    strategies = [{"strategy_id": key, "name": name, "expected_spend_rm": 20000.0, "net_contribution_24m_rm": {"mean": 1.0, "p10": 0.0, "p50": 1.0, "p90": 2.0},
                   "probability_of_loss_24m": 0.1, "payback_month_p50": 12, "extra": "dropped"} for key, name in names.items()]
    data = {"synthetic": True, "data": {"inputs": {"opportunity_id": "OPP-FIXTURE", "budget_rm": 20000.0}, "strategies": strategies,
                                        "recommendation": {"strategy_id": recommended, "name": names[recommended], "rule": "fixture", "computed": True}}}
    return {"ok": ok, "tool": "opportunity_simulate", "data": data}


def test_latest_successful_simulation_is_authoritative():
    tasks = [{"task_id": "h", "agent_id": "hypothesis", "tool_calls": [simulation_call(recommended="phased_pilot"), simulation_call(), simulation_call(ok=False, recommended="network_first")]}]
    result = from_tasks(tasks, "h")
    assert result["recommendation"]["name"] == "Targeted sales campaign"
    assert len(result["strategies"]) == 3 and "extra" not in result["strategies"][0]
    assert from_tasks([{"task_id": "h", "agent_id": "hypothesis", "tool_calls": []}], "h") is None


def test_report_recommending_another_strategy_is_flagged():
    simulation = from_tasks([{"task_id": "h", "agent_id": "hypothesis", "tool_calls": [simulation_call()]}], "h")
    agrees = "**Recommendation**: Recommendation: Targeted sales campaign. Phased pilot keeps budget in reserve."
    assert contradictions(agrees, simulation) == []
    assert contradictions("Comparison: Phased pilot RM 5,800\nTrade-offs: the pilot keeps budget.", simulation) == []
    assert contradictions("**Recommendation**: Phased pilot is safer.", simulation) == ["report recommends 'Phased pilot', computed 'Targeted sales campaign'"]


def test_simulator_is_only_available_to_the_business_hypothesis_profile():
    holders = {agent for agent, services in AGENT_TOOL_ALLOWLISTS.items() for tools in services.values() if "opportunity_simulate" in tools}
    assert holders == {"hypothesis"}
