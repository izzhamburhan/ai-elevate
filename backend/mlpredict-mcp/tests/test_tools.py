"""Every prediction tool on the fake network: the shared contract, sane numbers, honest limits and refusals."""

from __future__ import annotations

import asyncio
import json
import math
from typing import Any

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError
from mlpredict_mcp import tools
from mlpredict_mcp.server import build_server
from netintel_mcp.tools import InputError

PROPS = {"id", "kind", "severity", "score", "label", "unit"}


def contract(result: dict[str, Any]) -> dict[str, Any]:
    assert result["synthetic"] is True and result["as_of"].endswith("Z")
    data = result["data"]
    for key in ("summary", "geojson", "provenance", "data_freshness", "limitations"):
        assert key in data, key
    assert data["provenance"]["synthetic"] is True and "no LLM" in data["provenance"]["method"]
    for f in data["geojson"]["features"]:
        assert set(f["properties"]) >= PROPS
        coords = [f["geometry"]["coordinates"]] if f["geometry"]["type"] == "Point" else f["geometry"]["coordinates"]
        for lng, lat in coords:
            assert 99 < lng < 120 and 0 < lat < 8
    json.dumps(result)
    return data


def test_footfall_forecast_next_saturday() -> None:
    data = contract(tools.predict_area_footfall())
    assert data["window"]["kind"] == "forecast" and data["window"]["day_myt"].endswith(("-17",))
    for a in data["areas"]:
        v = a["expected_visitors"]
        assert 0 <= v["p10"] <= v["p50"] <= v["p90"]
    assert data["areas"] == sorted(data["areas"], key=lambda a: -a["expected_visitors"]["p50"])


def test_footfall_refuses_more_than_a_week_ahead() -> None:
    with pytest.raises(InputError, match="7 days"):
        tools.predict_area_footfall(day="2026-10-30")


def test_booth_ranking_has_bands_factors_and_risks() -> None:
    data = contract(tools.rank_business_locations(top_k=2))
    assert len(data["recommendations"]) == 2
    for r in data["recommendations"]:
        lo, hi = r["signups_band"]
        assert lo <= r["expected_signups"] <= hi and r["ranking_factors"] and r["risks"]
    assert "not revenue" in data["units"]


def test_failure_risk_scores_are_ranked_probabilities_with_reasons() -> None:
    data = contract(tools.predict_site_failure_risk(limit=5))
    scores = [s["risk_score"] for s in data["sites"]]
    assert scores == sorted(scores, reverse=True) and all(0 <= s <= 1 for s in scores)
    assert data["horizon"]["hours"] == 24
    assert all(s["risk_level"] in ("LOW", "MEDIUM", "HIGH") for s in data["sites"])


def test_congestion_forecast_for_the_upcoming_event() -> None:
    data = contract(tools.forecast_network_congestion(event_id="EVT-SA-FESTIVAL"))
    assert data["window"]["kind"] == "forecast"
    assert any(e["event_id"] == "EVT-SA-FESTIVAL" for e in data["events"])
    for c in data["cells"]:
        assert 0 <= c["forecast_peak_prb_pct"] <= 100 and c["interval_p10_p90_at_peak"][0] <= c["interval_p10_p90_at_peak"][1]


def test_congestion_forecast_refuses_far_future() -> None:
    with pytest.raises(InputError):
        tools.forecast_network_congestion(cluster="Shah Alam", start="2026-11-20T00:00", end="2026-11-21T00:00")


def test_anomalies_find_the_transport_incident() -> None:
    data = contract(tools.detect_network_anomalies(cluster="Putrajaya", start="2026-09-26T12:00", end="2026-09-26T20:00"))
    assert data["sites"], "the hub incident should look unusual"
    assert all(not math.isnan(s["max_score"]) for s in data["sites"])
    assert any("not a probability" in line for line in data["limitations"])


def test_anomalies_refuse_future_windows() -> None:
    with pytest.raises(InputError):
        tools.detect_network_anomalies(cluster="Shah Alam", start="2026-10-13T00:00", end="2026-10-14T00:00")


def test_metrics_and_status() -> None:
    metrics = contract(tools.get_ml_model_metrics("congestion"))
    assert set(metrics["models"]) == {"congestion"}
    status = tools.get_ml_model_status()["data"]
    assert status["ready"] is True and status["manifest"]["model_version"]


def test_status_without_models(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setenv("MLPREDICT_MODELS", str(tmp_path / "none"))
    status = tools.get_ml_model_status()["data"]
    assert status["ready"] is False and "Train them" in status["error"]


def test_server_lists_seven_read_only_tools_and_reports_errors() -> None:
    async def run() -> tuple[list[Any], Any]:
        async with Client(build_server()) as client:
            listed = await client.list_tools()
            try:
                await client.call_tool("predict_area_footfall", {"day": "2026-12-25"})
            except ToolError as exc:
                return listed, exc
            return listed, None

    listed, error = asyncio.run(run())
    assert {t.name for t in listed} == {"predict_area_footfall", "rank_business_locations", "predict_site_failure_risk", "forecast_network_congestion",
                                        "detect_network_anomalies", "get_ml_model_metrics", "get_ml_model_status"}
    assert all(t.annotations.read_only_hint for t in listed)
    assert error is not None and "7 days" in str(error)