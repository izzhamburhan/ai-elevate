"""Chronological offline replay evaluation; no acquisition or fitting occurs here.

Development data establish context, validation calibrates *baseline* intervals, and
test data score a fixed pretrained model. All model inputs end at their origin.
Synthetic unit fixtures are never reported as observed weather by the CLI.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import resource
import sys
import time
from typing import Protocol

import numpy as np
import pandas as pd

TARGETS = ("precipitation", "temperature_2m")
HORIZONS = (6, 12, 24)
METHODS = ("chronos", "persistence", "seasonal_naive_24")


class Forecaster(Protocol):
    def predict(self, frame: pd.DataFrame, target: str, horizon: int) -> pd.DataFrame: ...


@dataclass(frozen=True)
class EvaluationConfig:
    context_hours: int = 336
    origins_per_split: int = 4
    development_fraction: float = 0.6
    validation_fraction: float = 0.2
    wet_threshold_mm: float = 0.1

    def __post_init__(self):
        if self.context_hours < 24 or self.origins_per_split < 1:
            raise ValueError("Context >=24 and at least one origin per split required")
        if not 0 < self.development_fraction < 1 or not 0 < self.validation_fraction < 1:
            raise ValueError("Split fractions must be between zero and one")
        if self.development_fraction + self.validation_fraction >= 1:
            raise ValueError("Must reserve a chronological test segment")
        if self.wet_threshold_mm <= 0:
            raise ValueError("Wet-hour threshold must be positive")


def peak_rss_bytes() -> int:
    """Process high-water RSS (bytes on macOS, KiB on Linux)."""
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(value if sys.platform == "darwin" else value * 1024)


def canonical_hourly(frame: pd.DataFrame) -> pd.DataFrame:
    """Keep gaps explicit, reject duplicates/naive time, never fill missing data."""
    if "timestamp" not in frame or not set(TARGETS).issubset(frame.columns):
        raise ValueError("Data must contain UTC timestamps and both weather targets")
    result = frame.copy()
    timestamps = pd.to_datetime(result["timestamp"])
    if timestamps.dt.tz is None:
        raise ValueError("Naive timestamps are not accepted")
    timestamps = timestamps.dt.tz_convert("UTC")
    if timestamps.duplicated().any() or timestamps.isna().any():
        raise ValueError("Duplicate or missing timestamps")
    if not timestamps.eq(timestamps.dt.floor("h")).all():
        raise ValueError("Timestamps must be aligned to UTC hours")
    result["timestamp"] = timestamps
    result = result.sort_values("timestamp").set_index("timestamp")
    if result.empty:
        raise ValueError("Empty dataset")
    complete_index = pd.date_range(result.index.min(), result.index.max(), freq="h")
    result = result.reindex(complete_index)
    result.index.name = "timestamp"
    for target in TARGETS:
        result[target] = pd.to_numeric(result[target], errors="raise")
        present = result[target].dropna()
        if not np.isfinite(present).all():
            raise ValueError("Infinite weather target")
    if (result["precipitation"].dropna() < 0).any():
        raise ValueError("Precipitation must be nonnegative millimeters")
    return result.reset_index()


def select_origins(length: int, config: EvaluationConfig) -> dict[str, list[int]]:
    """Origins precede target segments; 24-hour windows never overlap within a split."""
    development_end = int(length * config.development_fraction)
    validation_end = int(length * (config.development_fraction + config.validation_fraction))
    bounds = {"validation": (development_end, validation_end), "test": (validation_end, length)}
    selections = {}
    for name, (start, end) in bounds.items():
        first = max(start - 1, config.context_hours - 1)
        candidates = list(range(first, end - 24, 24))
        if not candidates:
            raise ValueError(f"Insufficient chronological data for {name} with {config.context_hours}h context")
        count = min(len(candidates), config.origins_per_split)
        indices = np.linspace(0, len(candidates) - 1, count, dtype=int)
        selections[name] = [candidates[int(index)] for index in indices]
    return selections


def baseline_predictions(context: np.ndarray, horizon: int, method: str) -> np.ndarray:
    if method == "persistence":
        return np.repeat(context[-1], horizon).astype(float)
    if method == "seasonal_naive_24":
        if len(context) < 24:
            raise ValueError("Seasonal naive requires a full previous day")
        return np.resize(context[-24:], horizon).astype(float)
    raise ValueError(f"Unknown baseline: {method}")


def validate_predictions(prediction: pd.DataFrame, expected: pd.Series, target: str) -> np.ndarray:
    required = ["timestamp", "0.1", "0.5", "0.9"]
    if not set(required).issubset(prediction.columns) or len(prediction) != len(expected):
        raise ValueError("Model output lacks the required forecast rows/quantiles")
    times = pd.to_datetime(prediction["timestamp"])
    if times.dt.tz is None or not np.array_equal(times.dt.tz_convert("UTC").to_numpy(), expected.to_numpy()):
        raise ValueError("Model forecast timestamps do not align with held-out targets")
    values = prediction[["0.1", "0.5", "0.9"]].to_numpy(dtype=float)
    if not np.isfinite(values).all() or (np.diff(values, axis=1) < 0).any():
        raise ValueError("Model quantiles must be finite and ordered")
    if target == "precipitation" and (values < 0).any():
        raise ValueError("Deployed rainfall quantiles must be clipped to zero before evaluation")
    return values


def error_metrics(rows: list[dict], wet_threshold_mm: float) -> dict:
    """Pool hourly errors; rainfall sum errors remain per-origin quantities."""
    actual = np.concatenate([np.asarray(row["actual"], dtype=float) for row in rows])
    predicted = np.concatenate([np.asarray(row["median"], dtype=float) for row in rows])
    error = predicted - actual
    has_intervals = all(row["lower"] is not None for row in rows)
    output = {
        "windows": len(rows), "hours": len(actual),
        "mae": float(np.mean(np.abs(error))),
        "rmse": float(np.sqrt(np.mean(error ** 2))), "bias": float(np.mean(error)),
        "units": "mm/hour" if rows[0]["target"] == "precipitation" else "°C",
        "interval_coverage_80": None, "mean_interval_width": None,
    }
    if has_intervals:
        lower = np.concatenate([np.asarray(row["lower"], dtype=float) for row in rows])
        upper = np.concatenate([np.asarray(row["upper"], dtype=float) for row in rows])
        output["interval_coverage_80"] = float(np.mean((actual >= lower) & (actual <= upper)))
        output["mean_interval_width"] = float(np.mean(upper - lower))
    if rows[0]["target"] == "precipitation":
        wet = actual >= wet_threshold_mm
        sum_errors = np.asarray([np.sum(row["median"]) - np.sum(row["actual"]) for row in rows])
        output.update({
            "wet_threshold_mm_per_hour": wet_threshold_mm, "wet_hours": int(wet.sum()),
            "wet_hour_mae": float(np.mean(np.abs(error[wet]))) if wet.any() else None,
            "total_rainfall_mae_mm_per_window": float(np.mean(np.abs(sum_errors))),
            "total_rainfall_bias_mm_per_window": float(np.mean(sum_errors)),
            "reference_rainfall_mm_all_windows": float(np.sum(actual)),
            "predicted_median_rainfall_mm_all_windows": float(np.sum(predicted)),
        })
    return output


def evaluate_frames(frames: dict[str, pd.DataFrame], manifests: dict[str, dict],
                    forecaster: Forecaster, config: EvaluationConfig | None = None) -> dict:
    config = config or EvaluationConfig()
    rows, skipped, errors, locations, latencies = [], [], [], [], []
    # Direct calls at every horizon verify the same prediction_length as service tools.
    for location_id, raw in sorted(frames.items()):
        frame = canonical_hourly(raw)
        origins = select_origins(len(frame), config)
        end_dev = int(len(frame) * config.development_fraction)
        end_val = int(len(frame) * (config.development_fraction + config.validation_fraction))
        locations.append({
            "location_id": location_id, "manifest": manifests.get(location_id, {}),
            "first_timestamp": frame["timestamp"].iloc[0].isoformat(),
            "last_timestamp": frame["timestamp"].iloc[-1].isoformat(),
            "development_end": frame["timestamp"].iloc[end_dev - 1].isoformat(),
            "validation_end": frame["timestamp"].iloc[end_val - 1].isoformat(),
            "origins": {split: [frame["timestamp"].iloc[index].isoformat() for index in indices]
                        for split, indices in origins.items()},
        })
        # Baseline uncertainty uses validation residuals ONLY; never test errors.
        residuals: dict[tuple[str, str, int], list[np.ndarray]] = {}
        for split in ("validation", "test"):
            for index in origins[split]:
                context = frame.iloc[index - config.context_hours + 1:index + 1].copy()
                future = frame.iloc[index + 1:index + 25].copy()
                origin = context["timestamp"].iloc[-1].isoformat()
                for target in TARGETS:
                    details = {"location_id": location_id, "target": target, "split": split, "origin": origin}
                    if context[target].isna().any() or future[target].isna().any():
                        skipped.append({**details, "reason": "missing context or held-out target; no imputation"})
                        continue
                    values = context[target].to_numpy(dtype=float)
                    actual = future[target].to_numpy(dtype=float)
                    for horizon in HORIZONS:
                        duration = time.perf_counter()
                        try:
                            forecast = validate_predictions(forecaster.predict(context, target, horizon),
                                                            future["timestamp"].iloc[:horizon], target)
                        except Exception as exc:
                            errors.append({**details, "horizon_hours": horizon, "reason": f"{type(exc).__name__}: {exc}"})
                            forecast = None
                        elapsed = time.perf_counter() - duration
                        latencies.append({**details, "horizon_hours": horizon, "seconds": elapsed,
                                          "succeeded": forecast is not None, "peak_process_rss_bytes": peak_rss_bytes()})
                        record = {**details, "horizon_hours": horizon,
                                  "input_start": context["timestamp"].iloc[0].isoformat(),
                                  "input_end": origin,
                                  "valid_times": [stamp.isoformat() for stamp in future["timestamp"].iloc[:horizon]],
                                  "actual": actual[:horizon].tolist()}
                        if forecast is not None:
                            rows.append({**record, "method": "chronos", "lower": forecast[:, 0].tolist(),
                                         "median": forecast[:, 1].tolist(), "upper": forecast[:, 2].tolist()})
                        for method in METHODS[1:]:
                            median = baseline_predictions(values, horizon, method)
                            key = (target, method, horizon)
                            lower, upper = None, None
                            if split == "validation":
                                residuals.setdefault(key, []).append(actual[:horizon] - median)
                            elif key in residuals:
                                bounds = np.quantile(np.concatenate(residuals[key]), [0.1, 0.9])
                                lower, upper = median + bounds[0], median + bounds[1]
                                if target == "precipitation":
                                    lower, upper = np.maximum(lower, 0), np.maximum(upper, 0)
                            rows.append({**record, "method": method, "median": median.tolist(),
                                         "lower": lower.tolist() if lower is not None else None,
                                         "upper": upper.tolist() if upper is not None else None})
    summary = []
    for split in ("validation", "test"):
        for target in TARGETS:
            for horizon in HORIZONS:
                for method in METHODS:
                    for location_id in ["ALL", *sorted(frames)]:
                        group = [row for row in rows if row["split"] == split and row["target"] == target
                                 and row["horizon_hours"] == horizon and row["method"] == method
                                 and (location_id == "ALL" or row["location_id"] == location_id)]
                        if group:
                            summary.append({"split": split, "target": target, "horizon_hours": horizon,
                                            "method": method, "location_id": location_id,
                                            **error_metrics(group, config.wet_threshold_mm)})
    comparisons = []
    for target in TARGETS:
        for horizon in HORIZONS:
            group = {row["method"]: row for row in summary if row["split"] == "test" and
                     row["target"] == target and row["horizon_hours"] == horizon and row["location_id"] == "ALL"}
            if "chronos" in group:
                for baseline in METHODS[1:]:
                    if baseline in group and group[baseline]["hours"] == group["chronos"]["hours"]:
                        comparisons.append({"target": target, "horizon_hours": horizon, "baseline": baseline,
                                            "chronos_mae": group["chronos"]["mae"], "baseline_mae": group[baseline]["mae"],
                                            "chronos_better_mae": group["chronos"]["mae"] < group[baseline]["mae"]})
    valid_latencies = [entry["seconds"] for entry in latencies if entry["succeeded"]]
    latency_by_horizon = []
    for horizon in HORIZONS:
        measurements = [entry["seconds"] for entry in latencies if entry["succeeded"] and entry["horizon_hours"] == horizon]
        latency_by_horizon.append({"horizon_hours": horizon, "successful_calls": len(measurements),
                                   "mean_seconds": float(np.mean(measurements)) if measurements else None,
                                   "p95_seconds": float(np.quantile(measurements, 0.95)) if measurements else None})
    return {
        "schema_version": 1, "generated_at": datetime.now(timezone.utc).isoformat(),
        "status": "PASS" if rows and not errors and any(row["method"] == "chronos" and row["split"] == "test" for row in rows) else "FAIL",
        "mode": "historical_replay", "configuration": asdict(config),
        "methodology": {
            "split": f"Chronological development{config.development_fraction:.0%}/validation{config.validation_fraction:.0%}/test{1-config.development_fraction-config.validation_fraction:.0%} by UTC-hour count; no fitting or fine-tuning",
            "origins": "Deterministically evenly spaced from a 24-hour origin grid within each split; sampled subset, no selection by errors",
            "forecast": "Direct model calls with prediction_length 6, 12, and 24 for each target/origin. Held-out windows are nested across horizons, so horizon results are dependent",
            "context": "Only observations timestamp <= origin; no future covariates; gaps remain explicit and incomplete windows are skipped",
            "intervals": "Chronos raw q0.1/q0.9, nominal80%, uncalibrated. Baseline test bounds from validation-only pooled hourly residual q0.1/q0.9",
            "point_forecast": "q0.5 median (same point estimate used by deployed service)",
            "rainfall": "Precipitation mm per previous hourly interval, used as rainfall proxy in Malaysia; sum-of-medians is not a total quantile",
            "reference": "Open-Meteo historical reanalysis, not independent station ground truth or as-of operational observations",
            "leakage": "Application input chronology enforced. Pretraining corpus overlap and training cutoff unknown; absence of pretrained-model leakage cannot be guaranteed",
        },
        "locations": locations, "metrics": summary, "baseline_comparisons": comparisons,
        "skipped_windows": skipped, "model_errors": errors,
        "runtime": {"inference_calls": len(latencies), "successful_calls": len(valid_latencies),
                    "latency_mean_seconds": float(np.mean(valid_latencies)) if valid_latencies else None,
                    "latency_p95_seconds": float(np.quantile(valid_latencies, 0.95)) if valid_latencies else None,
                    "peak_process_rss_bytes": peak_rss_bytes(),
                    "latency_by_horizon": latency_by_horizon,
                    "memory_note": "Whole evaluation process high-water RSS including imports/model/data, not model-only allocation or container memory",
                    "calls": latencies},
        "windows": rows,
        "limitations": [
            "Small retrospective sample; no claim of operational forecast skill or official meteorological forecast",
            "Reanalysis was acquired after evaluation dates and may include revisions/assimilation unavailable at forecast origin",
            "Sparse rainfall and a short sample make interval coverage and wet-hour scores unstable",
            "Raw quantiles are not calibrated rainfall-event probabilities; exposure rules do not predict telecom outages",
            "If a baseline wins, retain the integration and enlarge blind evaluation before choosing a deployment forecast method",
        ],
    }


def markdown_report(report: dict) -> str:
    lines = ["# Weather ML evaluation", "", f"Evaluation execution: **{report['status']}**.", "",
             "This is retrospective historical replay of public reanalysis. It is not an official forecast or a validation against independent station measurements.", "",
             "## Protocol", ""]
    for name, description in report["methodology"].items():
        lines.append(f"- **{name}:** {description}")
    lines += ["", "## Test metrics (all locations pooled)", "",
              "| Target | Horizon | Method | Hours | MAE | RMSE | 80% interval coverage | Mean interval width |",
              "|---|---:|---|---:|---:|---:|---:|---:|"]
    def fmt(value):
        return "NOT VERIFIED" if value is None else f"{value:.4f}"
    for row in report["metrics"]:
        if row["split"] == "test" and row["location_id"] == "ALL":
            lines.append(f"| {row['target']} ({row['units']}) | {row['horizon_hours']}h | {row['method']} | {row['hours']} | {fmt(row['mae'])} | {fmt(row['rmse'])} | {fmt(row['interval_coverage_80'])} | {fmt(row['mean_interval_width'])} |")
    lines += ["", "## Rainfall diagnostics", "",
              "| Horizon | Method | Wet hours | Wet-hour MAE (mm/h) | Total rainfall MAE (mm/window) | Total rainfall bias (mm/window) |",
              "|---|---|---:|---:|---:|---:|"]
    for row in report["metrics"]:
        if row["split"] == "test" and row["location_id"] == "ALL" and row["target"] == "precipitation":
            lines.append(f"| {row['horizon_hours']}h | {row['method']} | {row['wet_hours']} | {fmt(row['wet_hour_mae'])} | {fmt(row['total_rainfall_mae_mm_per_window'])} | {fmt(row['total_rainfall_bias_mm_per_window'])} |")
    comparisons = report["baseline_comparisons"]
    wins = sum(item["chronos_better_mae"] for item in comparisons)
    lines += ["", "## Baseline comparison", "",
              f"Chronos has lower test MAE in **{wins}/{len(comparisons)}** available target/horizon/baseline comparisons. Ties are not wins.", ""]
    for row in comparisons:
        result = "PASS" if row["chronos_better_mae"] else "FAIL"
        lines.append(f"- {result}: {row['target']} {row['horizon_hours']}h versus {row['baseline']}: Chronos MAE {fmt(row['chronos_mae'])}; baseline MAE {fmt(row['baseline_mae'])}.")
    lines += ["", "A FAIL above describes predictive skill relative to that baseline, not a service failure. Next experiment: extend rolling origins across wet/dry seasons and additional locations; test past-only multivariate covariates against independent station records, then recalibrate intervals on a separate calibration set. Do not fine-tune until enough labeled data and a blind holdout exist.", "",
              "## Runtime and provenance", "",
              f"- Successful inference calls: {report['runtime']['successful_calls']}/{report['runtime']['inference_calls']}.",
              f"- Mean inference latency: {fmt(report['runtime']['latency_mean_seconds'])} seconds; p95: {fmt(report['runtime']['latency_p95_seconds'])} seconds.",
              f"- Process peak RSS: {report['runtime']['peak_process_rss_bytes'] / 1024 ** 2:.1f} MiB. {report['runtime']['memory_note']}",
              f"- Skipped windows: {len(report['skipped_windows'])}; model errors: {len(report['model_errors'])}.",
              "- Exact origins, validation metrics, per-location scores, source manifests, artifact hashes, and per-window predictions are in report.json."]
    if "model_load_seconds" in report["runtime"]:
        lines.append(f"- Cached CPU model load: {fmt(report['runtime']['model_load_seconds'])} seconds.")
    for timing in report["runtime"]["latency_by_horizon"]:
        lines.append(f"- {timing['horizon_hours']}h direct inference: {timing['successful_calls']} successful calls, mean {fmt(timing['mean_seconds'])} seconds, p95 {fmt(timing['p95_seconds'])} seconds.")
    if "provenance" in report:
        lines.append(f"- Model: `{report['provenance'].get('model_id', 'unknown')}`; revision: `{report['provenance'].get('model_revision', 'unknown')}`.")
    lines += ["", "## Limitations", ""] + [f"- {item}" for item in report["limitations"]]
    lines += ["", "Weather data: [Open-Meteo](https://open-meteo.com/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Data transformed into hourly UTC Parquet and forecast/evaluation outputs. Model: [Chronos-2-Small](https://huggingface.co/autogluon/chronos-2-small), Apache 2.0.", ""]
    return "\n".join(lines)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Offline chronological Chronos vs baseline replay evaluation")
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--model-dir", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--locations", nargs="+")
    parser.add_argument("--origins-per-split", type=int, default=4)
    parser.add_argument("--context-hours", type=int)
    args = parser.parse_args(argv)
    from .config import Settings
    from .data import DataRepository
    from .model import LocalChronos
    settings = Settings.from_env()
    changes = {name: getattr(args, name) for name in ("data_dir", "model_dir", "context_hours") if getattr(args, name) is not None}
    settings = replace(settings, **changes)
    output_dir = args.output_dir or settings.data_dir / "evaluation"
    config = EvaluationConfig(context_hours=settings.context_hours, origins_per_split=args.origins_per_split)
    repository = DataRepository(settings)
    location_ids = args.locations or sorted(path.stem for path in settings.data_dir.glob("*.parquet"))
    if not location_ids:
        raise ValueError("No cached datasets; run explicit ingestion first")
    frames, manifests = {}, {}
    for location_id in location_ids:
        if Path(location_id).name != location_id:
            raise ValueError("Location IDs must be names, not paths")
        frames[location_id], manifests[location_id] = repository.load(location_id)
        if manifests[location_id].get("synthetic") is True:
            raise ValueError("Refusing to report synthetic fixtures as actual weather evaluation")
    model = LocalChronos(settings)
    load_start = time.perf_counter()
    model.load()
    model_load_seconds = time.perf_counter() - load_start
    report = evaluate_frames(frames, manifests, model, config)
    model_manifest_path = settings.model_dir / "weather-model.json"
    model_manifest = json.loads(model_manifest_path.read_text()) if model_manifest_path.exists() else {}
    report["provenance"] = {
        "model_id": settings.model_id, "model_revision": model_manifest.get("revision", settings.model_revision),
        "model_manifest": model_manifest,
        "python": platform.python_version(), "platform": platform.platform(), "machine": platform.machine(),
        "package_versions": {name: importlib.metadata.version(name) for name in
                             ("chronos-forecasting", "torch", "pandas", "numpy")},
        "dataset_sha256": {location_id: sha256_file(settings.data_dir / f"{location_id}.parquet") for location_id in location_ids},
        "model_sha256": {str(path.relative_to(settings.model_dir)): sha256_file(path)
                         for path in sorted(settings.model_dir.rglob("*")) if path.is_file() and path.suffix in {".safetensors", ".json"}},
    }
    report["runtime"]["model_load_seconds"] = model_load_seconds
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    (output_dir / "REPORT.md").write_text(markdown_report(report))
    print(json.dumps({"status": report["status"], "report": str(output_dir / "report.json"),
                      "successful_inference_calls": report["runtime"]["successful_calls"],
                      "skipped_windows": len(report["skipped_windows"]), "model_errors": len(report["model_errors"])}))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
