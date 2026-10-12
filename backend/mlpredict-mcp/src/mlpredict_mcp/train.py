"""Train, evaluate and save the five models. Run: `uv run python -m mlpredict_mcp.train` (a few minutes on a laptop CPU).

Every split is chronological (train on earlier time, test on later time) and every model is compared with a simple
baseline on the same test rows. All data is synthetic, so every metric is a synthetic benchmark: it shows the pipeline
works and how the model compares with the baseline here, not real-world accuracy.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import duckdb
import joblib
import lightgbm as lgb
import numpy as np
import sklearn
from sklearn.ensemble import IsolationForest
from sklearn.metrics import average_precision_score, roc_auc_score

from mlpredict_mcp import features as F
from mlpredict_mcp import paths

MODEL_VERSION = "1.0.0"
SEED = 42
FOOTFALL_TEST_DAYS = 28
BOOTH_TEST_DAYS = 42
FAILURE_TEST_DAYS = 15
CONGESTION_TEST_HOURS = 168
ANOMALY_TEST_DAYS = 14


def _rmse(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.sqrt(np.mean((a - b) ** 2)))


def _mae(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.mean(np.abs(a - b)))


def _r(v: float, d: int = 3) -> float:
    return round(float(v), d)


def _auc(fn, y: np.ndarray, score: np.ndarray) -> float | None:
    """ROC/PR AUC, or None when the test rows hold only one class (tiny test data)."""
    return _r(fn(y, score)) if 0 < y.sum() < len(y) else None


def _quiet(params: dict[str, Any]) -> dict[str, Any]:
    return {"verbose": -1, "seed": SEED, "deterministic": True, "force_row_wise": True, "num_threads": 4, **params}


# ---------------------------------------------------------------- footfall

def train_footfall(ff: F.Footfall, out: Path) -> dict[str, Any]:
    t0, H = 336, ff.hours
    split = H - FOOTFALL_TEST_DAYS * 24
    xs, ys, test_x, test_y = [], [], [], []
    for i in range(len(ff.areas)):
        x = ff.matrix(i, t0, H)
        y = ff.visitors[i, t0:H]
        xs.append(x[: split - t0])
        ys.append(y[: split - t0])
        test_x.append(x[split - t0 :])
        test_y.append(y[split - t0 :])
    x, y, tx, ty = np.vstack(xs), np.concatenate(ys), np.vstack(test_x), np.concatenate(test_y)
    preds = {}
    for name, alpha in (("p10", 0.1), ("p50", 0.5), ("p90", 0.9)):
        booster = lgb.train(_quiet({"objective": "quantile", "alpha": alpha, "learning_rate": 0.05, "num_leaves": 63, "min_data_in_leaf": 40}),
                            lgb.Dataset(x, y, feature_name=F.FOOTFALL_FEATURES, categorical_feature=["area"]), num_boost_round=400)
        booster.save_model(str(out / f"footfall_{name}.txt"))
        preds[name] = np.clip(booster.predict(tx), 0, None)
    base = tx[:, F.FOOTFALL_FEATURES.index("lag_168")]
    event = tx[:, F.FOOTFALL_FEATURES.index("event_attendance")] > 0
    inside = (ty >= preds["p10"]) & (ty <= preds["p90"])
    return {
        "task": "Hourly visitors per area (aggregate, synthetic)", "model": "LightGBM quantile regression (P10/P50/P90)",
        "baseline": "same hour last week (seasonal naive)", "features": F.FOOTFALL_FEATURES,
        "split": f"chronological: train on the first {(split - t0) // 24} days (after a 14-day lag warm-up), test on the last {FOOTFALL_TEST_DAYS} days",
        "rows": {"train": int(len(y)), "test": int(len(ty))},
        "metrics": {
            "model_p50": {"mae": _r(_mae(preds["p50"], ty), 1), "rmse": _r(_rmse(preds["p50"], ty), 1)},
            "baseline": {"mae": _r(_mae(base, ty), 1), "rmse": _r(_rmse(base, ty), 1)},
            "event_hours": {"rows": int(event.sum()), "model_p50_mae": _r(_mae(preds["p50"][event], ty[event]), 1) if event.any() else None,
                            "baseline_mae": _r(_mae(base[event], ty[event]), 1) if event.any() else None},
            "p10_p90_coverage": _r(inside.mean()), "units": "visitors per hour",
        },
    }


# ---------------------------------------------------------------- booth ranking

def _ndcg_at_k(actual: np.ndarray, score: np.ndarray, k: int = 3) -> float:
    order = np.argsort(-score)[:k]
    ideal = np.sort(actual)[::-1][:k]
    disc = 1 / np.log2(np.arange(2, k + 2))
    dcg = float(np.sum(actual[order] * disc[: len(order)]))
    idcg = float(np.sum(ideal * disc[: len(ideal)]))
    return dcg / idcg if idcg > 0 else 1.0


def train_booth(ml: duckdb.DuckDBPyConnection, area_index: dict[str, int], out: Path) -> dict[str, Any]:
    x, y, days = F.booth_rows(ml, area_index)
    last = max(days)
    test = np.array([(last - d).days < BOOTH_TEST_DAYS for d in days])
    booster = lgb.train(_quiet({"objective": "poisson", "learning_rate": 0.05, "num_leaves": 15, "min_data_in_leaf": 10}),
                        lgb.Dataset(x[~test], y[~test], feature_name=F.BOOTH_FEATURES, categorical_feature=["area"]), num_boost_round=300)
    booster.save_model(str(out / "booth.txt"))
    pred = booster.predict(x[test])
    foot = x[test][:, F.BOOTH_FEATURES.index("footfall_during")]
    rate = y[~test].sum() / x[~test][:, F.BOOTH_FEATURES.index("footfall_during")].sum()
    base = foot * rate
    test_days = sorted({d for d, t in zip(days, test, strict=True) if t})
    nd_m, nd_b, hit_m, hit_b = [], [], [], []
    tdays = np.array(days, dtype=object)[test]
    for d in test_days:
        m = tdays == d
        a, p, f = y[test][m], pred[m], foot[m]
        nd_m.append(_ndcg_at_k(a, p))
        nd_b.append(_ndcg_at_k(a, f))
        top = set(np.argsort(-a)[:3])
        hit_m.append(len(top & set(np.argsort(-p)[:3])) / 3)
        hit_b.append(len(top & set(np.argsort(-f)[:3])) / 3)
    return {
        "task": "Booth sign-ups (synthetic proxy) for a temporary sales booth in an area and time window",
        "model": "LightGBM Poisson regression; areas ranked by predicted sign-ups", "baseline": "rank by footfall during the booth hours",
        "features": F.BOOTH_FEATURES, "split": f"chronological: test on the last {BOOTH_TEST_DAYS} days of booth history",
        "rows": {"train": int((~test).sum()), "test": int(test.sum()), "test_days": len(test_days)},
        "metrics": {
            "ndcg_at_3": {"model": _r(np.mean(nd_m)), "baseline": _r(np.mean(nd_b))},
            "top3_hit_rate": {"model": _r(np.mean(hit_m)), "baseline": _r(np.mean(hit_b))},
            "signups_mae": {"model": _r(_mae(pred, y[test]), 2), "baseline": _r(_mae(base, y[test]), 2)}, "units": "sign-ups per booth",
        },
    }


# ---------------------------------------------------------------- site failure risk

def train_failure(intel: duckdb.DuckDBPyConnection, out: Path) -> dict[str, Any]:
    sites, days, feats, label = F.failure_table(intel)
    D = len(days)
    usable = np.arange(7, D - 1)  # a week of history, and a known next day
    split = D - 1 - FAILURE_TEST_DAYS
    tr, te = usable[usable < split], usable[usable >= split]
    x_tr, y_tr = feats[:, tr].reshape(-1, feats.shape[-1]), label[:, tr].reshape(-1)
    x_te, y_te = feats[:, te].reshape(-1, feats.shape[-1]), label[:, te].reshape(-1)
    pos = max(1.0, y_tr.sum())
    booster = lgb.train(_quiet({"objective": "binary", "learning_rate": 0.05, "num_leaves": 15, "min_data_in_leaf": 30,
                                "scale_pos_weight": float((len(y_tr) - pos) / pos)}),
                        lgb.Dataset(x_tr, y_tr, feature_name=F.FAILURE_FEATURES), num_boost_round=250)
    booster.save_model(str(out / "failure.txt"))
    p = booster.predict(x_te)
    fi = F.FAILURE_FEATURES
    base = np.nan_to_num(x_te[:, fi.index("alarms_3d")] + 2 * x_te[:, fi.index("warnings_3d")] + x_te[:, fi.index("max_loss_1d")])
    k = max(1, int(y_te.sum()))

    def at_k(score: np.ndarray) -> dict[str, float]:
        top = np.argsort(-score)[:k]
        hit = y_te[top].sum()
        return {"precision": _r(hit / k), "recall": _r(hit / max(1, y_te.sum()))}

    calib = {"threshold_high": float(np.quantile(p, 0.99)), "threshold_medium": float(np.quantile(p, 0.95))}
    (out / "failure_calibration.json").write_text(json.dumps(calib))
    return {
        "task": "Will a total/partial outage start at this site in the next 24 hours? (synthetic labels)",
        "model": "LightGBM binary classifier (class-weighted)", "baseline": "recent alarm and packet-loss count", "features": fi,
        "split": f"chronological: train on days 8-{split} of the window, test on the last {FAILURE_TEST_DAYS} labelled days",
        "rows": {"train": int(len(y_tr)), "test": int(len(y_te)), "test_positives": int(y_te.sum())},
        "metrics": {
            "base_rate": _r(y_te.mean(), 4),
            "pr_auc": {"model": _auc(average_precision_score, y_te, p), "baseline": _auc(average_precision_score, y_te, base)},
            "roc_auc": {"model": _auc(roc_auc_score, y_te, p), "baseline": _auc(roc_auc_score, y_te, base)},
            f"at_top_{k}": {"model": at_k(p), "baseline": at_k(base)},
            "risk_levels": "HIGH above the 99th percentile of test scores, MEDIUM above the 95th",
        },
        "label_note": "About 60% of outages carry a synthetic precursor (SCN-OUTAGE-PRECURSORS); the rest are unpredictable by construction.",
    }


# ---------------------------------------------------------------- congestion forecast

def train_congestion(intel: duckdb.DuckDBPyConnection, out: Path) -> dict[str, Any]:
    rng = np.random.default_rng(SEED)
    net = F.load_network(intel)
    H = net.hours
    t0, split = 504, H - CONGESTION_TEST_HOURS
    xs, ys, txs, tys = [], [], [], []
    for i in range(len(net.cells)):
        x = F.congestion_matrix(net, i, t0, H).astype(np.float32)
        y = net.prb[i, t0:H]
        keep = rng.random(split - t0) < 0.35
        xs.append(x[: split - t0][keep])
        ys.append(y[: split - t0][keep])
        txs.append(x[split - t0 :])
        tys.append(y[split - t0 :])
    x, y, tx, ty = np.vstack(xs), np.concatenate(ys), np.vstack(txs), np.concatenate(tys)
    booster = lgb.train(_quiet({"objective": "regression", "learning_rate": 0.08, "num_leaves": 63, "min_data_in_leaf": 100, "feature_fraction": 0.9}),
                        lgb.Dataset(x, y, feature_name=F.CONGESTION_FEATURES, categorical_feature=["band", "morphology"]), num_boost_round=300)
    booster.save_model(str(out / "congestion.txt"))
    pred = np.clip(booster.predict(tx), 0, 100)
    base = np.nan_to_num(tx[:, F.CONGESTION_FEATURES.index("lag_168")])
    resid = ty - pred
    q10, q90 = float(np.quantile(resid, 0.1)), float(np.quantile(resid, 0.9))
    (out / "congestion_interval.json").write_text(json.dumps({"q10": q10, "q90": q90}))
    hot = ty >= 85

    def busy(score: np.ndarray) -> dict[str, float]:
        flag = score >= 85
        tp = float((flag & hot).sum())
        return {"recall": _r(tp / max(1, hot.sum())), "precision": _r(tp / max(1, flag.sum()))}

    event = tx[:, F.CONGESTION_FEATURES.index("event_attendance")] > 0
    return {
        "task": "Hourly DL PRB utilisation per 4G cell, up to 7 days ahead (synthetic)", "model": "LightGBM regression",
        "baseline": "same hour last week (seasonal naive)", "features": F.CONGESTION_FEATURES,
        "split": f"chronological: train on hours 504-{split} (35% sample), test on the last {CONGESTION_TEST_HOURS} hours, all cells",
        "rows": {"train": int(len(y)), "test": int(len(ty))},
        "metrics": {
            "model": {"mae": _r(_mae(pred, ty), 2), "rmse": _r(_rmse(pred, ty), 2)},
            "baseline": {"mae": _r(_mae(base, ty), 2), "rmse": _r(_rmse(base, ty), 2)},
            "busy_hours_at_85pct": {"model": busy(pred), "baseline": busy(base)},
            "event_hours": {"rows": int(event.sum()), "model_mae": _r(_mae(pred[event], ty[event]), 2) if event.any() else None,
                            "baseline_mae": _r(_mae(base[event], ty[event]), 2) if event.any() else None},
            "interval_p10_p90_from_test_residuals": [_r(q10, 2), _r(q90, 2)], "units": "% PRB",
        },
    }


# ---------------------------------------------------------------- anomalies

def train_anomaly(intel: duckdb.DuckDBPyConnection, out: Path) -> dict[str, Any]:
    rng = np.random.default_rng(SEED)
    cells = sorted(r[0] for r in intel.execute("SELECT cell_name FROM cell").fetchall())
    sample = sorted(rng.choice(cells, size=min(600, len(cells)), replace=False).tolist())
    end = F.data_end(intel)
    start = intel.execute("SELECT min(ts_utc) FROM kpi_hourly").fetchone()[0]
    split = end - timedelta(days=ANOMALY_TEST_DAYS)
    train = F.anomaly_frame(intel, start, split, sample)
    test = F.anomaly_frame(intel, split, end, sample)
    fit_rows = rng.choice(len(train["x"]), size=min(200_000, len(train["x"])), replace=False)
    forest = IsolationForest(n_estimators=200, max_samples=4096, contamination="auto", random_state=SEED, n_jobs=4)
    forest.fit(train["x"][fit_rows])
    train_score = -forest.score_samples(train["x"][fit_rows])
    threshold = float(np.quantile(train_score, 0.995))
    joblib.dump({"forest": forest, "threshold": threshold, "features": F.ANOMALY_FEATURES}, out / "anomaly.joblib")
    score = -forest.score_samples(test["x"])
    labels = F.labelled_hours(intel)
    truth = np.array([(s, t.astype("datetime64[s]").astype(datetime)) in labels for s, t in zip(test["site_id"], test["ts_utc"], strict=True)])
    flagged = score >= threshold
    rule = (np.nan_to_num(test["availability_pct"], nan=0) < 95) | (
        ((np.nan_to_num(test["packet_loss_pct"]) >= 2) | (np.nan_to_num(test["latency_ms"]) >= 60)) & (np.nan_to_num(test["prb_dl_pct"]) < 90))

    def pr(flag: np.ndarray) -> dict[str, float]:
        tp = float((flag & truth).sum())
        return {"precision": _r(tp / max(1, flag.sum())), "recall": _r(tp / max(1, truth.sum())), "flagged": int(flag.sum())}

    return {
        "task": "Unusual cell-hours: deviation from the cell's usual load, throughput, loss, latency and availability for that hour of the week",
        "model": "Isolation Forest (scikit-learn), threshold at the 99.5th percentile of training scores",
        "baseline": "fixed thresholds (availability < 95%, or loss >= 2% / latency >= 60 ms below 90% PRB)", "features": F.ANOMALY_FEATURES,
        "split": f"chronological: fit on the window before the last {ANOMALY_TEST_DAYS} days, test on those days; 600 sampled cells",
        "rows": {"fit": int(len(fit_rows)), "test": int(len(score)), "test_labelled": int(truth.sum())},
        "metrics": {"model": pr(flagged), "baseline": pr(rule), "pr_auc_model": _auc(average_precision_score, truth, score)},
        "label_note": "Labels are the cell-hours inside recorded incidents (outages, degradations, maintenance, backhaul alarms). "
                      "The baseline thresholds are close to how those incidents were written into the data, so it is expected to do well.",
    }


# ---------------------------------------------------------------- orchestration

def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def train_all(intel_path: Path, ml_path: Path, out: Path) -> dict[str, Any]:
    out.mkdir(parents=True, exist_ok=True)
    intel = duckdb.connect(str(intel_path), read_only=True)
    ml = duckdb.connect(str(ml_path), read_only=True)
    try:
        ff = F.load_footfall(ml, intel)
        area_index = {a["area_id"]: i for i, a in enumerate(ff.areas)}
        started = datetime.now(UTC)
        metrics = {
            "footfall": train_footfall(ff, out),
            "booth": train_booth(ml, area_index, out),
            "failure": train_failure(intel, out),
            "congestion": train_congestion(intel, out),
            "anomaly": train_anomaly(intel, out),
        }
        intel_meta = dict(intel.execute("SELECT key, value FROM meta").fetchall())
        ml_meta = dict(ml.execute("SELECT key, value FROM meta").fetchall())
    finally:
        intel.close()
        ml.close()
    manifest = {
        "model_version": MODEL_VERSION, "trained_at_utc": started.isoformat(timespec="seconds"),
        "training_seconds": round((datetime.now(UTC) - started).total_seconds(), 1),
        "data": {"intel_generator": intel_meta.get("generator_version"), "ml_generator": ml_meta.get("generator_version"),
                 "seed": intel_meta.get("seed"), "netops_ref_date": intel_meta.get("netops_ref_date"), "synthetic": True},
        "libraries": {"lightgbm": lgb.__version__, "scikit-learn": sklearn.__version__, "numpy": np.__version__, "python": platform.python_version()},
        "area_ids": [a["area_id"] for a in ff.areas],
        "files": {p.name: _sha(p) for p in sorted(out.iterdir()) if p.suffix in (".txt", ".joblib", ".json") and p.name not in ("manifest.json", "metrics.json")},
    }
    (out / "metrics.json").write_text(json.dumps(metrics, indent=2))
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return {"manifest": manifest, "metrics": metrics}


def _fresh(out: Path, ml_path: Path) -> bool:
    manifest = out / "manifest.json"
    if not manifest.exists() or not ml_path.exists():
        return False
    m = json.loads(manifest.read_text())
    ml = duckdb.connect(str(ml_path), read_only=True)
    try:
        ml_meta = dict(ml.execute("SELECT key, value FROM meta").fetchall())
    finally:
        ml.close()
    return m.get("model_version") == MODEL_VERSION and m["data"].get("ml_generator") == ml_meta.get("generator_version") and (
        m["trained_at_utc"] >= ml_meta.get("built_at_utc", ""))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="mlpredict-train", description=__doc__)
    parser.add_argument("--intel-db", type=Path, default=paths.intel_db())
    parser.add_argument("--ml-db", type=Path, default=paths.ml_db())
    parser.add_argument("--out", type=Path, default=paths.models_dir())
    parser.add_argument("--if-stale", action="store_true", help="only train when there are no models, or they are older than the data or this code")
    args = parser.parse_args(argv)
    if args.if_stale and _fresh(args.out, args.ml_db):
        return
    result = train_all(args.intel_db, args.ml_db, args.out)
    print(f"trained in {result['manifest']['training_seconds']} s -> {args.out}")
    for name, m in result["metrics"].items():
        print(f"{name}: {json.dumps(m['metrics'])}")


if __name__ == "__main__":
    main()
