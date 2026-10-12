"""Order 5: the shared prediction contract, business demand signals, weather context and the live demo chain."""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

import duckdb
import pytest
from mlpredict_mcp import demo, tools
from mlpredict_mcp.server import build_server
from netintel_mcp.server import build_server as build_netintel
from netintel_mcp.tools import InputError

PREDICTION_KEYS = {"schema", "subject", "prediction", "window", "value", "unit", "score", "level", "evidence", "confidence",
                   "confidence_basis", "synthetic"}
SIGNAL_KEYS = {"schema", "area_id", "name", "cluster", "lat", "lng", "window", "signal", "secondary_flags", "recommended_investigation",
               "investigation_priority", "demand_index", "capacity_pressure", "reliability_risk", "indicators", "site_ids", "worst_site_id",
               "events", "evidence", "confidence", "confidence_basis", "synthetic"}


def contract(result: dict[str, Any]) -> dict[str, Any]:
    """The envelope checks of test_tools.contract (test modules are not importable with --import-mode=importlib)."""
    assert result["synthetic"] is True and result["as_of"].endswith("Z")
    data = result["data"]
    for key in ("summary", "geojson", "provenance", "data_freshness", "limitations"):
        assert key in data, key
    assert data["provenance"]["synthetic"] is True and "no LLM" in data["provenance"]["method"]
    for f in data["geojson"]["features"]:
        assert set(f["properties"]) >= {"id", "kind", "severity", "score", "label", "unit"}
    json.dumps(result)
    return data


def predictions(data: dict[str, Any]) -> list[dict[str, Any]]:
    rows = data["predictions"]
    assert rows, "every predictive tool returns at least one prediction"
    for p in rows:
        assert set(p) == PREDICTION_KEYS and p["schema"] == tools.PREDICTION_SCHEMA and p["synthetic"] is True
        assert p["subject"]["type"] in ("site", "cell", "area") and p["subject"]["id"]
        assert p["window"]["start"]["utc"] and p["window"]["end"]["myt"]
        assert p["evidence"] and all(isinstance(e, str) for e in p["evidence"])
        assert p["confidence"] in ("low", "medium", "high") and p["confidence_basis"]
    return rows


@pytest.mark.parametrize("call", [
    lambda: tools.predict_area_footfall(),
    lambda: tools.rank_business_locations(top_k=2),
    lambda: tools.predict_site_failure_risk(limit=5),
    lambda: tools.forecast_network_congestion(event_id="EVT-SA-FESTIVAL"),
    lambda: tools.detect_network_anomalies(cluster="Putrajaya", start="2026-09-26T12:00", end="2026-09-26T20:00"),
    lambda: tools.get_business_demand_signals(day="2026-10-17"),
], ids=["footfall", "booth", "failure", "congestion", "anomaly", "demand"])
def test_every_predictive_tool_returns_the_shared_contract(call) -> None:
    predictions(contract(call()))


def test_failure_risk_carries_weather_context_not_as_a_model_input() -> None:
    data = contract(tools.predict_site_failure_risk(limit=5))
    exposures = [s["weather_exposure"] for s in data["sites"] if s["weather_exposure"]]
    assert exposures and all(w["exposure"] in ("low", "elevated") and "synthetic" in w["source"] for w in exposures)
    assert any("not a model input" in line for line in data["limitations"])


def test_demand_signals_schema_scores_and_order() -> None:
    data = contract(tools.get_business_demand_signals(day="2026-10-17", hour_from=16, hour_to=22, limit=50))
    assert data["schema"] == tools.DEMAND_SCHEMA and data["window"]["kind"] == "forecast"
    signals = data["signals"]
    assert len(signals) == data["areas_scored"]
    for s in signals:
        assert set(s) == SIGNAL_KEYS and s["synthetic"] is True and s["signal"] in tools.SIGNALS
        for k in ("investigation_priority", "demand_index", "capacity_pressure", "reliability_risk"):
            assert 0 <= s[k] <= 1, k
        assert s["site_ids"] and s["evidence"] and s["recommended_investigation"] == tools.SIGNALS[s["signal"]]
        i = s["indicators"]
        assert i["footfall_p10"] <= i["footfall_p50"] <= i["footfall_p90"] and 0 <= i["forecast_peak_prb_pct"] <= 100
    key = [(s["signal"] == "steady", -s["investigation_priority"]) for s in signals]
    assert key == sorted(key), "actionable signals first, then by priority"
    assert sum(data["signal_counts"].values()) == len(signals)


def test_demand_signals_cover_exactly_the_opportunity_graph_areas() -> None:
    """The Opportunity Graph's area nodes are intel.duckdb's `area` rows; signals must join on the same area_id set."""
    with duckdb.connect(os.environ["NETINTEL_DB"], read_only=True) as intel:
        areas = {r[0] for r in intel.execute("SELECT area_id FROM area").fetchall()}
    signals = tools.get_business_demand_signals(day="2026-10-17", limit=50)["data"]["signals"]
    assert {s["area_id"] for s in signals} == areas


def test_demand_signals_for_the_festival_area() -> None:
    signals = tools.get_business_demand_signals(day="2026-10-17", hour_from=16, hour_to=22, limit=50)["data"]["signals"]
    shah_alam = next(s for s in signals if s["cluster"] == "Shah Alam")
    assert "EVT-SA-FESTIVAL" in shah_alam["events"] and shah_alam["indicators"]["event_attendance_in_reach"] >= 38000


def test_demand_signals_scores_do_not_depend_on_the_filter() -> None:
    everything = {s["area_id"]: s for s in tools.get_business_demand_signals(day="2026-10-17", limit=50)["data"]["signals"]}
    one = tools.get_business_demand_signals(day="2026-10-17", cluster="Shah Alam")["data"]["signals"]
    assert len(one) == 1 and one[0] == everything[one[0]["area_id"]]


def test_demand_signals_are_deterministic() -> None:
    a = tools.get_business_demand_signals(day="2026-10-17")["data"]
    b = tools.get_business_demand_signals(day="2026-10-17")["data"]
    assert a["signals"] == b["signals"] and a["summary"] == b["summary"]


def test_demand_signals_refuse_past_and_far_windows() -> None:
    with pytest.raises(InputError, match="look ahead"):
        tools.get_business_demand_signals(day="2026-10-03")
    with pytest.raises(InputError, match="7 days"):
        tools.get_business_demand_signals(day="2026-10-30")


def test_demo_chain_runs_through_both_mcp_servers(capsys: pytest.CaptureFixture[str]) -> None:
    transcript = asyncio.run(demo.run(build_netintel(search=True), build_server(search=True), "2026-10-17"))
    calls = [(c["server"], c["tool"]) for c in transcript["calls"]]
    assert ("netintel", "analyze_network_congestion") in calls and ("mlpredict", "get_business_demand_signals") in calls
    assert all(c["result"]["synthetic"] is True for c in transcript["calls"])
    out = capsys.readouterr().out
    for step in ("ANALYZE NETWORK", "PREDICT FUTURE RISK", "IDENTIFY DEMAND", "RECOMMEND AREAS"):
        assert step in out
