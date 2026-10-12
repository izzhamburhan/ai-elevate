"""Build ml.duckdb: synthetic aggregate footfall, rain and booth outcomes, joined to intel.duckdb's areas and events.

- holiday: Malaysia's 2026 federal public holidays (real calendar, lunar dates tentative; see calendar.py)
- rain_daily: daily rain per area (synthetic, a seasonal wet/dry pattern; not Weather ML)
- footfall_hourly: visitors per area and hour for 180 days to the end of the network window. Aggregate counts only;
  no person is modelled. Driven by hour/weekday shape, holidays, payday, events near the area, rain and noise.
- booth_outcome: past temporary booth-days (weekends and holidays) with their sign-ups (a synthetic proxy, not revenue),
  driven by footfall during the booth hours, nearby events, rain, staff, the area's appetite and network availability.

Same intel.duckdb + same SEED = the same file. Run: `uv run python -m mlpredict_mcp.data`.
"""

from __future__ import annotations

import argparse
import math
import os
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import duckdb
import numpy as np

from mlpredict_mcp import paths
from mlpredict_mcp.calendar import HOLIDAYS_2026, is_holiday
from mlpredict_mcp.features import event_radius_km

GENERATOR_VERSION = "ml-v1"
SEED = 42
FOOTFALL_DAYS = 180
BOOTHS_PER_DAY = 12
MYT = timedelta(hours=8)

# visitors per hour as a share of the area's peak hour (local time)
_WEEKDAY = [0.02, 0.01, 0.01, 0.01, 0.01, 0.02, 0.04, 0.08, 0.15, 0.25, 0.4, 0.55, 0.7, 0.68, 0.6, 0.58, 0.62, 0.7, 0.82, 0.9, 0.85, 0.65, 0.35, 0.08]
_WEEKEND = [0.03, 0.02, 0.01, 0.01, 0.01, 0.02, 0.03, 0.06, 0.12, 0.25, 0.5, 0.72, 0.88, 0.95, 1.0, 0.98, 0.95, 0.92, 0.9, 0.88, 0.8, 0.6, 0.32, 0.08]
EVENT_SPILL = {"SALE": 0.55, "FESTIVAL": 0.18, "EXPO": 0.2, "CONCERT": 0.1, "MATCH": 0.08}


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def _rain(rng: np.random.Generator, areas: list[dict], days: list[date]) -> dict[tuple[str, date], float]:
    """Daily rain in mm: wetter Oct-Dec and on the east coast, gamma-distributed, many dry days."""
    out = {}
    for a in areas:
        east = a["lng"] > 102.5
        for d in days:
            wet = 0.45 + (0.2 if d.month >= 10 else 0.0) + (0.1 if east else 0.0)
            out[(a["area_id"], d)] = round(float(rng.gamma(1.4, 9.0)) if rng.random() < wet else 0.0, 1)
    return out


def event_visitors(events: list[tuple], area: dict, ts_local: datetime) -> float:
    """Extra visitors in the area in this hour from events whose crowd reaches it (event_radius_km), spread over the event hours +-1 h."""
    extra = 0.0
    for _eid, kind, lat, lng, start, end, attendance, _area_id in events:
        s, e = start + MYT, end + MYT
        if not (s - timedelta(hours=1) <= ts_local < e + timedelta(hours=1)):
            continue
        dist = haversine_km(area["lat"], area["lng"], lat, lng)
        radius = event_radius_km(attendance)
        if dist > radius:
            continue
        hours = max(1.0, (e - s).total_seconds() / 3600 + 2)
        extra += attendance * EVENT_SPILL.get(kind, 0.1) * (1 - dist / (radius + 0.5)) / hours
    return extra


def build(intel: Path, out: Path, seed: int = SEED) -> dict[str, int]:
    rng = np.random.default_rng(seed)
    con = duckdb.connect(str(intel), read_only=True)
    try:
        areas = [dict(zip(("area_id", "name", "cluster", "lat", "lng"), r, strict=True))
                 for r in con.execute("SELECT area_id, name, cluster, lat, lng FROM area ORDER BY area_id").fetchall()]
        events = con.execute("SELECT event_id, kind, lat, lng, start_utc, end_utc, attendance, area_id FROM event ORDER BY start_utc").fetchall()
        data_end = con.execute("SELECT max(ts_utc) FROM kpi_hourly").fetchone()[0] + timedelta(hours=1)
        kpi_start = con.execute("SELECT min(ts_utc) FROM kpi_hourly").fetchone()[0]
        # hourly availability of the cells within 1.5 km of each area, for the booth outcomes
        avail_rows = []
        for a in areas:
            sites = [s for s, lat, lng in con.execute("SELECT site_id, lat, lng FROM site").fetchall() if haversine_km(a["lat"], a["lng"], lat, lng) <= 1.5]
            if sites:
                avail_rows += [(a["area_id"], ts, v) for ts, v in con.execute(
                    "SELECT ts_utc, avg(availability_pct) FROM kpi_hourly WHERE site_id IN (SELECT unnest(?::VARCHAR[])) GROUP BY 1", [sites]
                ).fetchall()]
        intel_meta = dict(con.execute("SELECT key, value FROM meta").fetchall())
    finally:
        con.close()
    availability = {(a, ts): v for a, ts, v in avail_rows}

    end_local = data_end + MYT
    start_local = end_local - timedelta(days=FOOTFALL_DAYS)
    days = [(start_local + timedelta(days=i)).date() for i in range(FOOTFALL_DAYS)]
    rain = _rain(rng, areas, days)

    # area traits: size (peak visitors per hour) and appetite for the booth offer (hidden; learnable from history)
    traits = {a["area_id"]: (float(rng.uniform(1500, 6000)), float(rng.uniform(0.7, 1.3))) for a in areas}
    by_area_events: dict[str, list[tuple]] = {
        a["area_id"]: [e for e in events if haversine_km(a["lat"], a["lng"], e[2], e[3]) <= event_radius_km(e[6])] for a in areas
    }

    foot_area, foot_ts, foot_vis, foot_event = [], [], [], []
    footfall: dict[tuple[str, datetime], float] = {}
    for a in areas:
        peak, _appetite = traits[a["area_id"]]
        trend_rate = rng.uniform(-0.02, 0.05) / FOOTFALL_DAYS
        for di, d in enumerate(days):
            weekendish = d.weekday() >= 5 or is_holiday(d)
            shape = _WEEKEND if weekendish else _WEEKDAY
            day_factor = (1.12 if is_holiday(d) else 1.0) * (1.08 if d.day >= 25 else 1.0) * (1 + trend_rate * di)
            wet = rain[(a["area_id"], d)]
            day_factor *= 1.05 if wet >= 20 else 1.0  # heavy rain pushes people indoors (malls)
            noise = np.exp(rng.normal(0, 0.08, 24))
            for h in range(24):
                ts_local = datetime.combine(d, datetime.min.time()) + timedelta(hours=h)
                extra = event_visitors(by_area_events[a["area_id"]], a, ts_local)
                visitors = max(0.0, peak * shape[h] * day_factor * noise[h] + extra * float(np.exp(rng.normal(0, 0.1))))
                ts_utc = ts_local - MYT
                foot_area.append(a["area_id"])
                foot_ts.append(np.datetime64(ts_utc, "s"))
                foot_vis.append(round(visitors))
                foot_event.append(round(extra))
                footfall[(a["area_id"], ts_utc)] = visitors

    booths = []
    booth_days = [d for d in days if d.weekday() >= 5 or is_holiday(d)]
    n = 0
    for d in booth_days:
        for idx in sorted(rng.choice(len(areas), size=min(BOOTHS_PER_DAY, len(areas)), replace=False).tolist()):
            a = areas[idx]
            start_h = int(rng.choice([10, 12, 14, 16]))
            hours = int(rng.choice([5, 6, 8]))
            staff = int(rng.integers(2, 5))
            stamps = [datetime.combine(d, datetime.min.time()) + timedelta(hours=start_h + k) - MYT for k in range(hours)]
            foot = sum(footfall[(a["area_id"], ts)] for ts in stamps)
            event_near = any(event_visitors(by_area_events[a["area_id"]], a, ts + MYT) > 0 for ts in stamps)
            avails = [availability[(a["area_id"], ts)] for ts in stamps if (a["area_id"], ts) in availability]
            avail = float(np.mean(avails)) if avails else None
            appetite = traits[a["area_id"]][1]
            lam = (0.0011 * foot**0.92 * (1.25 if event_near else 1.0) * (0.85 if rain[(a["area_id"], d)] >= 20 else 1.0)
                   * ((avail if avail is not None else 99.9) / 100) ** 4 * (0.85 + 0.075 * staff) * appetite)
            n += 1
            booths.append({
                "booth_id": f"BOOTH-{n:05d}", "area_id": a["area_id"], "day_local": d, "start_hour_myt": start_h, "hours": hours, "staff": staff,
                "footfall_during": round(foot), "event_nearby": event_near, "rain_mm": rain[(a["area_id"], d)],
                "network_availability_pct": None if avail is None else round(avail, 2), "signups": int(rng.poisson(lam)),
                "cost_rm": staff * hours * 25 + 300,
            })

    tmp = out.with_suffix(".tmp.duckdb")
    tmp.unlink(missing_ok=True)
    db = duckdb.connect(str(tmp))
    try:
        footfall_hourly = {  # noqa: F841 - read by DuckDB below
            "area_id": np.array(foot_area, dtype=object), "ts_utc": np.array(foot_ts), "visitors": np.array(foot_vis, dtype=np.int32),
            "event_visitors": np.array(foot_event, dtype=np.int32),
        }
        db.execute("CREATE TABLE footfall_hourly AS SELECT * FROM footfall_hourly")
        db.execute("ALTER TABLE footfall_hourly ALTER ts_utc TYPE TIMESTAMP")
        db.execute("CREATE TABLE rain_daily (area_id VARCHAR, day_local DATE, rain_mm DOUBLE)")
        db.executemany("INSERT INTO rain_daily VALUES (?, ?, ?)", [(a, d, v) for (a, d), v in sorted(rain.items())])
        db.execute("CREATE TABLE holiday (day DATE, name VARCHAR, tentative BOOLEAN)")
        db.executemany("INSERT INTO holiday VALUES (?, ?, ?)", HOLIDAYS_2026)
        cols = list(booths[0])
        booth_outcome = {c: np.array([b[c] for b in booths], dtype=object) for c in cols}  # noqa: F841 - read by DuckDB
        db.execute("CREATE TABLE booth_outcome AS SELECT * FROM booth_outcome")
        db.execute("ALTER TABLE booth_outcome ALTER day_local TYPE DATE")
        meta = {
            "generator_version": GENERATOR_VERSION, "seed": str(seed), "intel_generator_version": intel_meta.get("generator_version", ""),
            "footfall_start_utc": (start_local - MYT).isoformat(), "footfall_end_utc": data_end.isoformat(), "kpi_start_utc": kpi_start.isoformat(),
            "synthetic": "true", "built_at_utc": datetime.now(UTC).isoformat(timespec="seconds"),
        }
        db.execute("CREATE TABLE meta (key VARCHAR PRIMARY KEY, value VARCHAR)")
        db.executemany("INSERT INTO meta VALUES (?, ?)", sorted(meta.items()))
        counts = {t: db.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in ("footfall_hourly", "rain_daily", "holiday", "booth_outcome")}
    finally:
        db.close()
    os.replace(tmp, out)
    return counts


def _meta(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    try:
        con = duckdb.connect(str(path), read_only=True)
        try:
            return dict(con.execute("SELECT key, value FROM meta").fetchall())
        finally:
            con.close()
    except duckdb.Error:
        return {}


def _fresh(out: Path, intel: Path) -> bool:
    mine, theirs = _meta(out), _meta(intel)
    return bool(mine) and mine.get("generator_version") == GENERATOR_VERSION and mine.get("intel_generator_version") == theirs.get("generator_version")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="mlpredict-data", description=__doc__)
    parser.add_argument("--intel-db", type=Path, default=paths.intel_db())
    parser.add_argument("--out", type=Path, default=paths.ml_db())
    parser.add_argument("--seed", type=int, default=SEED)
    parser.add_argument("--if-stale", action="store_true", help="only build when missing, from an older generator or older intel data")
    args = parser.parse_args(argv)
    if args.if_stale and _fresh(args.out, args.intel_db):
        return
    if not args.intel_db.exists():
        raise SystemExit(f"intel.duckdb not found at {args.intel_db}; build it first: uv run python -m netintel_mcp.seed")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    counts = build(args.intel_db, args.out, args.seed)
    print(f"wrote {args.out}: " + ", ".join(f"{k}={v}" for k, v in counts.items()))


if __name__ == "__main__":
    main()
