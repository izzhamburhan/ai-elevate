"""The prediction tools. Every number comes from a trained local model (LightGBM / Isolation Forest) on synthetic data.

Each returns the Menara envelope; `data` always has summary, geojson, provenance, data_freshness, limitations and the
prediction window (UTC and Malaysia time), plus its own fields (see docs/PREDICTIVE_ML_ECOSYSTEM.md).
"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any

import duckdb
import joblib
import lightgbm as lgb
import numpy as np
from menara_core.envelope import Envelope, Evidence
from netintel_mcp.store import collection, iso_utc, point, sector, times
from netintel_mcp.tools import InputError, _select_sites

from mlpredict_mcp import features as F
from mlpredict_mcp import paths

SOURCE = "mlpredict-mcp"
MODELS = ("footfall", "booth", "failure", "congestion", "anomaly")


class NotTrainedError(RuntimeError):
    pass


# ---------------------------------------------------------------- models and data

@lru_cache(maxsize=4)
def _load(models_dir: str, stamp: float) -> dict[str, Any]:
    d = Path(models_dir)
    return {
        "manifest": json.loads((d / "manifest.json").read_text()),
        "metrics": json.loads((d / "metrics.json").read_text()),
        "footfall": {q: lgb.Booster(model_file=str(d / f"footfall_{q}.txt")) for q in ("p10", "p50", "p90")},
        "booth": lgb.Booster(model_file=str(d / "booth.txt")),
        "failure": lgb.Booster(model_file=str(d / "failure.txt")),
        "failure_calibration": json.loads((d / "failure_calibration.json").read_text()),
        "congestion": lgb.Booster(model_file=str(d / "congestion.txt")),
        "congestion_interval": json.loads((d / "congestion_interval.json").read_text()),
        "anomaly": joblib.load(d / "anomaly.joblib"),
    }


def models() -> dict[str, Any]:
    d = paths.models_dir()
    manifest = d / "manifest.json"
    if not manifest.exists():
        raise NotTrainedError(f"No trained models in {d}. Train them with: uv run python -m mlpredict_mcp.train")
    return _load(str(d), manifest.stat().st_mtime)


def _connect(path: Path) -> duckdb.DuckDBPyConnection:
    if not path.exists():
        raise NotTrainedError(f"{path.name} not found at {path}. Build it first (netintel_mcp.seed, then mlpredict_mcp.data).")
    return duckdb.connect(str(path), read_only=True)


def _envelope(tool: str, data: dict[str, Any], used: list[str], data_end: datetime, warnings: list[str]) -> dict[str, Any]:
    m = models()["manifest"]
    stamp = iso_utc(data_end) or ""
    data["provenance"] = {
        "models": {name: models()["metrics"][name]["model"] for name in used}, "model_version": m["model_version"],
        "trained_at_utc": m["trained_at_utc"], "data": m["data"], "libraries": m["libraries"], "synthetic": True,
        "method": "local model inference (LightGBM / scikit-learn) on CPU; no LLM produced these numbers",
    }
    data["data_freshness"] = {"data_end": times(data_end), "live": False,
                              "note": "Synthetic history; forecasts start at the end of the data window, not the wall clock."}
    evidence = [Evidence(source=SOURCE, tool=f"model:{name}", call_id=uuid.uuid4().hex[:12], ref=m["model_version"], confidence=1.0, as_of=stamp)
                for name in used]
    return Envelope[dict[str, Any]](synthetic=True, as_of=stamp, data=data, evidence=evidence, warnings=warnings).model_dump(mode="json")


LIMITATIONS = [
    "Trained and evaluated on synthetic data: metrics are synthetic benchmarks, not real-world accuracy.",
    "Predictions are estimates with uncertainty; they are not guarantees and do not identify any person.",
]

PREDICTION_SCHEMA = "mlpredict-prediction-v1"


def _prediction(subject: str, subject_id: str, name: str | None, prediction: str, window: dict[str, Any], value: float | None, unit: str,
                score: float | None, level: str | None, evidence: list[str], confidence: str, confidence_basis: str,
                cluster: str | None = None) -> dict[str, Any]:
    """One row of the shared `predictions` list every predictive tool returns (docs/ORDER5_PREDICTIVE_INTELLIGENCE.md).

    Hermes agents and the Opportunity Graph read this instead of each tool's own fields. confidence is low/medium/high.
    """
    return {"schema": PREDICTION_SCHEMA, "subject": {"type": subject, "id": subject_id, "name": name, "cluster": cluster},
            "prediction": prediction, "window": window, "value": value, "unit": unit, "score": score, "level": level,
            "evidence": evidence, "confidence": confidence, "confidence_basis": confidence_basis, "synthetic": True}


def _band_confidence(p10: float, p50: float, p90: float) -> tuple[str, str]:
    width = (p90 - p10) / max(p50, 1.0)
    level = "high" if width < 0.35 else "medium" if width < 0.7 else "low"
    return level, f"P10-P90 band is {width:.0%} of the median forecast (synthetic data; synthetic coverage 77% vs 80% nominal)"


def _window(day: str | None, hour_from: int, hour_to: int, default_weekday: int | None, data_end: datetime) -> tuple[datetime, datetime, date]:
    """[start, end) in naive UTC for local hours hour_from..hour_to (inclusive) on `day` (YYYY-MM-DD, Malaysia time)."""
    if not (0 <= hour_from <= 23 and 0 <= hour_to <= 23 and hour_from <= hour_to):
        raise InputError("hour_from and hour_to must be 0-23 with hour_from <= hour_to (Malaysia time)")
    end_local = data_end + F.MYT
    if day:
        d = date.fromisoformat(day)
    else:
        target = default_weekday if default_weekday is not None else end_local.weekday()
        d = (end_local + timedelta(days=(target - end_local.weekday()) % 7)).date()
    start = datetime.combine(d, datetime.min.time()) + timedelta(hours=hour_from) - F.MYT
    return start, start + timedelta(hours=hour_to - hour_from + 1), d


def _areas(intel, area_ids=None, cluster=None, lat=None, lng=None, radius_km=None) -> list[dict[str, Any]]:
    rows = [dict(zip(("area_id", "name", "cluster", "lat", "lng", "source"), r, strict=True))
            for r in intel.execute("SELECT area_id, name, cluster, lat, lng, source FROM area ORDER BY area_id").fetchall()]
    if area_ids:
        known = {a["area_id"]: a for a in rows}
        missing = [a for a in area_ids if a not in known]
        if missing:
            raise InputError(f"Unknown area ids: {', '.join(missing)}. Known: {', '.join(known)}")
        return [known[a] for a in area_ids]
    if cluster:
        chosen = [a for a in rows if a["cluster"].lower() == cluster.strip().lower()]
        if not chosen:
            raise InputError(f"Unknown cluster {cluster!r}. Known: {', '.join(sorted({a['cluster'] for a in rows}))}")
        return chosen
    if lat is not None and lng is not None:
        chosen = [a for a in rows if F.haversine_km(lat, lng, a["lat"], a["lng"]) <= (radius_km or 25)]
        if not chosen:
            raise InputError("No area in that circle.")
        return chosen
    return rows


# ---------------------------------------------------------------- footfall

def _footfall_forecast(ff: F.Footfall, area_idx: int, start: datetime, end: datetime) -> dict[str, np.ndarray]:
    t0 = int((start - ff.start_utc).total_seconds() // 3600)
    t1 = int((end - ff.start_utc).total_seconds() // 3600)
    if t0 < 336:
        raise InputError("That window is before the footfall history the model needs (two weeks of lags).")
    if t1 - 1 - F.WEEK >= ff.hours:
        raise InputError("Footfall forecasts reach at most 7 days past the end of the data.")
    x = ff.matrix(area_idx, t0, t1)
    boosters = models()["footfall"]
    pred = {q: np.clip(boosters[q].predict(x), 0, None) for q in ("p10", "p50", "p90")}
    pred["p10"] = np.minimum(pred["p10"], pred["p50"])
    pred["p90"] = np.maximum(pred["p90"], pred["p50"])
    pred["actual"] = ff.visitors[area_idx, t0:t1] if t1 <= ff.hours else None
    pred["event_attendance"] = x[:, F.FOOTFALL_FEATURES.index("event_attendance")]
    return pred


def predict_area_footfall(day: str | None = None, hour_from: int = 16, hour_to: int = 21, area_ids: list[str] | None = None,
                          cluster: str | None = None, lat: float | None = None, lng: float | None = None, radius_km: float | None = None,
                          limit: int = 10) -> dict[str, Any]:
    intel, ml = _connect(paths.intel_db()), _connect(paths.ml_db())
    try:
        ff = F.load_footfall(ml, intel)
        end = F.data_end(intel)
        start_w, end_w, d = _window(day, hour_from, hour_to, 5, end)  # default: the next Saturday
        chosen = _areas(intel, area_ids, cluster, lat, lng, radius_km)
        index = {a["area_id"]: i for i, a in enumerate(ff.areas)}
        events = {e[0]: e for e in F.load_events(intel)}
        rows = []
        for a in chosen:
            p = _footfall_forecast(ff, index[a["area_id"]], start_w, end_w)
            peak = int(np.argmax(p["p50"]))
            near = [e for e in events.values() if e[4] < end_w + timedelta(hours=1) and e[5] > start_w - timedelta(hours=1)
                    and F.haversine_km(a["lat"], a["lng"], e[2], e[3]) <= F.event_radius_km(e[6])]
            rows.append({
                "area_id": a["area_id"], "name": a["name"], "cluster": a["cluster"], "lat": a["lat"], "lng": a["lng"],
                "expected_visitors": {"p10": int(p["p10"].sum()), "p50": int(p["p50"].sum()), "p90": int(p["p90"].sum())},
                "peak_hour_myt": hour_from + peak, "peak_hour_visitors_p50": int(p["p50"][peak]),
                "hourly_p50": [int(v) for v in p["p50"]],
                "actual_visitors": int(p["actual"].sum()) if p["actual"] is not None else None,
                "events": [{"event_id": e[0], "kind": e[1], "attendance": e[6], "start": times(e[4]), "end": times(e[5])} for e in near],
            })
        rows.sort(key=lambda r: -r["expected_visitors"]["p50"])
        shown = rows[: max(1, min(limit, 50))]
        top = shown[0]
        future = start_w >= end
        sev = lambda rank: "HIGH" if rank < 3 else "MEDIUM" if rank < 8 else "LOW"  # noqa: E731
        features = [point(r["lat"], r["lng"], id=r["area_id"], kind="area", severity=sev(i), score=round(r["expected_visitors"]["p50"] / max(1, top["expected_visitors"]["p50"]), 2),
                          label=f"{r['name']}: ~{r['expected_visitors']['p50']:,} visitors", unit="visitors") for i, r in enumerate(shown)]
        summary = (f"Busiest area {d:%A %d %b} {hour_from:02d}:00-{hour_to + 1:02d}:00 MYT: {top['name']} ({top['cluster']}), about "
                   f"{top['expected_visitors']['p50']:,} visitors (P10-P90 {top['expected_visitors']['p10']:,}-{top['expected_visitors']['p90']:,})"
                   + (f", with {len(top['events'])} event(s) nearby." if top["events"] else "."))
        window = {"start": times(start_w), "end": times(end_w), "day_myt": d.isoformat(), "kind": "forecast" if future else "backtest"}
        predictions = []
        for r in shown:
            v = r["expected_visitors"]
            conf, basis = _band_confidence(v["p10"], v["p50"], v["p90"])
            predictions.append(_prediction(
                "area", r["area_id"], r["name"], "aggregate footfall", window, v["p50"], "visitors", None, None,
                [f"P10-P90 {v['p10']:,}-{v['p90']:,} visitors", f"peak {r['peak_hour_myt']:02d}:00 MYT (~{r['peak_hour_visitors_p50']:,}/h)"]
                + [f"{e['event_id']} ({e['kind'].lower()}, {e['attendance']:,} people) in reach" for e in r["events"]],
                conf, basis, r["cluster"]))
        data = {
            "summary": summary, "window": window, "predictions": predictions,
            "areas": shown, "units": "visitors (aggregate count over the window)",
            "geojson": collection(features),
            "limitations": LIMITATIONS + ["The P10/P90 sums add hourly quantiles; they are a rough band, not an exact interval for the total.",
                                          "Areas are the best-rated shopping mall per NetOps cluster (Overture places); counts are synthetic."],
        }
        return _envelope("predict_area_footfall", data, ["footfall"], end, [] if future else ["This window is inside the history: it is a backtest, with actual counts shown."])
    finally:
        intel.close()
        ml.close()


# ---------------------------------------------------------------- congestion forecast (also used by booth ranking)

def _congestion(intel, site_ids: list[str], start: datetime, end: datetime) -> tuple[F.Network, np.ndarray, int, int]:
    net = F.load_network(intel, site_ids)
    t0 = int((start - net.start_utc).total_seconds() // 3600)
    t1 = int((end - net.start_utc).total_seconds() // 3600)
    if t0 < 504:
        raise InputError("That window is too early: the model needs three weeks of history before it.")
    if t1 - 1 - F.WEEK >= net.hours:
        raise InputError("Congestion forecasts reach at most 7 days past the end of the data.")
    booster = models()["congestion"]
    pred = np.vstack([np.clip(booster.predict(F.congestion_matrix(net, i, t0, t1)), 0, 100) for i in range(len(net.cells))])
    return net, pred, t0, t1


def forecast_network_congestion(start: str | None = None, end: str | None = None, cluster: str | None = None, site_ids: list[str] | None = None,
                                lat: float | None = None, lng: float | None = None, radius_km: float | None = None,
                                threshold_pct: float = 85.0, limit: int = 20, event_id: str | None = None) -> dict[str, Any]:
    intel = _connect(paths.intel_db())
    try:
        data_end = F.data_end(intel)
        if event_id:  # the cells around an event, for its hours (+-1 h)
            row = intel.execute("SELECT lat, lng, start_utc, end_utc FROM event WHERE event_id = ?", [event_id]).fetchone()
            if row is None:
                upcoming = [r[0] for r in intel.execute("SELECT event_id FROM event WHERE start_utc >= ? ORDER BY start_utc LIMIT 8", [data_end]).fetchall()]
                raise InputError(f"Unknown event {event_id}. Upcoming: {', '.join(upcoming)}")
            lat, lng, ev_start, ev_end = row
            radius_km = radius_km or 3.0
            if not start:
                start = (ev_start - timedelta(hours=1) + F.MYT).isoformat()
                end = (ev_end + timedelta(hours=1) + F.MYT).isoformat()
        sites = _select_sites(intel, site_ids=site_ids, cluster=cluster, lat=lat, lng=lng, radius_km=radius_km)
        if start:
            s = datetime.fromisoformat(start.replace("Z", "+00:00"))
            s = s - F.MYT if s.tzinfo is None else s.replace(tzinfo=None) - (s.utcoffset() or timedelta(0))
            e = datetime.fromisoformat(end.replace("Z", "+00:00")) if end else s + timedelta(hours=24)
            e = e - F.MYT if e.tzinfo is None else e.replace(tzinfo=None) - (e.utcoffset() or timedelta(0))
        else:
            # default: the coming weekend (Saturday 00:00 to Monday 00:00 MYT)
            local = data_end + F.MYT
            sat = (local + timedelta(days=(5 - local.weekday()) % 7)).date()
            s = datetime.combine(sat, datetime.min.time()) - F.MYT
            e = s + timedelta(days=2)
        net, pred, t0, t1 = _congestion(intel, [x["site_id"] for x in sites], s, e)
        interval = models()["congestion_interval"]
        site_index = {x["site_id"]: x for x in sites}
        cells = []
        for i, c in enumerate(net.cells):
            p = pred[i]
            hot = p >= threshold_pct
            peak = int(np.argmax(p))
            local_peak = s + timedelta(hours=peak) + F.MYT
            hot_hours = int(hot.sum())
            risk = "CRITICAL" if hot_hours >= 6 and p.max() >= 95 else "HIGH" if hot_hours >= 3 else "MEDIUM" if hot_hours >= 1 or p.max() >= threshold_pct - 10 else "LOW"
            ev = F.event_attendance(net.events, c["lat"], c["lng"], s, t1 - t0, radius_km=F.EVENT_CELL_RADIUS_KM)
            cells.append({"cell_name": c["cell_name"], "site_id": c["site_id"], "risk": risk, "forecast_peak_prb_pct": round(float(p.max()), 1),
                          "peak_at": times(local_peak - F.MYT), "hours_at_or_above_threshold": hot_hours,
                          "busy_hours_myt": sorted({(s + timedelta(hours=int(h)) + F.MYT).hour for h in np.flatnonzero(hot)}),
                          "interval_p10_p90_at_peak": [round(max(0.0, p.max() + interval["q10"]), 1), round(min(100.0, p.max() + interval["q90"]), 1)],
                          "event_attendance_nearby_max": int(ev.max()), "azimuth": c["azimuth"], "lat": c["lat"], "lng": c["lng"]})
        order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
        cells.sort(key=lambda c: (order[c["risk"]], -c["forecast_peak_prb_pct"], c["cell_name"]))
        shown = cells[: max(1, min(limit, 100))]
        counts = {k: sum(1 for c in cells if c["risk"] == k) for k in order}
        events = [ev for ev in net.events if ev[4] < e and ev[5] > s and any(F.haversine_km(x["lat"], x["lng"], ev[2], ev[3]) <= 3 for x in sites)]
        features = [sector(c["lat"], c["lng"], c["azimuth"], id=c["cell_name"], kind="sector", severity=c["risk"], score=round(c["forecast_peak_prb_pct"] / 100, 2),
                        label=f"{c['cell_name']} peak {c['forecast_peak_prb_pct']}%", unit="% PRB") for c in shown]
        worst: dict[str, str] = {}
        for c in shown:
            if c["site_id"] not in worst or order[c["risk"]] < order[worst[c["site_id"]]]:
                worst[c["site_id"]] = c["risk"]
        features += [point(site_index[sid]["lat"], site_index[sid]["lng"], id=sid, kind="site", severity=r, label=sid) for sid, r in worst.items()]
        features += [point(e[2], e[3], id=e[0], kind="event", label=f"{e[1].title()} ({e[6]:,} people)") for e in events]
        for c in shown:
            c.pop("azimuth"), c.pop("lat"), c.pop("lng")
        summary = (f"{counts['CRITICAL'] + counts['HIGH']} of {len(cells)} cells are forecast to congest (>= {threshold_pct:.0f}% PRB for 3+ hours) "
                   f"between {iso_utc(s)} and {iso_utc(e)} UTC" + (f"; {len(events)} event(s) in the area." if events else ".")
                   + (f" Worst: {shown[0]['cell_name']} peaking at {shown[0]['forecast_peak_prb_pct']}%." if shown else ""))
        window = {"start": times(s), "end": times(e), "kind": "forecast" if s >= data_end else "backtest"}
        predictions = [_prediction(
            "cell", c["cell_name"], c["site_id"], "peak DL PRB utilisation", window, c["forecast_peak_prb_pct"], "% PRB",
            round(c["forecast_peak_prb_pct"] / 100, 2), c["risk"],
            [f"{c['hours_at_or_above_threshold']} h at or above {threshold_pct:.0f}% PRB", f"P10-P90 at peak {c['interval_p10_p90_at_peak'][0]}-{c['interval_p10_p90_at_peak'][1]}%"]
            + ([f"up to {c['event_attendance_nearby_max']:,} event attendees within {F.EVENT_CELL_RADIUS_KM} km"] if c["event_attendance_nearby_max"] else []),
            "high" if abs(c["forecast_peak_prb_pct"] - threshold_pct) > interval["q90"] else "medium",
            f"distance of the peak from the {threshold_pct:.0f}% threshold vs the test-week error band ({interval['q10']:+.1f}/{interval['q90']:+.1f} points)",
            site_index[c["site_id"]]["cluster"]) for c in shown]
        data = {
            "summary": summary, "window": window, "predictions": predictions,
            "threshold_prb_pct": threshold_pct, "risk_counts": counts, "cells": shown, "truncated": len(cells) > len(shown),
            "events": [{"event_id": e[0], "kind": e[1], "attendance": e[6], "start": times(e[4]), "end": times(e[5])} for e in events],
            "risk_rule": "CRITICAL: 6+ hours at or above threshold and peak >= 95%; HIGH: 3+ hours; MEDIUM: any hour, or within 10 points; LOW otherwise",
            "units": "% DL PRB utilisation", "geojson": collection(features),
            "limitations": LIMITATIONS + ["The interval comes from the model's errors on the test week; it is not calibrated per cell.",
                                          "Forecasts reach one week past the data (the model uses last week's load)."],
        }
        return _envelope("forecast_network_congestion", data, ["congestion"], data_end, [])
    finally:
        intel.close()


# ---------------------------------------------------------------- booth ranking

def rank_business_locations(day: str | None = None, hour_from: int = 12, hour_to: int = 19, top_k: int = 3, staff: int = 3,
                            cluster: str | None = None, area_ids: list[str] | None = None) -> dict[str, Any]:
    intel, ml = _connect(paths.intel_db()), _connect(paths.ml_db())
    try:
        ff = F.load_footfall(ml, intel)
        end = F.data_end(intel)
        start_w, end_w, d = _window(day, hour_from, hour_to, 5, end)
        chosen = _areas(intel, area_ids, cluster)
        index = {a["area_id"]: i for i, a in enumerate(ff.areas)}
        booster = models()["booth"]
        weekend, holiday = float(d.weekday() >= 5), float(F.calendar_features(start_w, 1)["holiday"][0])
        sites = intel.execute("SELECT site_id, lat, lng FROM site").fetchall()
        rows = []
        for a in chosen:
            p = _footfall_forecast(ff, index[a["area_id"]], start_w, end_w)
            near_sites = [s for s, la, lo in sites if F.haversine_km(a["lat"], a["lng"], la, lo) <= 1.5]
            avail = intel.execute(
                "SELECT avg(availability_pct) FROM kpi_hourly WHERE site_id IN (SELECT unnest(?::VARCHAR[])) AND ts_utc >= ?",
                [near_sites, end - timedelta(days=14)]).fetchone()[0] if near_sites else None
            event = float(p["event_attendance"].max() > 0)
            x = np.array([[index[a["area_id"]], p["p50"].sum(), event, holiday, weekend, staff, hour_from, hour_to - hour_from + 1,
                           np.nan if avail is None else avail]])
            signups = float(booster.predict(x)[0])
            alt = [float(booster.predict(np.array([[x[0][0], p[q].sum(), *x[0][2:]]]))[0]) for q in ("p10", "p90")]
            lo, hi = min([signups, *alt]), max([signups, *alt])
            contrib = booster.predict(x, pred_contrib=True)[0][:-1]
            reasons = [_booth_reason(F.BOOTH_FEATURES[j], x[0][j], contrib[j], a["name"]) for j in np.argsort(-np.abs(contrib))[:3]]
            risks = []
            if near_sites and start_w >= end:
                _net, cp, _a, _b = _congestion(intel, near_sites, start_w, end_w)
                if cp.max() >= 85:
                    risks.append(f"Network: nearby cells forecast to reach {cp.max():.0f}% PRB in these hours (slower service for demos and sign-ups).")
            if avail is not None and avail < 99:
                risks.append(f"Network availability nearby averaged {avail:.1f}% over the last 14 days.")
            risks.append("Weather is not in this forecast; check Weather ML for rain on the day.")
            rows.append({"area_id": a["area_id"], "name": a["name"], "cluster": a["cluster"], "lat": a["lat"], "lng": a["lng"],
                         "expected_signups": round(signups, 1), "signups_band": [round(lo, 1), round(hi, 1)],
                         "expected_visitors_p50": int(p["p50"].sum()), "event_nearby": bool(event),
                         "network_availability_pct": None if avail is None else round(avail, 2), "ranking_factors": reasons, "risks": risks,
                         "estimated_cost_rm": staff * (hour_to - hour_from + 1) * 25 + 300})
        rows.sort(key=lambda r: -r["expected_signups"])
        best = rows[: max(1, min(top_k, 10))]
        features = [point(r["lat"], r["lng"], id=r["area_id"], kind="area", severity="HIGH" if i == 0 else "MEDIUM", score=round(r["expected_signups"] / max(0.1, best[0]["expected_signups"]), 2),
                          label=f"#{i + 1} {r['name']}: ~{r['expected_signups']:.0f} sign-ups", unit="sign-ups") for i, r in enumerate(best)]
        summary = (f"Top {len(best)} booth locations for {d:%a %d %b} {hour_from:02d}:00-{hour_to + 1:02d}:00 MYT with {staff} staff: "
                   + "; ".join(f"{r['name']} (~{r['expected_signups']:.0f} sign-ups)" for r in best) + ".")
        window = {"start": times(start_w), "end": times(end_w), "day_myt": d.isoformat()}
        predictions = []
        for r in best:
            lo, hi = r["signups_band"]
            conf, basis = _band_confidence(lo, r["expected_signups"], hi)
            predictions.append(_prediction("area", r["area_id"], r["name"], "pop-up booth sign-ups", window, r["expected_signups"], "sign-ups",
                                           None, None, [*r["ranking_factors"], *r["risks"]], conf, basis, r["cluster"]))
        data = {
            "summary": summary, "window": window, "predictions": predictions,
            "recommendations": best, "candidates_considered": len(rows),
            "ranking_rule": "areas ranked by predicted sign-ups from the booth model, fed with the footfall forecast for the window",
            "units": "sign-ups (synthetic proxy for interest, not revenue)", "geojson": collection(features),
            "limitations": LIMITATIONS + ["Sign-ups are a synthetic proxy learned from synthetic booth history; no revenue is forecast.",
                                          "The band reruns the booth model with the P10 and P90 footfall; it ignores the booth model's own error."],
        }
        return _envelope("rank_business_locations", data, ["footfall", "booth", "congestion"], end, [])
    finally:
        intel.close()
        ml.close()


def _booth_reason(feature: str, value: float, contribution: float, area_name: str) -> str:
    effect = "raises" if contribution > 0 else "lowers"
    text = {
        "area": f"{area_name}'s past booth results",
        "footfall_during": f"about {value:,.0f} visitors expected in the booth hours",
        "event_nearby": "an event nearby" if value else "no event nearby",
        "holiday": "a public holiday" if value else "not a public holiday",
        "weekend": "a weekend" if value else "a weekday",
        "staff": f"{value:.0f} staff",
        "start_hour": f"opening at {value:02.0f}:00",
        "hours": f"{value:.0f} hours open",
        "availability_pct": "network availability unknown" if np.isnan(value) else f"network availability {value:.2f}%",
    }[feature]
    return f"{text} ({effect} the estimate by {abs(contribution):.2f} in log terms)"


# ---------------------------------------------------------------- site failure risk

CHECKS = {
    "warnings_3d": "Check the KPI degradation warnings: radio, transmission and power alarms on site.",
    "alarms_3d": "Review the recent alarms with the vendor and clear the root cause.",
    "alarms_1d": "Review yesterday's alarms on the site.",
    "max_loss_1d": "Check transmission (packet loss): backhaul link, routers, microwave alignment.",
    "max_loss_3d": "Check transmission (packet loss) over the last days.",
    "max_latency_1d": "Check backhaul latency and congestion on the transport path.",
    "min_avail_7d": "Investigate the recent availability drops (cell resets, power).",
    "outages_30d": "Root-cause the repeated outages (power, hardware) before the next one.",
    "maintenance_next_day": "Planned maintenance tomorrow: confirm the plan and fallback.",
    "microwave": "Microwave backhaul: check link margin and rain fade.",
    "major_7d": "Follow up the major/critical alarms of the past week.",
    "mean_prb_7d": "High load: consider load balancing.",
}


def predict_site_failure_risk(cluster: str | None = None, site_ids: list[str] | None = None, lat: float | None = None, lng: float | None = None,
                              radius_km: float | None = None, limit: int = 10) -> dict[str, Any]:
    intel = _connect(paths.intel_db())
    try:
        end = F.data_end(intel)
        selected = None
        if cluster or site_ids or lat is not None:
            selected = [s["site_id"] for s in _select_sites(intel, site_ids=site_ids, cluster=cluster, lat=lat, lng=lng, radius_km=radius_km)]
        sites, days, feats, _label = F.failure_table(intel, selected)
        x = feats[:, -1, :]  # features at the end of the last day
        booster = models()["failure"]
        calib = models()["failure_calibration"]
        p = booster.predict(x)
        contrib = booster.predict(x, pred_contrib=True)[:, :-1]
        info = {r[0]: r for r in intel.execute("SELECT site_id, lat, lng, cluster, backhaul FROM site").fetchall()}
        rows = []
        for i in np.argsort(-p)[: max(1, min(limit, 100))]:
            sid = sites[i]
            level = "HIGH" if p[i] >= calib["threshold_high"] else "MEDIUM" if p[i] >= calib["threshold_medium"] else "LOW"
            top = [j for j in np.argsort(-contrib[i]) if contrib[i][j] > 0][:3]
            rows.append({
                "site_id": sid, "cluster": info[sid][3], "lat": info[sid][1], "lng": info[sid][2], "risk_score": round(float(p[i]), 4), "risk_level": level,
                "contributing_factors": [{"feature": F.FAILURE_FEATURES[j], "value": None if np.isnan(x[i][j]) else round(float(x[i][j]), 2),
                                          "contribution": round(float(contrib[i][j]), 3)} for j in top],
                "recommended_checks": [CHECKS[F.FAILURE_FEATURES[j]] for j in top] or ["No elevated factor; routine monitoring."],
            })
        horizon_start = end
        weather = _weather_exposure(intel, [r["site_id"] for r in rows], end)
        for r in rows:
            r["weather_exposure"] = weather.get(r["site_id"])
            if r["weather_exposure"] and r["weather_exposure"]["exposure"] == "elevated" and CHECKS["microwave"] not in r["recommended_checks"]:
                r["recommended_checks"].append(CHECKS["microwave"])
        fm = models()["metrics"]["failure"]["metrics"]
        horizon = {"start": times(horizon_start), "end": times(horizon_start + timedelta(hours=24)), "hours": 24}
        predictions = [_prediction(
            "site", r["site_id"], None, "total/partial outage starts in the next 24 h", horizon, r["risk_score"], "model score (0-1)",
            r["risk_score"], r["risk_level"],
            [f"{f['feature']}={f['value']} (+{f['contribution']})" for f in r["contributing_factors"]]
            + ([r["weather_exposure"]["note"]] if r["weather_exposure"] else []),
            "low", f"ranking model: synthetic test PR-AUC {fm['pr_auc']['model']} vs {fm['pr_auc']['baseline']} for a simple alarm heuristic "
            f"(base rate {fm['base_rate']:.2%}); not a calibrated probability",
            r["cluster"]) for r in rows]
        features = [point(r["lat"], r["lng"], id=r["site_id"], kind="site", severity=r["risk_level"], score=r["risk_score"],
                          label=f"{r['site_id']} {r['risk_level'].lower()} ({r['risk_score']:.2%})", unit="probability") for r in rows]
        summary = (f"Highest estimated outage risk in the next 24 h: {rows[0]['site_id']} ({rows[0]['risk_level'].lower()}, score {rows[0]['risk_score']:.2%}); "
                   f"{sum(r['risk_level'] == 'HIGH' for r in rows)} high and {sum(r['risk_level'] == 'MEDIUM' for r in rows)} medium among the {len(rows)} shown "
                   f"(of {len(sites)} sites).")
        data = {
            "summary": summary, "horizon": horizon, "predictions": predictions,
            "sites": rows, "sites_scored": len(sites),
            "risk_rule": "HIGH above the 99th percentile of the model's test scores, MEDIUM above the 95th; the score is the model's output, "
                         "a relative ranking more than a calibrated probability",
            "units": "model score (0-1)", "geojson": collection(features),
            "limitations": LIMITATIONS + ["Outage labels are synthetic; about 60% carry a synthetic warning sign, the rest are unpredictable by construction.",
                                          "Contributing factors are the model's own feature contributions (SHAP-style), not proof of cause.",
                                          "Weather exposure is context next to the score (microwave backhaul plus recent synthetic rain), not a model input; "
                                          "for a rain forecast use assess_weather_network_exposure (Weather ML)."],
        }
        return _envelope("predict_site_failure_risk", data, ["failure"], end, [])
    finally:
        intel.close()


def _weather_exposure(intel, site_ids: list[str], data_end: datetime) -> dict[str, dict[str, Any]]:
    """Recent rain at each site's cluster area (ml.duckdb rain_daily, synthetic) and its backhaul. Empty when ml.duckdb is missing."""
    if not site_ids or not paths.ml_db().exists():
        return {}
    last = (data_end - timedelta(hours=1) + F.MYT).date()
    sites = intel.execute("SELECT s.site_id, s.backhaul, a.area_id FROM site s LEFT JOIN area a ON lower(a.cluster) = lower(s.cluster) "
                          "WHERE s.site_id IN (SELECT unnest(?::VARCHAR[]))", [site_ids]).fetchall()
    with _connect(paths.ml_db()) as ml:
        rain: dict[str, list[float]] = {}
        for area_id, mm in ml.execute("SELECT area_id, rain_mm FROM rain_daily WHERE day_local > ? AND day_local <= ? ORDER BY area_id, day_local",
                                      [last - timedelta(days=7), last]).fetchall():
            rain.setdefault(area_id, []).append(mm)
    out = {}
    for sid, backhaul, area_id in sites:
        days = rain.get(area_id) or []
        if not days:
            continue
        rain_3d, heavy_7d = round(sum(days[-3:]), 1), sum(mm >= 20 for mm in days)
        microwave = backhaul == "Microwave"
        exposure = "elevated" if microwave and heavy_7d >= 1 else "low"
        out[sid] = {"exposure": exposure, "backhaul": backhaul, "rain_mm_last_3d": rain_3d, "heavy_rain_days_last_7d": int(heavy_7d),
                    "source": "ml.duckdb rain_daily (synthetic, cluster area)",
                    "note": f"weather: {backhaul.lower()} backhaul, {rain_3d} mm rain in 3 days, {heavy_7d} heavy-rain day(s) in 7 -> {exposure} exposure"}
    return out


# ---------------------------------------------------------------- anomalies

def detect_network_anomalies(start: str | None = None, end: str | None = None, cluster: str | None = None, site_ids: list[str] | None = None,
                             lat: float | None = None, lng: float | None = None, radius_km: float | None = None, limit: int = 20) -> dict[str, Any]:
    intel = _connect(paths.intel_db())
    try:
        data_end = F.data_end(intel)
        sites = _select_sites(intel, site_ids=site_ids, cluster=cluster, lat=lat, lng=lng, radius_km=radius_km)
        ids = [s["site_id"] for s in sites]
        if start:
            s = datetime.fromisoformat(start.replace("Z", "+00:00"))
            s = s - F.MYT if s.tzinfo is None else s.replace(tzinfo=None) - (s.utcoffset() or timedelta(0))
            e = datetime.fromisoformat(end.replace("Z", "+00:00")) if end else s + timedelta(hours=24)
            e = e - F.MYT if e.tzinfo is None else e.replace(tzinfo=None) - (e.utcoffset() or timedelta(0))
        else:
            e, s = data_end, data_end - timedelta(hours=24)
        if e > data_end:
            raise InputError("Anomaly detection looks at recorded data; the window must end by the end of the data.")
        cells = [r[0] for r in intel.execute("SELECT cell_name FROM cell WHERE site_id IN (SELECT unnest(?::VARCHAR[]))", [ids]).fetchall()]
        frame = F.anomaly_frame(intel, s, e, cells)
        model = models()["anomaly"]
        score = -model["forest"].score_samples(frame["x"]) if len(frame["x"]) else np.array([])
        flagged = np.flatnonzero(score >= model["threshold"])
        per_site: dict[str, dict[str, Any]] = {}
        for k in flagged:
            sid = frame["site_id"][k]
            cur = per_site.setdefault(sid, {"site_id": sid, "anomalous_cell_hours": 0, "max_score": 0.0, "worst": None, "cells": set()})
            cur["anomalous_cell_hours"] += 1
            cur["cells"].add(frame["cell_name"][k])
            if score[k] > cur["max_score"]:
                cur["max_score"] = float(score[k])
                ts = frame["ts_utc"][k].astype("datetime64[s]").astype(datetime)
                kpi = {c: (None if np.isnan(float(frame[c][k])) else round(float(frame[c][k]), 2)) for c in
                       ("prb_dl_pct", "dl_throughput_mbps", "packet_loss_pct", "latency_ms", "availability_pct", "active_users")}
                dev = dict(zip(F.ANOMALY_FEATURES, (round(float(v), 2) for v in frame["x"][k]), strict=True))
                cur["worst"] = {"cell_name": frame["cell_name"][k], "at": times(ts), "kpis": kpi, "deviation_from_usual": dev}
        site_index = {x["site_id"]: x for x in sites}
        rows = sorted(per_site.values(), key=lambda r: -r["max_score"])[: max(1, min(limit, 100))]
        for r in rows:
            r["cells"] = sorted(r["cells"])
            r["max_score"] = round(r["max_score"], 3)
            users = (r["worst"] or {}).get("kpis", {}).get("active_users")
            r["potential_impact"] = f"about {int(users)} active users on the worst cell in that hour" if users else "users unknown"
            sev = "HIGH" if r["max_score"] >= model["threshold"] * 1.15 else "MEDIUM"
            r["severity"] = sev
            r["lat"], r["lng"] = site_index[r["site_id"]]["lat"], site_index[r["site_id"]]["lng"]
        features = [point(r["lat"], r["lng"], id=r["site_id"], kind="site", severity=r["severity"], score=r["max_score"],
                          label=f"{r['site_id']}: {r['anomalous_cell_hours']} anomalous cell-hours", unit="anomaly score") for r in rows]
        summary = (f"{len(per_site)} of {len(ids)} sites had anomalous cell-hours between {iso_utc(s)} and {iso_utc(e)} UTC ({len(flagged)} cell-hours flagged)."
                   + (f" Most unusual: {rows[0]['site_id']} ({rows[0]['worst']['cell_name']})." if rows else ""))
        window = {"start": times(s), "end": times(e), "kind": "recorded"}
        am, amb = (models()["metrics"]["anomaly"]["metrics"][k] for k in ("model", "baseline"))
        predictions = []
        for r in rows:
            w = r["worst"]
            big = sorted(w["deviation_from_usual"].items(), key=lambda kv: -abs(kv[1]))[:3]
            predictions.append(_prediction(
                "site", r["site_id"], None, "anomalous network behaviour", window, r["max_score"], "anomaly score", r["max_score"], r["severity"],
                [f"{r['anomalous_cell_hours']} anomalous cell-hours on {len(r['cells'])} cell(s)", f"worst: {w['cell_name']} at {w['at']['myt']}",
                 "largest deviations from usual: " + ", ".join(f"{k} {v:+}" for k, v in big), f"impact: {r['potential_impact']}"],
                "medium" if r["severity"] == "HIGH" else "low",
                f"Isolation Forest, synthetic test precision {am['precision']} / recall {am['recall']} (fixed thresholds: "
                f"{amb['precision']} / {amb['recall']}); not a failure probability",
                site_index[r["site_id"]]["cluster"]))
        data = {
            "summary": summary, "window": window, "predictions": predictions, "sites": rows, "cell_hours_scored": int(len(score)),
            "threshold": round(model["threshold"], 3),
            "method": "Isolation Forest over each cell-hour's deviation from that cell's usual value for the same hour of the week",
            "units": "anomaly score (higher = more unusual)", "geojson": collection(features),
            "limitations": LIMITATIONS + ["An anomaly score is how unusual an hour looks, not a probability of equipment failure.",
                                          "Planned maintenance and big events also look unusual; check the incident records before acting."],
        }
        return _envelope("detect_network_anomalies", data, ["anomaly"], data_end, [])
    finally:
        intel.close()


# ---------------------------------------------------------------- business demand signals (for the Opportunity Graph)

DEMAND_SCHEMA = "demand-signals-v1"
AREA_SITE_RADIUS_KM = 2.0
SIGNALS = {
    "demand_exceeds_capacity": "Demand is high and nearby cells are forecast to congest: investigate temporary capacity "
                               "(load balancing, a cell-on-wheels) before the window, then sell.",
    "reliability_risk": "A nearby site ranks high for outage risk: run the preventive checks before any campaign here.",
    "demand_with_headroom": "Demand is high and the network has headroom: a good candidate for a pop-up booth or event package.",
    "structural_congestion": "Cells congest without unusual demand: investigate capacity planning for resident load.",
    "steady": "No strong signal in this window: monitor.",
}


def _pct_rank(values: list[float]) -> list[float]:
    """Percentile rank in [0, 1] (ties share the mean rank); one value ranks 0.5."""
    arr = np.asarray(values, dtype=float)
    if len(arr) == 1:
        return [0.5]
    order = arr.argsort(kind="stable")
    ranks = np.empty(len(arr))
    ranks[order] = np.arange(len(arr))
    for v in np.unique(arr):
        ranks[arr == v] = ranks[arr == v].mean()
    return list(ranks / (len(arr) - 1))


def get_business_demand_signals(day: str | None = None, hour_from: int = 12, hour_to: int = 22, cluster: str | None = None,
                                area_ids: list[str] | None = None, limit: int = 10) -> dict[str, Any]:
    """Per area: demand (footfall + booth models), capacity pressure (congestion model) and reliability (failure model), combined into
    one signal and an investigation priority. Every area is scored against all 38 so scores do not depend on the filter."""
    intel, ml = _connect(paths.intel_db()), _connect(paths.ml_db())
    try:
        ff = F.load_footfall(ml, intel)
        end = F.data_end(intel)
        start_w, end_w, d = _window(day, hour_from, hour_to, 5, end)
        if start_w < end:
            raise InputError("Demand signals look ahead: choose a window after the end of the data "
                             f"({(end + F.MYT):%Y-%m-%d %H:%M} MYT), up to 7 days.")
        areas = _areas(intel)
        wanted = {a["area_id"] for a in _areas(intel, area_ids, cluster)}
        index = {a["area_id"]: i for i, a in enumerate(ff.areas)}
        n_hours = int((end_w - start_w).total_seconds() // 3600)
        t0 = int((start_w - ff.start_utc).total_seconds() // 3600)

        # sites near each area (fallback: the 3 nearest in its cluster)
        sites = intel.execute("SELECT site_id, lat, lng, cluster FROM site ORDER BY site_id").fetchall()
        near: dict[str, list[str]] = {}
        for a in areas:
            dist = sorted((F.haversine_km(a["lat"], a["lng"], la, lo), sid) for sid, la, lo, cl in sites if cl.lower() == a["cluster"].lower())
            near[a["area_id"]] = [sid for km, sid in dist if km <= AREA_SITE_RADIUS_KM] or [sid for _km, sid in dist[:3]]

        # capacity: one congestion forecast over every nearby cell
        all_sites = sorted({s for ids in near.values() for s in ids})
        net, cpred, ct0, ct1 = _congestion(intel, all_sites, start_w, end_w)
        # each cell's usual peak in the same window over the last 3 weeks (median, so one past event does not set "usual")
        usual_peak = np.array([np.median([net.prb[j, ct0 - k * F.WEEK: ct1 - k * F.WEEK].max() for k in range(1, 4)
                                          if ct1 - k * F.WEEK <= net.hours]) for j in range(len(net.cells))])
        cells_by_site: dict[str, list[int]] = {}
        for i, c in enumerate(net.cells):
            cells_by_site.setdefault(c["site_id"], []).append(i)

        # reliability: the failure model's latest 24-h scores
        fsites, _days, ffeats, _label = F.failure_table(intel, all_sites)
        fscore = dict(zip(fsites, models()["failure"].predict(ffeats[:, -1, :]), strict=True))
        calib = models()["failure_calibration"]

        booster = models()["booth"]
        weekend, holiday = float(d.weekday() >= 5), float(F.calendar_features(start_w, 1)["holiday"][0])
        booth_hours = min(8, n_hours)  # the booth model saw 5-8 hour booths; use the last 8 hours of the window
        booth_from = hour_to + 1 - booth_hours

        rows = []
        for a in areas:
            i = index[a["area_id"]]
            p = _footfall_forecast(ff, i, start_w, end_w)
            history = [ff.visitors[i, t0 - k * F.WEEK: t0 - k * F.WEEK + n_hours].sum() for k in range(1, 5)
                       if t0 - k * F.WEEK + n_hours <= ff.hours]
            typical = float(np.median(history)) if history else None
            p50 = float(p["p50"].sum())
            uplift = None if not typical else p50 / typical - 1
            event = float(p["event_attendance"].max() > 0)
            ids = near[a["area_id"]]
            avail = intel.execute("SELECT avg(availability_pct) FROM kpi_hourly WHERE site_id IN (SELECT unnest(?::VARCHAR[])) AND ts_utc >= ?",
                                  [ids, end - timedelta(days=14)]).fetchone()[0]
            x = np.array([[i, p["p50"][-booth_hours:].sum(), event, holiday, weekend, 3, booth_from, booth_hours, np.nan if avail is None else avail]])
            signups = float(booster.predict(x)[0])
            cidx = [j for sid in ids for j in cells_by_site.get(sid, [])]
            peaks = cpred[cidx].max(axis=1) if cidx else np.array([0.0])
            hot_cell_hours = int((cpred[cidx] >= 85).sum()) if cidx else 0
            hot_share = float((peaks >= 85).mean())
            hour_share = hot_cell_hours / max(1, len(cidx) * n_hours)
            surge = float((peaks - usual_peak[cidx]).max()) if cidx else 0.0
            surge_cell = net.cells[cidx[int(np.argmax(peaks - usual_peak[cidx]))]]["cell_name"] if cidx else None
            pressure = round(0.5 * float(np.clip(hour_share / 0.2, 0, 1)) + 0.5 * float(np.clip((surge - 10) / 15, 0, 1)), 3)
            worst_site = max(ids, key=lambda s: fscore.get(s, 0.0))
            worst_score = float(fscore.get(worst_site, 0.0))
            rel_level = "HIGH" if worst_score >= calib["threshold_high"] else "MEDIUM" if worst_score >= calib["threshold_medium"] else "LOW"
            reliability = {"HIGH": 1.0, "MEDIUM": 0.6}.get(rel_level, round(0.5 * min(1.0, worst_score / calib["threshold_medium"]), 3))
            events = [ev for ev in ff.events if ev[4] < end_w + timedelta(hours=1) and ev[5] > start_w - timedelta(hours=1)
                      and F.haversine_km(a["lat"], a["lng"], ev[2], ev[3]) <= F.event_radius_km(ev[6])]
            rows.append({"area": a, "p": p, "p50": p50, "typical": typical, "uplift": uplift, "signups": signups, "event": event, "events": events,
                         "sites": ids, "cells": len(cidx), "peak_prb": float(peaks.max()), "hot_cell_hours": hot_cell_hours, "hot_share": hot_share,
                         "hour_share": hour_share, "surge": surge, "surge_cell": surge_cell,
                         "pressure": pressure, "worst_site": worst_site, "worst_score": worst_score, "rel_level": rel_level, "reliability": reliability,
                         "avail": avail})

        # demand index: national percentile ranks of volume, uplift and expected sign-ups
        for r in rows:
            r["event_people"] = sum(ev[6] for ev in r["events"])
        vol, upl, sig, evt = (_pct_rank([r[k] if r[k] is not None else 0.0 for r in rows]) for k in ("p50", "uplift", "signups", "event_people"))
        window = {"start": times(start_w), "end": times(end_w), "day_myt": d.isoformat(), "kind": "forecast"}
        signals, predictions = [], []
        for r, v, u, s, ev_rank in zip(rows, vol, upl, sig, evt, strict=True):
            demand = round(0.35 * v + 0.25 * u + 0.2 * s + 0.2 * ev_rank, 3)
            if demand >= 0.7 and r["pressure"] >= 0.6:
                kind = "demand_exceeds_capacity"
            elif r["rel_level"] == "HIGH":
                kind = "reliability_risk"
            elif demand >= 0.7:
                kind = "demand_with_headroom"
            elif r["pressure"] >= 0.6:
                kind = "structural_congestion"
            else:
                kind = "steady"
            flags = [f for f, on in (("reliability_risk", r["rel_level"] == "HIGH"), ("capacity_pressure", r["pressure"] >= 0.6),
                                     ("event_in_reach", bool(r["events"]))) if on and f != kind]
            priority = round(0.45 * demand + 0.35 * r["pressure"] + 0.2 * r["reliability"], 3)
            a, p = r["area"], r["p"]
            conf, basis = _band_confidence(float(p["p10"].sum()), r["p50"], float(p["p90"].sum()))
            if conf == "high":  # the signal also rests on assumed weights and the low-confidence failure model
                conf = "medium"
            basis = f"capped at medium: rule weights are assumptions and outage risk is a ranking; footfall {basis}"
            evidence = [f"footfall P50 {r['p50']:,.0f} visitors (P10-P90 {p['p10'].sum():,.0f}-{p['p90'].sum():,.0f})"
                        + (f", {r['uplift']:+.1%} vs usual (median of the same window over the last 4 weeks)" if r["uplift"] is not None else ""),
                        f"booth model: ~{r['signups']:.1f} sign-ups for a 3-staff booth {booth_from:02d}:00-{hour_to + 1:02d}:00",
                        f"congestion model: {r['hot_cell_hours']} of {r['cells'] * n_hours} cell-hours at or above 85% PRB ({r['hour_share']:.0%}); "
                        + (f"largest surge {r['surge']:+.0f} points above its usual peak on {r['surge_cell']}" if r["surge"] > 0 else "no cell above its usual peak"),
                        f"failure model: {r['worst_site']} {r['rel_level'].lower()} outage risk (score {r['worst_score']:.2%})"]
            evidence += [f"{ev[0]} ({ev[1].lower()}, {ev[6]:,} people) in reach" for ev in r["events"]]
            signal = {
                "schema": DEMAND_SCHEMA, "area_id": a["area_id"], "name": a["name"], "cluster": a["cluster"], "lat": a["lat"], "lng": a["lng"],
                "window": window, "signal": kind, "secondary_flags": flags, "recommended_investigation": SIGNALS[kind],
                "investigation_priority": priority, "demand_index": demand, "capacity_pressure": r["pressure"], "reliability_risk": r["reliability"],
                "indicators": {
                    "footfall_p50": round(r["p50"]), "footfall_p10": round(float(p["p10"].sum())), "footfall_p90": round(float(p["p90"].sum())),
                    "footfall_typical": None if r["typical"] is None else round(r["typical"]),
                    "footfall_uplift_pct": None if r["uplift"] is None else round(100 * r["uplift"], 1),
                    "expected_booth_signups": round(r["signups"], 1), "event_attendance_in_reach": int(r["event_people"]),
                    "forecast_peak_prb_pct": round(r["peak_prb"], 1), "cells_forecast_congested_share": round(r["hot_share"], 3),
                    "congested_cell_hours": r["hot_cell_hours"], "congested_cell_hours_share": round(r["hour_share"], 3),
                    "prb_surge_vs_usual_pts": round(r["surge"], 1), "surge_cell": r["surge_cell"], "network_availability_14d_pct": None if r["avail"] is None else round(r["avail"], 2),
                    "worst_site_outage_score": round(r["worst_score"], 4), "worst_site_outage_level": r["rel_level"],
                },
                "site_ids": r["sites"], "worst_site_id": r["worst_site"], "events": [ev[0] for ev in r["events"]],
                "evidence": evidence, "confidence": conf, "confidence_basis": basis, "synthetic": True,
            }
            if a["area_id"] in wanted:
                signals.append(signal)
                predictions.append(_prediction("area", a["area_id"], a["name"], f"business demand signal: {kind}", window, priority, "priority (0-1)",
                                               priority, "HIGH" if priority >= 0.6 else "MEDIUM" if priority >= 0.4 else "LOW", evidence, conf, basis, a["cluster"]))
        # actionable signals first, then by priority
        order = sorted(range(len(signals)), key=lambda k: (signals[k]["signal"] == "steady", -signals[k]["investigation_priority"], signals[k]["area_id"]))
        signals = [signals[k] for k in order][: max(1, min(limit, 50))]
        predictions = [predictions[k] for k in order][: len(signals)]
        counts = {k: sum(1 for s in signals if s["signal"] == k) for k in SIGNALS}
        sev = {"demand_exceeds_capacity": "HIGH", "reliability_risk": "HIGH", "demand_with_headroom": "MEDIUM", "structural_congestion": "MEDIUM", "steady": "LOW"}
        features = [point(s["lat"], s["lng"], id=s["area_id"], kind="area", severity=sev[s["signal"]], score=s["investigation_priority"],
                          label=f"#{i + 1} {s['name']}: {s['signal'].replace('_', ' ')}", unit="priority") for i, s in enumerate(signals)]
        shown_ids = {s["area_id"] for s in signals}
        shown_events = {ev[0]: ev for r in rows if r["area"]["area_id"] in shown_ids for ev in r["events"]}
        features += [point(ev[2], ev[3], id=ev[0], kind="event", label=f"{ev[1].title()} ({ev[6]:,} people)") for ev in shown_events.values()]
        top = signals[0]
        ti = top["indicators"]
        summary = (f"Top area to investigate {d:%a %d %b} {hour_from:02d}:00-{hour_to + 1:02d}:00 MYT: {top['name']} ({top['cluster']}), "
                   f"{top['signal'].replace('_', ' ')} (priority {top['investigation_priority']:.2f}): footfall ~{ti['footfall_p50']:,}"
                   + (f" ({ti['footfall_uplift_pct']:+.1f}% vs usual)" if ti["footfall_uplift_pct"] is not None else "")
                   + f", cell surge {ti['prb_surge_vs_usual_pts']:+.0f} PRB points, {ti['worst_site_outage_level'].lower()} outage risk at {top['worst_site_id']}"
                   + (f", {ti['event_attendance_in_reach']:,} event attendees in reach." if ti["event_attendance_in_reach"] else ".")
                   + f" {sum(v for k, v in counts.items() if k != 'steady')} of {len(signals)} areas shown carry an actionable signal.")
        data = {
            "summary": summary, "schema": DEMAND_SCHEMA, "window": window, "signals": signals, "predictions": predictions, "signal_counts": counts,
            "areas_scored": len(rows), "units": "indices 0-1 (percentile-based demand, capacity pressure, reliability risk)",
            "method": {
                "demand_index": "0.35 x percentile of forecast footfall + 0.25 x percentile of uplift vs the same window in the last 4 weeks (median) "
                                "+ 0.2 x percentile of booth sign-ups + 0.2 x percentile of event attendance in reach (all 38 areas)",
                "capacity_pressure": "0.5 x clip(share of nearby cell-hours forecast >= 85% PRB / 0.2) + 0.5 x clip((largest rise of a cell's "
                                     "forecast peak over its usual peak (median of the same window in the last 3 weeks) - 10) / 15 points)",
                "reliability_risk": "failure-model level of the riskiest nearby site: HIGH 1.0, MEDIUM 0.6, else up to 0.5 by score",
                "investigation_priority": "0.45 x demand + 0.35 x capacity pressure + 0.2 x reliability risk",
                "signal": "demand >= 0.7 and pressure >= 0.6: demand_exceeds_capacity; else reliability HIGH: reliability_risk; else demand >= 0.7: "
                          "demand_with_headroom; else pressure >= 0.6: structural_congestion; else steady. Other conditions that hold are secondary_flags.",
                "nearby_sites": f"sites of the area's cluster within {AREA_SITE_RADIUS_KM} km (else the 3 nearest)",
            },
            "geojson": collection(features),
            "limitations": LIMITATIONS + ["The indices combine model outputs with stated rules; weights are assumptions, not learned.",
                                          "Sign-ups are a synthetic proxy for interest, not revenue; footfall is aggregate only.",
                                          "Outage risk is the latest 24-h score (as of the data end), reused for later days in the window."],
        }
        return _envelope("get_business_demand_signals", data, ["footfall", "booth", "congestion", "failure"], end, [])
    finally:
        intel.close()
        ml.close()


# ---------------------------------------------------------------- metrics and status

def get_ml_model_metrics(model: str | None = None) -> dict[str, Any]:
    m = models()
    if model and model not in MODELS:
        raise InputError(f"model must be one of {', '.join(MODELS)}")
    chosen = {k: v for k, v in m["metrics"].items() if not model or k == model}
    data = {"summary": "Evaluation on held-out later data (chronological split), each model against a simple baseline. Synthetic benchmarks.",
            "models": chosen, "geojson": collection([]), "limitations": LIMITATIONS}
    with _connect(paths.intel_db()) as intel:
        end = F.data_end(intel)
    return _envelope("get_ml_model_metrics", data, list(chosen), end, [])


def get_ml_model_status() -> dict[str, Any]:
    d = paths.models_dir()
    status: dict[str, Any] = {"models_dir": str(d), "intel_db": str(paths.intel_db()), "ml_db": str(paths.ml_db()),
                              "intel_db_present": paths.intel_db().exists(), "ml_db_present": paths.ml_db().exists()}
    try:
        m = models()
        status.update({"ready": True, "manifest": m["manifest"], "loaded": list(MODELS)})
    except (NotTrainedError, OSError, ValueError) as exc:
        status.update({"ready": False, "error": str(exc)})
    end = None
    if status["intel_db_present"]:
        with _connect(paths.intel_db()) as intel:
            end = F.data_end(intel)
    summary = (f"{len(MODELS)} models ready (version {status['manifest']['model_version']}, trained {status['manifest']['trained_at_utc']})."
               if status.get("ready") else f"Not ready: {status.get('error')}")
    data = {"summary": summary, **status, "geojson": collection([]), "limitations": LIMITATIONS}
    if status.get("ready") and end:
        return _envelope("get_ml_model_status", data, [], end, [])
    stamp = iso_utc(end) if end else ""
    return Envelope[dict[str, Any]](synthetic=True, as_of=stamp or "", data=data, evidence=[], warnings=[summary]).model_dump(mode="json")
