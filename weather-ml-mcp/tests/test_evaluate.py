"""Deterministic SYNTHETIC fixtures: these numbers are not observed weather."""
import json

import numpy as np
import pandas as pd
import pytest

from weather_ml_mcp.evaluate import (
    EvaluationConfig, baseline_predictions, canonical_hourly, error_metrics,
    evaluate_frames, markdown_report, select_origins, validate_predictions,
)


def synthetic_frame(hours=720):
    index = np.arange(hours)
    return pd.DataFrame({
        "timestamp": pd.date_range("2026-01-01", periods=hours, freq="h", tz="UTC"),
        "precipitation": np.where(index % 24 < 3, 0.5, 0.0),
        "temperature_2m": 27 + 3 * np.sin(2 * np.pi * index / 24),
    })


class SyntheticPersistence:
    def __init__(self):
        self.calls = []

    def predict(self, frame, target, horizon):
        self.calls.append((frame.copy(), target, horizon))
        value = float(frame[target].iloc[-1])
        lower = max(0, value - 1) if target == "precipitation" else value - 1
        return pd.DataFrame({
            "timestamp": pd.date_range(frame.timestamp.iloc[-1] + pd.Timedelta(hours=1), periods=horizon, freq="h"),
            "0.1": lower, "0.5": value, "0.9": value + 1,
        })


def test_chronological_origins_have_nonoverlapping_targets():
    config = EvaluationConfig(context_hours=48, origins_per_split=4)
    origins = select_origins(720, config)
    assert all(right - left >= 24 for split in origins.values() for left, right in zip(split, split[1:]))
    assert origins["validation"][0] + 1 >= int(720 * 0.6)
    assert origins["validation"][-1] + 24 < int(720 * 0.8)
    assert origins["test"][0] + 1 >= int(720 * 0.8)
    assert origins["test"][-1] + 24 < 720


def test_baselines_persistence_and_previous_day():
    context = np.arange(48)
    assert baseline_predictions(context, 6, "persistence").tolist() == [47] * 6
    assert baseline_predictions(context, 6, "seasonal_naive_24").tolist() == list(range(24, 30))


def test_no_future_model_inputs_and_valid_horizon_alignment():
    forecaster = SyntheticPersistence()
    report = evaluate_frames({"synthetic_test": synthetic_frame()}, {"synthetic_test": {"synthetic": True}},
                             forecaster, EvaluationConfig(context_hours=48, origins_per_split=2))
    assert report["status"] == "PASS"
    assert len(forecaster.calls) == 24  # 2 targets x 2 origins x 2 splits x 3 direct horizons
    for frame, target, horizon in forecaster.calls:
        assert horizon in (6, 12, 24) and len(frame) == 48
        assert frame.timestamp.max() == frame.timestamp.iloc[-1]
        matches = [row for row in report["windows"] if row["method"] == "chronos" and row["target"] == target
                   and row["origin"] == frame.timestamp.iloc[-1].isoformat()]
        assert {row["horizon_hours"] for row in matches} == {6, 12, 24}
        assert all(pd.Timestamp(row["valid_times"][0]) > frame.timestamp.max() for row in matches)
    json.dumps(report, allow_nan=False)
    assert "retrospective" in markdown_report(report).lower()


def test_baseline_uncertainty_is_calibrated_on_validation_not_test():
    config = EvaluationConfig(context_hours=48, origins_per_split=2)
    frame = synthetic_frame()
    first = evaluate_frames({"fixture": frame}, {}, SyntheticPersistence(), config)
    modified = frame.copy()
    modified.loc[576:, "temperature_2m"] += 100
    second = evaluate_frames({"fixture": modified}, {}, SyntheticPersistence(), config)
    def interval_offsets(report):
        return [(np.asarray(row["lower"]) - row["median"], np.asarray(row["upper"]) - row["median"])
                for row in report["windows"] if row["split"] == "test" and row["target"] == "temperature_2m"
                and row["method"] == "persistence"]
    for (low1, up1), (low2, up2) in zip(interval_offsets(first), interval_offsets(second)):
        np.testing.assert_allclose(low1, low2, atol=1e-12)
        np.testing.assert_allclose(up1, up2, atol=1e-12)


def test_missing_context_skips_without_imputation_or_invented_predictions():
    config = EvaluationConfig(context_hours=48, origins_per_split=2)
    frame = synthetic_frame()
    origin = select_origins(len(frame), config)["test"][0]
    frame.loc[origin, "precipitation"] = np.nan
    forecaster = SyntheticPersistence()
    report = evaluate_frames({"fixture": frame}, {}, forecaster, config)
    assert any(row["split"] == "test" and row["target"] == "precipitation" for row in report["skipped_windows"])
    assert not any(context.precipitation.isna().any() for context, target, _ in forecaster.calls if target == "precipitation")


def test_missing_timestamp_becomes_explicit_nan():
    frame = synthetic_frame(72).drop(index=30)
    result = canonical_hourly(frame)
    assert len(result) == 72
    assert result.loc[30, "precipitation"] != result.loc[30, "precipitation"]


@pytest.mark.parametrize("problem", ["duplicate", "naive", "nonhour", "negative_rain"])
def test_invalid_inputs_rejected(problem):
    frame = synthetic_frame(72)
    if problem == "duplicate":
        frame.loc[1, "timestamp"] = frame.loc[0, "timestamp"]
    elif problem == "naive":
        frame["timestamp"] = frame.timestamp.dt.tz_localize(None)
    elif problem == "nonhour":
        frame["timestamp"] += pd.Timedelta(minutes=1)
    else:
        frame.loc[1, "precipitation"] = -1
    with pytest.raises(ValueError):
        canonical_hourly(frame)


def test_schema_bad_quantiles_and_misaligned_time_rejected():
    frame = synthetic_frame(48)
    prediction = SyntheticPersistence().predict(frame, "precipitation", 24)
    expected = pd.Series(prediction.timestamp)
    validate_predictions(prediction, expected, "precipitation")
    prediction.loc[0, "0.1"] = 99
    with pytest.raises(ValueError, match="ordered"):
        validate_predictions(prediction, expected, "precipitation")
    prediction = SyntheticPersistence().predict(frame, "precipitation", 24)
    prediction["timestamp"] += pd.Timedelta(hours=1)
    with pytest.raises(ValueError, match="align"):
        validate_predictions(prediction, expected, "precipitation")


def test_unavailable_model_is_reported_as_failure_with_no_fabricated_chronos_metrics():
    class Broken:
        def predict(self, frame, target, horizon):
            raise RuntimeError("Cached model unavailable")
    report = evaluate_frames({"fixture": synthetic_frame()}, {}, Broken(), EvaluationConfig(context_hours=48, origins_per_split=1))
    assert report["status"] == "FAIL"
    assert len(report["model_errors"]) == 12
    assert report["runtime"]["successful_calls"] == 0
    assert not any(row["method"] == "chronos" for row in report["metrics"])
    assert report["baseline_comparisons"] == []
    json.dumps(report, allow_nan=False)


def test_metrics_include_wet_hours_total_error_and_empirical_coverage():
    rows = [{"target": "precipitation", "actual": [0, 2], "median": [0, 1], "lower": [0, 0], "upper": [1, 1]}]
    scores = error_metrics(rows, 0.1)
    assert scores["mae"] == 0.5
    assert scores["rmse"] == pytest.approx(np.sqrt(0.5))
    assert scores["interval_coverage_80"] == 0.5
    assert scores["wet_hour_mae"] == 1
    assert scores["total_rainfall_mae_mm_per_window"] == 1
    assert scores["total_rainfall_bias_mm_per_window"] == -1


def test_insufficient_history_fails_explicitly():
    with pytest.raises(ValueError, match="Insufficient"):
        select_origins(48, EvaluationConfig(context_hours=48))
