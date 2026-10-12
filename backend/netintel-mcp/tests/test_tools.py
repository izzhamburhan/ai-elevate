"""The five analyses on the fake network: the scenario answers, the shared output contract and honest gaps."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import duckdb
import pytest
from netintel_mcp import tools, weather

PROPS = {"id", "kind", "severity", "score", "label", "unit"}


def assert_contract(result: dict[str, Any]) -> dict[str, Any]:
    assert result["synthetic"] is True and result["as_of"].endswith("Z") and result["evidence"]
    data = result["data"]
    for key in ("summary", "geojson", "provenance", "data_freshness", "limitations"):
        assert key in data, key
    assert data["provenance"]["synthetic"] is True and data["data_freshness"]["live"] is False
    fc = data["geojson"]
    assert fc["type"] == "FeatureCollection"
    for f in fc["features"]:
        assert f["type"] == "Feature" and set(f["properties"]) >= PROPS
        assert f["properties"]["severity"] in (None, "LOW", "MEDIUM", "HIGH", "CRITICAL")
        coords = [f["geometry"]["coordinates"]] if f["geometry"]["type"] == "Point" else f["geometry"]["coordinates"]
        for lng, lat in coords:
            assert -180 <= lng <= 180 and -90 <= lat <= 90
            assert 0 < lat < 8 and 99 < lng < 120  # Malaysia: [lng, lat] order
    json.dumps(result)  # serialisable as the MCP result
    return data


def _scenario(intel_db: Path, sid: str) -> dict[str, Any]:
    con = duckdb.connect(str(intel_db), read_only=True)
    return json.loads(con.execute("SELECT detail FROM scenario WHERE scenario_id = ?", [sid]).fetchone()[0])


def test_complaint_finds_evening_congestion(intel_db: Path) -> None:
    data = assert_contract(tools.investigate_customer_complaint("CMP-SA-0001", hour_from=19, hour_to=22))
    scenario = _scenario(intel_db, "SCN-EVENING-CONGESTION")
    assert data["serving_cell"]["cell_name"] == scenario["cells"][0]
    assert data["causes"][0]["cause"] == "congestion" and data["causes"][0]["likelihood"] == "high"
    assert data["kpi_comparison"]["reported_hours"]["prb_dl_pct"] > data["kpi_comparison"]["other_hours"]["prb_dl_pct"]
    assert data["signal_quality"]["rating"] == "good"
    assert data["recommendations"][0]["owner"] == "RAN planning"


def test_complaint_by_location_without_hours_warns(intel_db: Path) -> None:
    result = tools.investigate_customer_complaint(lat=3.23, lng=101.64)
    assert_contract(result)
    assert any("reported hours" in w for w in result["warnings"])


def test_unknown_complaint_is_an_input_error() -> None:
    with pytest.raises(tools.InputError):
        tools.investigate_customer_complaint("CMP-NOPE")


def test_congestion_ranks_the_evening_cell(intel_db: Path) -> None:
    data = assert_contract(tools.analyze_network_congestion(cluster="Shah Alam", days=7))
    evening = _scenario(intel_db, "SCN-EVENING-CONGESTION")["cells"][0]
    cell = next(c for c in data["cells"] if c["cell_name"] == evening)
    assert cell["severity"] in ("CRITICAL", "HIGH") and 19 <= cell["busy_hour_myt"] <= 23
    assert data["severity_counts"][cell["severity"]] >= 1


def test_congestion_needs_an_area() -> None:
    with pytest.raises(tools.InputError):
        tools.analyze_network_congestion()
    with pytest.raises(tools.InputError):
        tools.analyze_network_congestion(cluster="Atlantis")


def test_correlation_finds_the_shared_hub(intel_db: Path) -> None:
    scenario = _scenario(intel_db, "SCN-TRANSPORT-HUB")
    result = tools.correlate_network_incidents(site_ids=scenario["sites"])
    data = assert_contract(result)
    assert sorted(data["affected_sites"]) == sorted(scenario["sites"])
    top = data["hypotheses"][0]
    assert top["strength"] == "strong" and scenario["hub"] in top["hypothesis"]
    assert any("RFC-INTEL-0001" in s for s in top["supporting"])
    assert data["time_window"]["start"]["myt"].startswith("2026-09-26T14:00")
    # Weather ML is not running in tests: said so, no weather values
    assert data["weather"]["used"] is False and any("Weather ML" in w for w in result["warnings"])
    assert any("not causation" in line for line in data["limitations"])


def test_exposure_without_weather_ml_reports_vulnerability_only() -> None:
    data = assert_contract(tools.assess_weather_network_exposure(cluster="Putrajaya"))
    assert data["weather_mode"] == "unavailable"
    assert all(s["weather"] is None and s["exposure_indicator"] is None for s in data["sites"])
    microwave = next(s for s in data["sites"] if s["backhaul"] == "Microwave")
    assert "microwave backhaul (rain fade)" in microwave["vulnerability"]["factors"]


def test_exposure_combines_weather_ml_with_vulnerability(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake(site_ids: list[str], horizon_hours: int) -> dict[str, Any]:
        summary = {"exposure": "high", "peak_rainfall_mm": 12.0, "rainfall_mm": 30.0, "temperature_c": 26.0, "forecast_start": "2026-09-26T00:00:00Z",
                   "forecast_end": "2026-09-26T23:00:00Z", "mode": "replay", "model_id": "autogluon/chronos-2-small", "weather_location_id": "kuala-lumpur",
                   "units": "mm"}
        return {"available": True, "mode": "replay", "sites": {s: summary for s in site_ids}, "warnings": [], "disclaimer": "test", "service": "fake"}

    monkeypatch.setattr(weather, "predict_sites", fake)
    data = assert_contract(tools.assess_weather_network_exposure(cluster="Putrajaya"))
    by_backhaul = {s["backhaul"]: s["exposure_indicator"] for s in data["sites"]}
    assert by_backhaul["Microwave"] == "HIGH"
    assert data["weather_mode"] == "replay"


def test_maintenance_recommends_radio_and_backhaul_checks(intel_db: Path) -> None:
    data = assert_contract(tools.recommend_network_maintenance(limit=20))
    categories = {r["category"] for r in data["recommendations"]}
    assert {"recurring_radio_alarm", "recurring_backhaul", "repeated_outage"} <= categories
    assert all(r["draft_ticket"]["requires_human_approval"] and r["draft_ticket"]["status"].startswith("DRAFT") for r in data["recommendations"])
    vswr = set(_scenario(intel_db, "SCN-RECURRING-VSWR")["sites"])
    assert vswr <= {r["site_id"] for r in data["recommendations"] if r["category"] == "recurring_radio_alarm"}


def test_tools_never_write(intel_db: Path) -> None:
    before = intel_db.stat().st_mtime_ns
    tools.recommend_network_maintenance()
    tools.analyze_network_congestion(cluster="Kepong")
    assert intel_db.stat().st_mtime_ns == before