"""Order 7 commercial applications over the small fake network (explicitly synthetic fixtures)."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest
from opportunity_mcp import commercial, graph, predictive, rank


@pytest.fixture()
def og(built):
    return graph.build(built["intel"], built["ml"], built["sme"])


def test_all_three_applications_are_deterministic(og, built):
    for run in (lambda: commercial.revenue_leaks(og, 3, built["intel"], built["ml"]), lambda: commercial.absence_gaps(og, built["intel"]),
                lambda: commercial.event_packages(og)):
        assert json.dumps(run(), sort_keys=True, default=str) == json.dumps(run(), sort_keys=True, default=str)


def test_leak_figures_recompute_from_evidence_without_double_counting(og, built):
    result = commercial.revenue_leaks(og, 5, built["intel"], built["ml"])
    for area in result["results"]:
        visits = area["evidence"]["avoidable_field_visits"]
        assert visits == sum(s["avoidable_visits"] for s in area["affected_sites"])
        for site in area["affected_sites"]:
            expected = (site["outages_60d"] - 1 if site["outages_60d"] >= 2 else 0) + (site["repeat_equipment_alarms_60d"] - 1 if site["repeat_equipment_alarms_60d"] >= 3 else 0)
            assert site["avoidable_visits"] == expected > 0
        assert area["avoidable_opex_rm"]["mid"] == round(visits * commercial.LEAK["field_visit_rm"][1], -2)
        assert area["preventive_fix_cost_rm"]["mid"] == round(len(area["affected_sites"]) * commercial.LEAK["preventive_fix_rm"][1], -2)
        complaints = area["evidence"]["network_complaints_60d_unique"]
        assert sum(area["evidence"]["complaint_causes"].values()) == complaints  # each complaint counted once
        for key in ("avoidable_opex_rm", "preventive_fix_cost_rm", "revenue_exposure_rm"):
            assert area[key]["low"] <= area[key]["mid"] <= area[key]["high"]
    assert any("not lost revenue" in c for c in result["caveats"])
    sites = [s["site_id"] for a in result["results"] for s in a["affected_sites"]]
    assert len(sites) == len(set(sites))  # a site belongs to one area only


def test_absence_never_treats_missing_data_as_a_verified_gap(og, built):
    result = commercial.absence_gaps(og, built["intel"])
    for r in result["results"]:
        measured = r["evidence"]["signal_measurements"] >= commercial.ABSENCE["measurements_needed"]
        if r["classification"] == "verified_gap":
            assert measured and r["evidence"]["fibre_serviceable_pct"] < commercial.ABSENCE["verified_gap_fibre_serviceable_below_pct"]
        if r["classification"] == "insufficient_information":
            assert not measured and "unverified, not absent" in r["technical_constraint"]
            assert "Survey first" in r["recommended_action"]
        assert r["indicative_opportunity_rm_month"]["low"] <= r["indicative_opportunity_rm_month"]["high"]
        # identical to the Order 4 calculation for the same area (no divergent re-implementation)
        kind = "sme_fibre" if r["classification"] == "capacity_constraint" else "sme_fwa"
        assert [r["indicative_opportunity_rm_month"]["low"], r["indicative_opportunity_rm_month"]["high"]] == \
            rank._potential(kind, rank.area_signals(og)[r["area_id"]])["indicative_monthly_recurring_rm"]
    assert result["predictive_service"]["available"] is False


def test_event_packages_reject_infeasible_options_and_price_transparently(og):
    result = commercial.event_packages(og)
    for p in result["packages"]:
        assert p["indicative_price_rm"] == round(p["cost_rm"] * (1 + commercial.EVENT["margin"]), -2)
        assert p["cost_rm"] == sum(i["rm"] for i in p["cost_items_rm"])
        if p["status"] == "feasible" and p["package_id"] != "vendor_connectivity":
            assert all(c["met"] for c in p["checks"])
        if p["status"] == "infeasible":
            assert p["name"] not in result["proposal"].split("We cannot offer:")[0]
    assert "not a quote" in result["proposal"] and "no service guarantee" in result["proposal"]
    offered = [p for p in result["packages"] if p["status"] in ("feasible", "conditional")]
    assert result["offer"]["indicative_total_rm"] == sum(p["indicative_price_rm"] for p in offered)
    assert result["offer"]["indicative_margin_total_rm"] == result["offer"]["indicative_total_rm"] - result["offer"]["cost_total_rm"]
    with pytest.raises(ValueError):
        commercial.event_packages(og, "EVT-DOES-NOT-EXIST")


def test_event_with_no_serving_sites_rejects_every_package(og, monkeypatch):
    monkeypatch.setitem(commercial.EVENT, "nearby_km", 0.0001)
    result = commercial.event_packages(og)
    assert {p["status"] for p in result["packages"]} == {"infeasible"}
    assert "We cannot offer" in result["proposal"] and "indicative RM" not in result["proposal"]


def test_predictive_enrichment_is_optional():
    class Fake:
        def __init__(self, *args, **kwargs): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *exc): return False
        async def list_tools(self): return [SimpleNamespace(name="mlpredict_call_tool")]
        async def call_tool(self, name, args):
            assert name == "mlpredict_call_tool" and args["name"] == "get_business_demand_signals"
            return SimpleNamespace(structured_content={"data": {"areas": [{"area_id": "AREA-X", "demand_index": 0.8, "signal": "steady", "extra": 1}]}})

    class Down(Fake):
        async def __aenter__(self): raise ConnectionError("down")

    up = asyncio.run(predictive.demand_signals(["AREA-X"], client_factory=Fake))
    assert up["AREA-X"] == {"demand_index": 0.8, "signal": "steady"} and up["_status"]["available"] is True
    down = asyncio.run(predictive.demand_signals(["AREA-X"], client_factory=Down))
    assert down == {"_status": {"available": False, "note": "Order 5 predictive service unavailable (ConnectionError); graph-derived evidence used."}}
