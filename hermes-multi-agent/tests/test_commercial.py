"""Order 7 guard: Hermes explains computed commercial results without adding money figures. Synthetic fixtures."""
from elevate_hermes.commercial import from_tasks, unverified_figures
from elevate_hermes.mcp_access import AGENT_TOOL_ALLOWLISTS

RESULT = {"synthetic": True, "data": {"application": "connectivity_as_a_product", "headline": "Offer the capacity boost",
                                      "packages": [{"cost_rm": 23600, "indicative_price_rm": 31900}, {"cost_rm": 8200, "indicative_price_rm": 11100}],
                                      "proposal": "Event-day capacity boost: indicative RM 31,900."}}


def test_latest_successful_commercial_call_is_authoritative():
    tasks = [{"task_id": "h", "agent_id": "hypothesis", "tool_calls": [
        {"ok": True, "tool": "opportunity_event_packages", "data": RESULT},
        {"ok": False, "tool": "opportunity_revenue_leaks", "data": {}}]}]
    computed = from_tasks(tasks, "h")
    assert computed["application"] == "connectivity_as_a_product" and computed["headline"] == "Offer the capacity boost"
    assert from_tasks([{"task_id": "h", "agent_id": "hypothesis", "tool_calls": []}], "h") is None


def test_money_the_tool_never_computed_is_flagged():
    data = RESULT["data"]
    assert unverified_figures("Capacity boost RM 31,900 (cost RM 23,600); vendors RM 11,100.", data) == []
    assert unverified_figures("About RM 32k for the boost.", data) == []  # honest rounding of the computed RM 31,900
    assert unverified_figures("About RM 35k for the boost.", data) == ["RM 35k"]
    assert unverified_figures("Expected profit RM 50,000 and RM 31,900.", data) == ["RM 50,000"]


def test_only_the_business_hypothesis_profile_can_run_commercial_tools():
    for tool in ("opportunity_revenue_leaks", "opportunity_absence_gaps", "opportunity_event_packages"):
        holders = {agent for agent, services in AGENT_TOOL_ALLOWLISTS.items() for tools in services.values() if tool in tools}
        assert holders == {"hypothesis"}
