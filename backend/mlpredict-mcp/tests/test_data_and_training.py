"""The ML dataset is deterministic and coherent; training writes models, metrics and a manifest; splits are chronological."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import duckdb
from mlpredict_mcp import data
from mlpredict_mcp.calendar import HOLIDAYS_2026, is_holiday
from mlpredict_mcp.features import event_radius_km


def test_same_input_gives_the_same_dataset(built: dict[str, Path], tmp_path: Path) -> None:
    again = tmp_path / "ml.duckdb"
    data.build(built["intel"], again)
    a, b = duckdb.connect(str(built["ml"]), read_only=True), duckdb.connect(str(again), read_only=True)
    for table in ("footfall_hourly", "booth_outcome", "rain_daily", "holiday"):
        q = f"SELECT count(*), sum(hash(t)) FROM {table} t"
        assert a.execute(q).fetchone() == b.execute(q).fetchone(), table


def test_footfall_is_aggregate_hourly_and_ends_with_the_network_data(built: dict[str, Path]) -> None:
    ml = duckdb.connect(str(built["ml"]), read_only=True)
    intel = duckdb.connect(str(built["intel"]), read_only=True)
    areas = intel.execute("SELECT count(*) FROM area").fetchone()[0]
    assert ml.execute("SELECT count(*) FROM footfall_hourly").fetchone()[0] == areas * data.FOOTFALL_DAYS * 24
    assert ml.execute("SELECT max(ts_utc) FROM footfall_hourly").fetchone()[0] == intel.execute("SELECT max(ts_utc) FROM kpi_hourly").fetchone()[0]
    cols = {r[0] for r in ml.execute("DESCRIBE footfall_hourly").fetchall()}
    assert cols == {"area_id", "ts_utc", "visitors", "event_visitors"}  # counts only, no person-level fields


def test_events_add_visitors_and_weekends_are_busier(built: dict[str, Path]) -> None:
    ml = duckdb.connect(str(built["ml"]), read_only=True)
    assert ml.execute("SELECT count(*) FROM footfall_hourly WHERE event_visitors > 0").fetchone()[0] > 0
    weekend, weekday = ml.execute(
        "SELECT avg(visitors) FILTER (WHERE dayofweek(ts_utc + INTERVAL 8 HOUR) IN (0, 6)), "
        "avg(visitors) FILTER (WHERE dayofweek(ts_utc + INTERVAL 8 HOUR) BETWEEN 1 AND 5) FROM footfall_hourly"
    ).fetchone()
    assert weekend > weekday


def test_holiday_calendar_marks_lunar_dates_tentative() -> None:
    assert is_holiday(date(2026, 8, 31)) and is_holiday(date(2026, 9, 16)) and not is_holiday(date(2026, 9, 17))
    assert all(tentative for d, name, tentative in HOLIDAYS_2026 if "Raya" in name or "Wesak" in name)
    assert event_radius_km(40000) > event_radius_km(5000) >= 2.0


def test_training_writes_models_metrics_and_manifest(built: dict[str, Path]) -> None:
    models = built["models"]
    manifest = json.loads((models / "manifest.json").read_text())
    metrics = json.loads((models / "metrics.json").read_text())
    assert set(metrics) == {"footfall", "booth", "failure", "congestion", "anomaly"}
    for name, m in metrics.items():
        assert m["baseline"] and m["split"].startswith("chronological"), name
    assert manifest["data"]["synthetic"] is True and manifest["libraries"]["lightgbm"]
    for f in ("footfall_p10.txt", "footfall_p50.txt", "footfall_p90.txt", "booth.txt", "failure.txt", "congestion.txt", "anomaly.joblib"):
        assert (models / f).exists() and f in manifest["files"], f
    assert metrics["footfall"]["metrics"]["model_p50"]["mae"] > 0