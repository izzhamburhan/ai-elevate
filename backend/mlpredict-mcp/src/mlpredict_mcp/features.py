"""Feature building shared by training and inference, so a prediction sees exactly the inputs the model was trained on.

Time is an hour index from a start (UTC). Network data: intel.duckdb (hourly KPIs, events, alarms, outages).
Footfall: ml.duckdb. Everything here is read-only.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from functools import lru_cache

import duckdb
import numpy as np

from mlpredict_mcp.calendar import is_holiday

MYT = timedelta(hours=8)
WEEK = 168
FORECAST_HORIZON_H = 168  # direct forecasts reach one week past the data: the weekly lag is still known


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(a))


@lru_cache(maxsize=256)
def calendar_features(start_utc: datetime, n_hours: int) -> dict[str, np.ndarray]:
    """hour (MYT), day of week, weekend, public holiday, payday (day >= 25) for each hour (cached: the same span repeats per cell)."""
    local = [start_utc + MYT + timedelta(hours=i) for i in range(n_hours)]
    return {
        "hour": np.array([t.hour for t in local], dtype=np.int16),
        "dow": np.array([t.weekday() for t in local], dtype=np.int16),
        "weekend": np.array([t.weekday() >= 5 for t in local], dtype=np.int8),
        "holiday": np.array([is_holiday(t.date()) for t in local], dtype=np.int8),
        "payday": np.array([t.day >= 25 for t in local], dtype=np.int8),
    }


def event_radius_km(attendance: float) -> float:
    """How far an event's crowd spreads into nearby shopping areas: 2 km, plus 1 km per 10,000 people."""
    return 2.0 + attendance / 10000


def event_attendance(events: list[tuple], lat: float, lng: float, start_utc: datetime, n_hours: int, radius_km: float | None = 2.0,
                     kinds: set[str] | None = None) -> np.ndarray:
    """Attendance of the events within radius_km (None: each event's own crowd radius) that are on, from 1 h before to 1 h after."""
    out = np.zeros(n_hours, dtype=np.float32)
    for _eid, kind, elat, elng, s, e, attendance in events:
        if kinds is not None and kind not in kinds:
            continue
        if haversine_km(lat, lng, elat, elng) > (event_radius_km(attendance) if radius_km is None else radius_km):
            continue
        i0 = max(0, int((s - timedelta(hours=1) - start_utc).total_seconds() // 3600))
        i1 = min(n_hours, int(math.ceil((e + timedelta(hours=1) - start_utc).total_seconds() / 3600)))
        if i0 < i1:
            out[i0:i1] += attendance
    return out


def load_events(intel: duckdb.DuckDBPyConnection) -> list[tuple]:
    return intel.execute("SELECT event_id, kind, lat, lng, start_utc, end_utc, attendance FROM event ORDER BY start_utc").fetchall()


def data_end(intel: duckdb.DuckDBPyConnection) -> datetime:
    return intel.execute("SELECT max(ts_utc) FROM kpi_hourly").fetchone()[0] + timedelta(hours=1)


# ---------------------------------------------------------------- footfall

FOOTFALL_FEATURES = ["area", "hour", "dow", "weekend", "holiday", "payday", "event_attendance", "sale_attendance", "lag_168", "lag_336"]


@dataclass
class Footfall:
    areas: list[dict]
    start_utc: datetime  # hour index 0
    visitors: np.ndarray  # (areas, hours) history
    events: list[tuple]

    @property
    def hours(self) -> int:
        return self.visitors.shape[1]

    def matrix(self, area_idx: int, t0: int, t1: int) -> np.ndarray:
        """Feature rows for hours [t0, t1) of one area; t1 may run up to a week past the history."""
        n = t1 - t0
        start = self.start_utc + timedelta(hours=t0)
        cal = calendar_features(start, n)
        a = self.areas[area_idx]
        ev = event_attendance(self.events, a["lat"], a["lng"], start, n, radius_km=None)
        sale = event_attendance(self.events, a["lat"], a["lng"], start, n, radius_km=None, kinds={"SALE"})
        idx = np.arange(t0, t1)
        lag = lambda k: np.where(idx - k >= 0, self.visitors[area_idx, np.clip(idx - k, 0, self.hours - 1)], np.nan)  # noqa: E731
        if (idx - WEEK >= self.hours).any():
            raise ValueError("footfall forecasts reach at most one week past the data")
        return np.column_stack([np.full(n, area_idx), cal["hour"], cal["dow"], cal["weekend"], cal["holiday"], cal["payday"], ev, sale,
                                lag(168), lag(336)]).astype(np.float64)


def load_footfall(ml: duckdb.DuckDBPyConnection, intel: duckdb.DuckDBPyConnection) -> Footfall:
    areas = [dict(zip(("area_id", "name", "cluster", "lat", "lng"), r, strict=True))
             for r in intel.execute("SELECT area_id, name, cluster, lat, lng FROM area ORDER BY area_id").fetchall()]
    start = ml.execute("SELECT min(ts_utc) FROM footfall_hourly").fetchone()[0]
    rows = ml.execute("SELECT area_id, ts_utc, visitors FROM footfall_hourly ORDER BY area_id, ts_utc").fetchall()
    index = {a["area_id"]: i for i, a in enumerate(areas)}
    hours = int(ml.execute("SELECT count(DISTINCT ts_utc) FROM footfall_hourly").fetchone()[0])
    visitors = np.zeros((len(areas), hours), dtype=np.float64)
    for area_id, ts, v in rows:
        visitors[index[area_id], int((ts - start).total_seconds() // 3600)] = v
    return Footfall(areas=areas, start_utc=start, visitors=visitors, events=load_events(intel))


# ---------------------------------------------------------------- booth outcomes

BOOTH_FEATURES = ["area", "footfall_during", "event_nearby", "holiday", "weekend", "staff", "start_hour", "hours", "availability_pct"]


def booth_rows(ml: duckdb.DuckDBPyConnection, area_index: dict[str, int]) -> tuple[np.ndarray, np.ndarray, list[date]]:
    rows = ml.execute(
        "SELECT area_id, footfall_during, event_nearby, day_local, staff, start_hour_myt, hours, network_availability_pct, signups "
        "FROM booth_outcome ORDER BY day_local, booth_id"
    ).fetchall()
    x = np.array([[area_index[r[0]], r[1], float(r[2]), float(is_holiday(r[3])), float(r[3].weekday() >= 5), r[4], r[5], r[6],
                   np.nan if r[7] is None else r[7]] for r in rows], dtype=np.float64)
    return x, np.array([r[8] for r in rows], dtype=np.float64), [r[3] for r in rows]


# ---------------------------------------------------------------- network (hourly per cell)

@dataclass
class Network:
    cells: list[dict]  # cell_name, site_id, lat, lng, band, morphology
    start_utc: datetime
    prb: np.ndarray  # (cells, hours)
    events: list[tuple]

    @property
    def hours(self) -> int:
        return self.prb.shape[1]


def load_network(intel: duckdb.DuckDBPyConnection, site_ids: list[str] | None = None) -> Network:
    where = "WHERE c.site_id IN (SELECT unnest(?::VARCHAR[]))" if site_ids else ""
    cells = [dict(zip(("cell_name", "site_id", "lat", "lng", "band", "morphology", "azimuth"), r, strict=True)) for r in intel.execute(
        f"SELECT c.cell_name, c.site_id, c.lat, c.lng, c.band, s.morphology, c.azimuth FROM cell c JOIN site s USING (site_id) {where} ORDER BY c.cell_name",
        [site_ids] if site_ids else [],
    ).fetchall()]
    start = intel.execute("SELECT min(ts_utc) FROM kpi_hourly").fetchone()[0]
    hours = int((data_end(intel) - start).total_seconds() // 3600)
    names = [c["cell_name"] for c in cells]
    values = intel.execute(
        "SELECT prb_dl_pct FROM kpi_hourly WHERE cell_name IN (SELECT unnest(?::VARCHAR[])) ORDER BY cell_name, ts_utc", [names]
    ).fetchnumpy()["prb_dl_pct"]
    return Network(cells=cells, start_utc=start, prb=np.asarray(values, dtype=np.float64).reshape(len(cells), hours), events=load_events(intel))


BANDS = {"FDD-LTE850": 0, "TDD-LTE2300": 1, "TDD-LTE2600": 2}
MORPHS = {"Rural": 0, "Sub Urban": 1, "Urban": 2, "Dense Urban": 3}
CONGESTION_FEATURES = ["hour", "dow", "weekend", "holiday", "lag_168", "lag_336", "lag_504", "lag_mean", "event_attendance",
                       "event_facing_attendance", "band", "morphology"]
EVENT_CELL_RADIUS_KM = 3.5
FACING_DEG = 70


def congestion_matrix(net: Network, cell_idx: int, t0: int, t1: int) -> np.ndarray:
    n = t1 - t0
    start = net.start_utc + timedelta(hours=t0)
    cal = calendar_features(start, n)
    c = net.cells[cell_idx]
    ev = event_attendance(net.events, c["lat"], c["lng"], start, n, radius_km=EVENT_CELL_RADIUS_KM)
    facing = [e for e in net.events if _faces(c, e[2], e[3])]
    ev_facing = event_attendance(facing, c["lat"], c["lng"], start, n, radius_km=EVENT_CELL_RADIUS_KM)
    idx = np.arange(t0, t1)
    if (idx - WEEK >= net.hours).any():
        raise ValueError("congestion forecasts reach at most one week past the data")
    lags = [np.where(idx - k >= 0, net.prb[cell_idx, np.clip(idx - k, 0, net.hours - 1)], np.nan) for k in (168, 336, 504)]
    with np.errstate(all="ignore"):
        mean = np.nanmean(np.vstack(lags), axis=0)
    return np.column_stack([cal["hour"], cal["dow"], cal["weekend"], cal["holiday"], *lags, mean, ev, ev_facing,
                            np.full(n, BANDS.get(c["band"], -1)), np.full(n, MORPHS.get(c["morphology"], -1))]).astype(np.float64)


def _faces(cell: dict, lat: float, lng: float) -> bool:
    """Whether the cell's antenna points at a place (within FACING_DEG), or the place is right at the site."""
    if haversine_km(cell["lat"], cell["lng"], lat, lng) <= 0.3:
        return True
    p1, p2 = math.radians(cell["lat"]), math.radians(lat)
    dl = math.radians(lng - cell["lng"])
    bearing = (math.degrees(math.atan2(math.sin(dl) * math.cos(p2), math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl))) + 360) % 360
    return abs((cell["azimuth"] - bearing + 180) % 360 - 180) <= FACING_DEG


# ---------------------------------------------------------------- site failure (daily per site)

FAILURE_FEATURES = ["alarms_1d", "alarms_3d", "warnings_3d", "major_7d", "max_loss_1d", "max_loss_3d", "max_latency_1d", "min_avail_7d",
                    "outages_30d", "maintenance_next_day", "microwave", "mean_prb_7d"]


def failure_table(intel: duckdb.DuckDBPyConnection, site_ids: list[str] | None = None) -> tuple[list[str], list[date], np.ndarray, np.ndarray]:
    """Per site and local day: features known at the end of the day, and the label (total/partial outage starts the next day)."""
    sites = [r[0] for r in intel.execute("SELECT site_id FROM site ORDER BY site_id").fetchall() if not site_ids or r[0] in site_ids]
    sid = {s: i for i, s in enumerate(sites)}
    first, last = intel.execute("SELECT min(ts_utc + INTERVAL 8 HOUR)::DATE, max(ts_utc + INTERVAL 8 HOUR)::DATE FROM kpi_hourly").fetchone()
    days = [first + timedelta(days=i) for i in range((last - first).days + 1)]
    did = {d: i for i, d in enumerate(days)}
    S, D = len(sites), len(days)
    daily = {k: np.full((S, D), np.nan) for k in ("max_loss", "max_lat", "min_avail", "mean_prb")}
    for site, day, loss, lat, avail, prb in intel.execute(
        "SELECT site_id, (ts_utc + INTERVAL 8 HOUR)::DATE d, max(packet_loss_pct), max(latency_ms), min(availability_pct), avg(prb_dl_pct) "
        "FROM kpi_hourly GROUP BY 1, 2"
    ).fetchall():
        if site in sid:
            i, j = sid[site], did[day]
            daily["max_loss"][i, j], daily["max_lat"][i, j], daily["min_avail"][i, j], daily["mean_prb"][i, j] = loss, lat, avail, prb
    alarms = {k: np.zeros((S, D)) for k in ("all", "warning", "major")}
    for site, day, sev in intel.execute("SELECT site_id, (raised_utc + INTERVAL 8 HOUR)::DATE, severity FROM alarm").fetchall():
        if site in sid and day in did:
            alarms["all"][sid[site], did[day]] += 1
            if sev == "WARNING":
                alarms["warning"][sid[site], did[day]] += 1
            if sev in ("MAJOR", "CRITICAL"):
                alarms["major"][sid[site], did[day]] += 1
    outages = np.zeros((S, D))
    for site, day in intel.execute(
        "SELECT site_id, (start_utc + INTERVAL 8 HOUR)::DATE FROM outage WHERE fault_category IN ('Total Outage', 'Partial Outage')"
    ).fetchall():
        if site in sid and day in did:
            outages[sid[site], did[day]] = 1
    maint = np.zeros((S, D + 1))
    for site, day in intel.execute("SELECT site_id, (start_utc + INTERVAL 8 HOUR)::DATE FROM maintenance").fetchall():
        if site in sid and first <= day <= last + timedelta(days=1):
            maint[sid[site], (day - first).days] = 1
    micro = np.array([intel.execute("SELECT backhaul FROM site WHERE site_id = ?", [s]).fetchone()[0] == "Microwave" for s in sites], dtype=float)

    def window_sum(a: np.ndarray, k: int) -> np.ndarray:
        c = np.cumsum(np.pad(a, ((0, 0), (k, 0))), axis=1)
        return c[:, k:] - c[:, :-k]

    def window_reduce(a: np.ndarray, k: int, fn) -> np.ndarray:
        out = np.full_like(a, np.nan)
        for j in range(a.shape[1]):
            with np.errstate(all="ignore"):
                out[:, j] = fn(a[:, max(0, j - k + 1) : j + 1], axis=1)
        return out

    feats = np.stack([
        alarms["all"], window_sum(alarms["all"], 3), window_sum(alarms["warning"], 3), window_sum(alarms["major"], 7),
        daily["max_loss"], window_reduce(daily["max_loss"], 3, np.nanmax), daily["max_lat"], window_reduce(daily["min_avail"], 7, np.nanmin),
        window_sum(outages, 30), maint[:, 1:], np.repeat(micro[:, None], D, axis=1), window_reduce(daily["mean_prb"], 7, np.nanmean),
    ], axis=-1)  # (sites, days, features)
    label = np.zeros((S, D))
    label[:, :-1] = outages[:, 1:]  # an outage starts the next day
    return sites, days, feats, label


# ---------------------------------------------------------------- anomalies (hourly per cell)

ANOMALY_FEATURES = ["d_prb", "d_throughput_ratio", "d_loss", "d_latency", "d_availability"]


def anomaly_frame(intel: duckdb.DuckDBPyConnection, start: datetime, end: datetime, cells: list[str]) -> dict[str, np.ndarray]:
    """Deviation of each cell-hour in [start, end) from that cell's median for the same hour of the week (over the whole window).

    Returns numpy columns: cell_name, site_id, ts_utc (datetime64), the five ANOMALY_FEATURES as `x`, and the raw KPIs.
    Text and time come back as indexes / epoch seconds (DuckDB's numpy export needs pandas for those).
    """
    q = """
        WITH k AS (SELECT * FROM kpi_hourly WHERE cell_name IN (SELECT unnest(?::VARCHAR[]))),
        base AS (
            SELECT cell_name, dayofweek(ts_utc + INTERVAL 8 HOUR) dw, hour(ts_utc + INTERVAL 8 HOUR) h,
                   median(prb_dl_pct) m_prb, median(dl_throughput_mbps) m_thr, median(packet_loss_pct) m_loss,
                   median(latency_ms) m_lat, median(availability_pct) m_av
            FROM k GROUP BY 1, 2, 3)
        SELECT list_position(?::VARCHAR[], k.cell_name) - 1 AS ci, epoch(k.ts_utc)::BIGINT AS ts,
               k.prb_dl_pct - b.m_prb AS d_prb, k.dl_throughput_mbps / greatest(b.m_thr, 0.1) - 1 AS d_thr,
               coalesce(k.packet_loss_pct, b.m_loss) - b.m_loss AS d_loss, coalesce(k.latency_ms, b.m_lat) - b.m_lat AS d_lat,
               k.availability_pct - b.m_av AS d_av,
               k.prb_dl_pct, k.dl_throughput_mbps, k.packet_loss_pct, k.latency_ms, k.availability_pct, k.active_users
        FROM k JOIN base b ON b.cell_name = k.cell_name AND b.dw = dayofweek(k.ts_utc + INTERVAL 8 HOUR) AND b.h = hour(k.ts_utc + INTERVAL 8 HOUR)
        WHERE k.ts_utc >= ? AND k.ts_utc < ?
        ORDER BY k.ts_utc, k.cell_name
    """
    cols = intel.execute(q, [cells, cells, start, end]).fetchnumpy()
    x = np.column_stack([np.asarray(cols[c], dtype=np.float64) for c in ("d_prb", "d_thr", "d_loss", "d_lat", "d_av")])
    out = {k: np.asarray(v) for k, v in cols.items() if k not in ("ci", "ts")}
    sites = dict(intel.execute("SELECT cell_name, site_id FROM cell WHERE cell_name IN (SELECT unnest(?::VARCHAR[]))", [cells]).fetchall())
    names = np.array(cells, dtype=object)
    out["cell_name"] = names[np.asarray(cols["ci"], dtype=np.int64)]
    out["site_id"] = np.array([sites[c] for c in out["cell_name"]], dtype=object)
    out["ts_utc"] = np.asarray(cols["ts"], dtype=np.int64).astype("datetime64[s]")
    out["x"] = np.nan_to_num(x, nan=0.0)
    return out


def labelled_hours(intel: duckdb.DuckDBPyConnection) -> set[tuple[str, datetime]]:
    """Site-hours inside a recorded incident (outage, degradation, maintenance, backhaul alarm): the anomaly ground truth."""
    spans = intel.execute(
        "SELECT site_id, start_utc, end_utc FROM outage WHERE fault_category <> 'No Impact' "
        "UNION ALL SELECT site_id, start_utc, end_utc FROM maintenance "
        "UNION ALL SELECT site_id, raised_utc, cleared_utc FROM alarm WHERE code IN ('MW_LINK_DEGRADED', 'HIGH_PACKET_LOSS')"
    ).fetchall()
    out = set()
    for site, s, e in spans:
        t = s.replace(minute=0, second=0, microsecond=0)
        while t < (e or s + timedelta(hours=1)):
            out.add((site, t))
            t += timedelta(hours=1)
    return out
