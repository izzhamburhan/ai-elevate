"""Build intel.duckdb: an hourly, interconnected extension of the NetOps data (synthetic).

NetOps has daily cell KPIs, trouble tickets, planned maintenance and customer complaints, but no hourly
traffic and no alarms. This generator reads netops.duckdb READ-ONLY and writes a separate file:

- site, cell: copied from Site4G / Cell4G (same IDs, so every result joins back to NetOps)
- kpi_hourly: 28 days x 24 hours per 4G cell. Each day's mean PRB follows that cell's NetOps daily value; the
  hour-of-day shape depends on the site morphology. Throughput, latency, loss and SINR are derived from load.
- outage, maintenance, complaint: NetOps NTT, planned maintenance and THD records inside the window, applied
  to the hourly KPIs (a total outage zeroes the site's cells for its hours)
- alarm: derived from the outages, plus the scripted scenarios
- transport_link: microwave sites hang off the nearest fibre site of their cluster (a demo topology)
- grid_quality: RSRP/RSRQ/SINR per NetOps BIN grid, averaged over the window
- event, scenario: the reproducible demo scenarios (see SCENARIOS)

Times: NetOps timestamps are Malaysia local time (UTC+8, no DST); everything here is stored as naive UTC.
Same netops.duckdb + same SEED = the same file. Run: `uv run python -m netintel_mcp.seed [--netops-db P] [--out P]`.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import tempfile
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import duckdb
import numpy as np

GENERATOR_VERSION = "intel-v1"
SEED = 42
DAYS = 28
MYT = timedelta(hours=8)
STADIUM = ("Stadium Shah Alam", 3.0839, 101.5465)  # public landmark location (approximate)

# hour-of-day load shape (local time), normalised to mean 1 below
_RES = [0.35, 0.25, 0.2, 0.18, 0.2, 0.3, 0.5, 0.7, 0.75, 0.7, 0.68, 0.7, 0.75, 0.72, 0.7, 0.72, 0.8, 0.9, 1.0, 1.15, 1.3, 1.35, 1.2, 0.7]
_BUS = [0.2, 0.15, 0.12, 0.1, 0.12, 0.2, 0.4, 0.8, 1.15, 1.25, 1.25, 1.3, 1.35, 1.3, 1.25, 1.2, 1.15, 1.15, 1.0, 0.8, 0.65, 0.55, 0.45, 0.3]

SCENARIOS = {
    "SCN-EVENING-CONGESTION": "A residential Shah Alam sector runs above 85% PRB every evening (19:00-23:59 MYT) for the "
    "whole window; customers nearby complain that the Internet is slow around 8 PM (complaints CMP-SA-0001..0005).",
    "SCN-SHAH-ALAM-EVENT": "A concert at Stadium Shah Alam on the last Saturday of the window (19:00-23:00 MYT) pushes the two "
    "sectors facing the stadium near 100% PRB; an attendee complains (CMP-SA-0101).",
    "SCN-TRANSPORT-HUB": "On 2026-09-26 14:00-18:00 MYT three microwave sites that hang off the same fibre hub degrade "
    "(loss, latency, throughput) while a microwave maintenance RFC runs on that hub (RFC-INTEL-0001).",
    "SCN-RECURRING-VSWR": "Three sites raise an antenna VSWR alarm every 5-7 days (unstable radio equipment).",
    "SCN-RECURRING-BACKHAUL": "One microwave site degrades for 1-2 hours on four evenings with no maintenance planned.",
}


def _profile(values: list[float]) -> np.ndarray:
    arr = np.asarray(values, dtype=np.float64)
    return arr / arr.mean()


PROFILES = {
    ("res", False): _profile(_RES),
    ("res", True): _profile([v * (1.2 if 9 <= h <= 17 else 1.0) for h, v in enumerate(_RES)]),
    ("bus", False): _profile(_BUS),
    ("bus", True): _profile([v * 0.65 + 0.15 for v in _BUS]),
    ("mix", False): _profile([(a + b) / 2 for a, b in zip(_RES, _BUS, strict=True)]),
    ("mix", True): _profile([(a * 1.1 + b * 0.65 + 0.15) / 2 for a, b in zip(_RES, _BUS, strict=True)]),
}
MORPHOLOGY = {"Dense Urban": "bus", "Urban": "mix", "Sub Urban": "res", "Rural": "res"}


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def bearing_deg(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lng2 - lng1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def offset(lat: float, lng: float, bearing: float, km: float) -> tuple[float, float]:
    """Point `km` from (lat, lng) along `bearing` (flat-earth approximation, fine for < 5 km)."""
    dlat = km * math.cos(math.radians(bearing)) / 111.32
    dlng = km * math.sin(math.radians(bearing)) / (111.32 * math.cos(math.radians(lat)))
    return round(lat + dlat, 6), round(lng + dlng, 6)


@dataclass
class World:
    """Everything the generator builds before writing it out."""

    days: list[date]
    start_local: datetime
    sites: list[dict]
    cells: list[dict]
    site_index: dict[str, dict]
    cell_rows: dict[str, list[int]]  # site_id -> indexes into cells
    prb: np.ndarray  # (cells, days, 24)
    users: np.ndarray
    thr_base: np.ndarray  # daily throughput per cell/day
    avail: np.ndarray
    thr_mult: np.ndarray
    lat_add: np.ndarray
    loss_add: np.ndarray
    outages: list[dict] = field(default_factory=list)
    maintenance: list[dict] = field(default_factory=list)
    complaints: list[dict] = field(default_factory=list)
    alarms: list[dict] = field(default_factory=list)
    events: list[dict] = field(default_factory=list)
    transport: list[dict] = field(default_factory=list)
    scenario_rows: list[dict] = field(default_factory=list)

    def hours(self, start_local: datetime, end_local: datetime) -> list[tuple[int, int]]:
        """(day index, hour) slots overlapping [start, end) in local time, clipped to the window."""
        out = []
        first = start_local.replace(minute=0, second=0, microsecond=0)
        t = first
        while t < end_local:
            d = (t.date() - self.days[0]).days
            if 0 <= d < len(self.days):
                out.append((d, t.hour))
            t += timedelta(hours=1)
        return out

    def nearest_sites(self, site_id: str, n: int, same_cluster: bool = False) -> list[dict]:
        s = self.site_index[site_id]
        others = [o for o in self.sites if o["site_id"] != site_id and (not same_cluster or o["cluster"] == s["cluster"])]
        return sorted(others, key=lambda o: (haversine_km(s["lat"], s["lng"], o["lat"], o["lng"]), o["site_id"]))[:n]


def _utc(local: datetime) -> datetime:
    return local - MYT


def _load(netops: duckdb.DuckDBPyConnection, rng: np.random.Generator) -> World:
    end_day: date = netops.execute('SELECT max("Date") FROM ran_kpi_4g').fetchone()[0]
    days = [end_day - timedelta(days=DAYS - 1 - i) for i in range(DAYS)]
    start_local = datetime.combine(days[0], datetime.min.time())

    sites = [
        {
            "site_id": r[0], "name": r[1], "cluster": r[2], "region": r[3], "state": r[4], "lat": float(r[5]), "lng": float(r[6]),
            "backhaul": r[7], "exchange": r[8], "power": r[9], "morphology": r[10], "enodeb_id": r[11],
        }
        for r in netops.execute(
            'SELECT "Site_ID", "Site_Name", "Cluster_Name", "Region", "State", "Latitude", "Longitude", "Backhaul", '
            '"TM_Exchange", "Power", "RFP_Morphology", "eNodeB_ID" FROM "Site4G" ORDER BY "Site_ID"'
        ).fetchall()
    ]
    site_index = {s["site_id"]: s for s in sites}
    cells = [
        {"cell_name": r[0], "site_id": r[1], "sector": int(r[2] or 0), "azimuth": float(r[3] or 0), "band": r[4]}
        for r in netops.execute(
            'SELECT "Cell_Name", "Site_ID", "Sector_ID", "Azimuth", "Freq_Band" FROM "Cell4G" ORDER BY "Cell_Name"'
        ).fetchall()
        if r[1] in site_index
    ]
    for c in cells:
        s = site_index[c["site_id"]]
        c["lat"], c["lng"] = s["lat"], s["lng"]
    cell_pos = {c["cell_name"]: i for i, c in enumerate(cells)}
    cell_rows: dict[str, list[int]] = {}
    for i, c in enumerate(cells):
        cell_rows.setdefault(c["site_id"], []).append(i)

    n = len(cells)
    daily_prb = np.full((n, DAYS), np.nan)
    daily_users = np.full((n, DAYS), np.nan)
    daily_thr = np.full((n, DAYS), np.nan)
    for cell, day, prb, users, thr in netops.execute(
        'SELECT "Cell", "Date", "Webe_DL_Resource_Block_Utilization", "Webe_Maximum_Cell_RRC_Connected_User_Number", '
        '"Webe_Average_DL_User_Throughput_MB" FROM ran_kpi_4g WHERE "Date" BETWEEN ? AND ?',
        [days[0], days[-1]],
    ).fetchall():
        i = cell_pos.get(cell)
        if i is None:
            continue
        d = (day - days[0]).days
        daily_prb[i, d], daily_users[i, d], daily_thr[i, d] = prb, users, thr
    # a missing day takes the cell's mean (or a typical value when the cell has none)
    for arr, fallback in ((daily_prb, 40.0), (daily_users, 80.0), (daily_thr, 15.0)):
        means = np.nanmean(np.where(np.isnan(arr), np.nan, arr), axis=1)
        means = np.where(np.isnan(means), fallback, means)
        arr[:] = np.where(np.isnan(arr), means[:, None], arr)

    prb = np.empty((n, DAYS, 24))
    users = np.empty((n, DAYS, 24))
    weekend = np.array([d.weekday() >= 5 for d in days])
    for i, c in enumerate(cells):
        kind = MORPHOLOGY.get(site_index[c["site_id"]]["morphology"], "mix")
        shape = np.stack([PROFILES[(kind, bool(w))] for w in weekend])  # (days, 24)
        prb[i] = daily_prb[i][:, None] * shape * (1 + 0.05 * rng.standard_normal((DAYS, 24)))
        users[i] = daily_users[i][:, None] * shape / shape.max(axis=1, keepdims=True) * (1 + 0.08 * rng.standard_normal((DAYS, 24)))
    prb = np.clip(prb, 0.5, 99.5)
    users = np.clip(users, 1, None)

    return World(
        days=days, start_local=start_local, sites=sites, cells=cells, site_index=site_index, cell_rows=cell_rows,
        prb=prb, users=users, thr_base=daily_thr, avail=np.full((n, DAYS, 24), 100.0) - rng.uniform(0, 0.3, (n, DAYS, 24)),
        thr_mult=np.ones((n, DAYS, 24)), lat_add=np.zeros((n, DAYS, 24)), loss_add=np.zeros((n, DAYS, 24)),
    )


def _apply_records(w: World, netops: duckdb.DuckDBPyConnection) -> None:
    """NetOps trouble tickets, planned maintenance and complaints inside the window, applied to the hourly KPIs."""
    window_end = w.start_local + timedelta(days=DAYS)
    rows = netops.execute(
        "SELECT ntt_no, network_element_ne_id, created_date, ettr, fault_category, problem_desc FROM ntt_granite "
        "WHERE created_date < ? AND coalesce(ettr, created_date + INTERVAL 4 HOUR) >= ? "
        "QUALIFY row_number() OVER (PARTITION BY ntt_no ORDER BY id) = 1 ORDER BY created_date, ntt_no",
        [window_end, w.start_local],
    ).fetchall()
    effects = {
        "Total Outage": (0.0, 0.0, 0.0, 0.0, "S1_LINK_LOST", "CRITICAL"),
        "Partial Outage": (50.0, 0.6, 15.0, 0.8, "CELL_UNAVAILABLE", "MAJOR"),
        "Degradation": (97.0, 0.5, 25.0, 1.5, "KPI_DEGRADATION", "MINOR"),
    }
    for ntt_no, site_id, start, end, category, desc in rows:
        if site_id not in w.site_index:
            continue
        end = end or start + timedelta(hours=4)
        w.outages.append({"ntt_no": ntt_no, "site_id": site_id, "start_utc": _utc(start), "end_utc": _utc(end),
                          "fault_category": category, "description": desc, "source": "netops:ntt_granite"})
        if category not in effects:
            continue
        avail, thr, lat, loss, code, severity = effects[category]
        slots = w.hours(start, end)
        for i in w.cell_rows.get(site_id, []):
            for d, h in slots:
                w.avail[i, d, h] = min(w.avail[i, d, h], avail)
                w.thr_mult[i, d, h] *= thr if thr else 1.0
                w.lat_add[i, d, h] += lat
                w.loss_add[i, d, h] += loss
        if category == "Total Outage":  # neighbours pick up part of the traffic
            for o in w.nearest_sites(site_id, 3):
                for i in w.cell_rows.get(o["site_id"], []):
                    for d, h in slots:
                        w.prb[i, d, h] = min(99.5, w.prb[i, d, h] + 10.0)
        w.alarms.append({"site_id": site_id, "cell_name": None, "raised_utc": _utc(start), "cleared_utc": _utc(end),
                         "code": code, "severity": severity, "source": f"derived:{ntt_no}"})

    for rfc, start, end, sub, host, title in netops.execute(
        'SELECT "RFC ID", "Planned Start", "Planned End", "Sub Network", "Hostname", "Title" FROM "Webe_Plan_Maintenance" '
        'WHERE "Planned Start" < ? AND "Planned End" >= ? ORDER BY "Planned Start", "RFC ID"',
        [window_end, w.start_local],
    ).fetchall():
        if host not in w.site_index:
            continue
        w.maintenance.append({"rfc_id": rfc, "site_id": host, "start_utc": _utc(start), "end_utc": _utc(end),
                              "sub_network": sub, "title": title, "source": "netops:Webe_Plan_Maintenance"})
        slots = w.hours(start, end)
        for i in w.cell_rows.get(host, []):
            for d, h in slots:
                if str(sub).startswith("RAN"):  # planned RAN work takes the site off air
                    w.avail[i, d, h] = 0.0
                elif str(sub).startswith("TX"):
                    w.thr_mult[i, d, h] *= 0.5
                    w.loss_add[i, d, h] += 1.0

    for case, created, site_id, ctype, cause, tech, lat, lng in netops.execute(
        'SELECT "CaseNumber", "CreatedOn", "SiteID", "CaseType", "RootCause1", "Technology", "ComplaintLocationLatitude", '
        '"ComplaintLocationLongitude" FROM "THD" WHERE "CreatedOn" >= ? AND "CreatedOn" < ? ORDER BY "CreatedOn", "CaseNumber"',
        [w.start_local, window_end],
    ).fetchall():
        w.complaints.append({"complaint_id": str(case), "created_utc": _utc(created), "site_id": site_id, "lat": lat, "lng": lng,
                             "category": ctype, "description": f"{ctype} complaint ({tech})", "netops_root_cause": cause,
                             "source": "netops:THD"})


def _transport(w: World) -> None:
    """Demo topology: each microwave site is fed by the nearest fibre site of its cluster."""
    for s in w.sites:
        if s["backhaul"] != "Microwave":
            continue
        fibre = [o for o in w.sites if o["cluster"] == s["cluster"] and o["backhaul"] == "Fiber"]
        if not fibre:
            continue
        hub = min(fibre, key=lambda o: (haversine_km(s["lat"], s["lng"], o["lat"], o["lng"]), o["site_id"]))
        w.transport.append({"site_id": s["site_id"], "hub_site_id": hub["site_id"], "kind": "microwave",
                            "distance_km": round(haversine_km(s["lat"], s["lng"], hub["lat"], hub["lng"]), 3)})


def _scenarios(w: World, rng: np.random.Generator) -> None:
    used: set[str] = set()
    shah = [s for s in w.sites if s["cluster"] == "Shah Alam"]

    # SCN-EVENING-CONGESTION
    site_a = next(s for s in shah if s["morphology"] in ("Sub Urban", "Urban"))
    cell_a = w.cell_rows[site_a["site_id"]][0]
    used.add(site_a["site_id"])
    for d in range(DAYS):
        w.prb[cell_a, d, 18] = max(w.prb[cell_a, d, 18], 78 + 6 * rng.random())
        for h in range(19, 24):
            w.prb[cell_a, d, h] = max(w.prb[cell_a, d, h], 87 + 9 * rng.random())
    az = w.cells[cell_a]["azimuth"]
    for k, day_back in enumerate([1, 4, 8, 13, 19]):
        day = w.days[-1 - day_back]
        when = datetime.combine(day, datetime.min.time()) + timedelta(hours=20, minutes=int(rng.integers(0, 100)))
        lat, lng = offset(site_a["lat"], site_a["lng"], az + rng.uniform(-20, 20), rng.uniform(0.25, 0.6))
        w.complaints.append({"complaint_id": f"CMP-SA-{k + 1:04d}", "created_utc": _utc(when), "site_id": site_a["site_id"],
                             "lat": lat, "lng": lng, "category": "Data",
                             "description": "My Internet becomes slow every evening around 8 PM; it is fine in the morning.",
                             "netops_root_cause": None, "source": "scenario:SCN-EVENING-CONGESTION"})
    w.scenario_rows.append({"scenario_id": "SCN-EVENING-CONGESTION", "sites": [site_a["site_id"]],
                            "cells": [w.cells[cell_a]["cell_name"]], "complaints": [f"CMP-SA-{k:04d}" for k in range(1, 6)]})

    # SCN-SHAH-ALAM-EVENT
    name, slat, slng = STADIUM
    saturday = max(d for d in w.days if d.weekday() == 5)
    start = datetime.combine(saturday, datetime.min.time()) + timedelta(hours=19)
    end = start + timedelta(hours=4)
    candidates = []
    for s in shah:
        dist = haversine_km(s["lat"], s["lng"], slat, slng)
        if dist > 4:
            continue
        to_stadium = bearing_deg(s["lat"], s["lng"], slat, slng)
        for i in w.cell_rows[s["site_id"]]:
            if i == cell_a:
                continue
            off = abs((w.cells[i]["azimuth"] - to_stadium + 180) % 360 - 180)
            if off <= 60:
                candidates.append((dist + off / 120, w.cells[i]["cell_name"], i))
    event_cells = [i for _, _, i in sorted(candidates)[:2]]
    w.events.append({"event_id": "EVT-SA-CONCERT", "name": f"Concert at {name}", "kind": "CONCERT", "lat": slat, "lng": slng,
                     "start_utc": _utc(start), "end_utc": _utc(end), "attendance": 45000, "source": "scenario:SCN-SHAH-ALAM-EVENT"})
    for d, h in w.hours(start - timedelta(hours=1), end + timedelta(hours=1)):
        for i in event_cells:
            w.prb[i, d, h] = min(99.5, w.prb[i, d, h] + 35)
            w.users[i, d, h] *= 1.8
    when = start + timedelta(hours=2, minutes=10)
    lat, lng = offset(slat, slng, 200, 0.15)
    w.complaints.append({"complaint_id": "CMP-SA-0101", "created_utc": _utc(when), "site_id": w.cells[event_cells[0]]["site_id"],
                         "lat": lat, "lng": lng, "category": "Data", "description": "Cannot upload videos or send photos at the concert.",
                         "netops_root_cause": None, "source": "scenario:SCN-SHAH-ALAM-EVENT"})
    used.update(w.cells[i]["site_id"] for i in event_cells)
    w.scenario_rows.append({"scenario_id": "SCN-SHAH-ALAM-EVENT", "sites": sorted({w.cells[i]["site_id"] for i in event_cells}),
                            "cells": [w.cells[i]["cell_name"] for i in event_cells], "events": ["EVT-SA-CONCERT"],
                            "complaints": ["CMP-SA-0101"]})

    # SCN-TRANSPORT-HUB: the hub with the most microwave children (at least 3), ties by id
    children: dict[str, list[str]] = {}
    for t in w.transport:
        children.setdefault(t["hub_site_id"], []).append(t["site_id"])
    hub, kids = sorted(((h, sorted(k)) for h, k in children.items() if len(k) >= 3 and h not in used), key=lambda x: (-len(x[1]), x[0]))[0]
    hub_site = w.site_index[hub]
    kids = sorted(kids, key=lambda k: haversine_km(hub_site["lat"], hub_site["lng"], w.site_index[k]["lat"], w.site_index[k]["lng"]))[:3]
    day = date(2026, 9, 26)
    if not (w.days[0] <= day <= w.days[-1]):
        day = w.days[len(w.days) // 2]
    base = datetime.combine(day, datetime.min.time())
    w.maintenance.append({"rfc_id": "RFC-INTEL-0001", "site_id": hub, "start_utc": _utc(base + timedelta(hours=13, minutes=30)),
                          "end_utc": _utc(base + timedelta(hours=18, minutes=30)), "sub_network": "TX-Microwave link",
                          "title": f"Microwave hub radio firmware upgrade - {hub}", "source": "scenario:SCN-TRANSPORT-HUB"})
    w.alarms.append({"site_id": hub, "cell_name": None, "raised_utc": _utc(base + timedelta(hours=13, minutes=52)),
                     "cleared_utc": _utc(base + timedelta(hours=18, minutes=5)), "code": "MW_LINK_DEGRADED", "severity": "MAJOR",
                     "source": "scenario:SCN-TRANSPORT-HUB"})
    for k, kid in enumerate(kids):
        for i in w.cell_rows[kid]:
            for d, h in w.hours(base + timedelta(hours=14), base + timedelta(hours=18)):
                w.thr_mult[i, d, h] *= 0.35
                w.loss_add[i, d, h] += 3.5
                w.lat_add[i, d, h] += 60
                w.avail[i, d, h] = min(w.avail[i, d, h], 92.0)
        w.alarms.append({"site_id": kid, "cell_name": None, "raised_utc": _utc(base + timedelta(hours=14, minutes=5 + 5 * k)),
                         "cleared_utc": _utc(base + timedelta(hours=18, minutes=10)), "code": "HIGH_PACKET_LOSS", "severity": "MINOR",
                         "source": "scenario:SCN-TRANSPORT-HUB"})
        w.outages.append({"ntt_no": f"NTT-INTEL-{k + 1:04d}", "site_id": kid, "start_utc": _utc(base + timedelta(hours=14, minutes=25 + 5 * k)),
                          "end_utc": _utc(base + timedelta(hours=18, minutes=10)), "fault_category": "Degradation",
                          "description": "Slow data, high packet loss reported by customers.", "source": "scenario:SCN-TRANSPORT-HUB"})
    used.update([hub, *kids])
    w.scenario_rows.append({"scenario_id": "SCN-TRANSPORT-HUB", "sites": kids, "hub": hub, "maintenance": ["RFC-INTEL-0001"],
                            "day_local": day.isoformat()})

    # SCN-RECURRING-BACKHAUL: one microwave site not used above, four evenings
    mw = next((t["site_id"] for t in w.transport if t["site_id"] not in used), None)
    if mw is None:
        return
    used.add(mw)
    for day_idx in sorted(rng.choice(range(DAYS), size=4, replace=False).tolist()):
        start = datetime.combine(w.days[day_idx], datetime.min.time()) + timedelta(hours=int(rng.integers(17, 22)))
        end = start + timedelta(hours=int(rng.integers(1, 3)))
        for i in w.cell_rows[mw]:
            for d, h in w.hours(start, end):
                w.thr_mult[i, d, h] *= 0.4
                w.loss_add[i, d, h] += 2.5
                w.lat_add[i, d, h] += 45
        w.alarms.append({"site_id": mw, "cell_name": None, "raised_utc": _utc(start), "cleared_utc": _utc(end),
                         "code": "MW_LINK_DEGRADED", "severity": "MAJOR", "source": "scenario:SCN-RECURRING-BACKHAUL"})
    w.scenario_rows.append({"scenario_id": "SCN-RECURRING-BACKHAUL", "sites": [mw]})

    # SCN-RECURRING-VSWR: three urban sites not used above, every 5-7 days
    pool = [s["site_id"] for s in w.sites if s["morphology"] == "Urban" and s["backhaul"] == "Fiber" and s["site_id"] not in used]
    if len(pool) < 3:
        return
    vswr = sorted(rng.choice(pool, size=3, replace=False).tolist())
    for site_id in vswr:
        d = int(rng.integers(0, 4))
        while d < DAYS:
            raised = datetime.combine(w.days[d], datetime.min.time()) + timedelta(hours=int(rng.integers(0, 24)), minutes=int(rng.integers(0, 60)))
            cell = w.cell_rows[site_id][0]
            w.alarms.append({"site_id": site_id, "cell_name": w.cells[cell]["cell_name"], "raised_utc": _utc(raised),
                             "cleared_utc": _utc(raised + timedelta(minutes=int(rng.integers(20, 90)))), "code": "VSWR_HIGH",
                             "severity": "MINOR", "source": "scenario:SCN-RECURRING-VSWR"})
            for dd, h in w.hours(raised, raised + timedelta(hours=1)):
                w.loss_add[cell, dd, h] += 0.4
            d += int(rng.integers(5, 8))
    used.update(vswr)
    w.scenario_rows.append({"scenario_id": "SCN-RECURRING-VSWR", "sites": vswr})


def _derived(w: World, rng: np.random.Generator, base_sinr: np.ndarray) -> dict[str, np.ndarray]:
    """Throughput, latency, loss and SINR from the final load, then the outage effects."""
    load = w.prb / 100.0
    # user throughput falls slowly with load, then sharply once the cell is above ~80% PRB
    shape = np.clip(1.2 - 0.4 * load**2 - 25 * np.clip(load - 0.8, 0, None) ** 2, 0.12, None)
    thr = w.thr_base[:, :, None] * shape / shape.mean(axis=2, keepdims=True) * (1 + 0.05 * rng.standard_normal(w.prb.shape))
    thr = np.clip(thr, 0.3, None) * w.thr_mult
    latency = 16 + 45 * np.clip((w.prb - 70) / 30, 0, None) ** 2 + 2 * rng.standard_normal(w.prb.shape) + w.lat_add
    loss = 0.05 + 2.8 * np.clip((w.prb - 82) / 18, 0, None) ** 2 + np.abs(0.03 * rng.standard_normal(w.prb.shape)) + w.loss_add
    sinr = base_sinr[:, None, None] - 0.08 * (w.prb - 50) + 0.8 * rng.standard_normal(w.prb.shape)
    off = w.avail <= 0.0  # off air: no load, no users, no throughput
    prb = np.where(off, 0.0, w.prb)
    users = np.where(off, 0.0, np.round(w.users))
    thr = np.where(off, 0.0, thr)
    return {
        "prb_dl_pct": prb, "active_users": users, "dl_throughput_mbps": thr, "availability_pct": np.clip(w.avail, 0, 100),
        "latency_ms": np.where(off, np.nan, np.clip(latency, 8, None)), "packet_loss_pct": np.where(off, np.nan, np.clip(loss, 0, 100)),
        "sinr_db": np.where(off, np.nan, sinr),
    }


def build(netops_db: Path, out: Path, seed: int = SEED) -> dict[str, int]:
    rng = np.random.default_rng(seed)
    # DuckDB allows one writer; read a private copy so a running NetOps server is never disturbed
    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / "netops.duckdb"
        copy.write_bytes(netops_db.read_bytes())
        netops = duckdb.connect(str(copy), read_only=True)
        try:
            w = _load(netops, rng)
            _apply_records(w, netops)
            _transport(w)
            _scenarios(w, rng)
            grid = netops.execute(
                'SELECT k."Grid_ID", any_value(b.latitude), any_value(b.longitude), avg(k.avg_rsrp), avg(k.avg_rsrq), avg(k.sinr), '
                'avg(k.cqi), sum(k."SampleNO"), mode(k."CellName") FROM "BinKPI" k JOIN "Bin_Information" b USING ("Grid_ID") '
                'WHERE k."DateID" BETWEEN ? AND ? GROUP BY k."Grid_ID" ORDER BY k."Grid_ID"',
                [int(w.days[0].strftime("%Y%m%d")), int(w.days[-1].strftime("%Y%m%d"))],
            ).fetchall()
            cell_sinr = dict(netops.execute(
                'SELECT "CellName", avg(sinr) FROM "BinKPI" WHERE "DateID" BETWEEN ? AND ? GROUP BY 1',
                [int(w.days[0].strftime("%Y%m%d")), int(w.days[-1].strftime("%Y%m%d"))],
            ).fetchall())
            ref = netops.execute("SELECT value FROM _meta WHERE key = 'ref_date'").fetchone() if _has_meta(netops) else None
        finally:
            netops.close()

    base_sinr = np.array([cell_sinr.get(c["cell_name"]) or rng.uniform(8, 16) for c in w.cells], dtype=np.float64)
    metrics = _derived(w, rng, base_sinr)

    n = len(w.cells)
    stamps = np.array([np.datetime64(_utc(w.start_local + timedelta(days=d, hours=h)), "s") for d in range(DAYS) for h in range(24)])
    hourly = {  # noqa: F841 - read by DuckDB below (SELECT * FROM hourly)
        "cell_name": np.repeat(np.array([c["cell_name"] for c in w.cells]), DAYS * 24),
        "site_id": np.repeat(np.array([c["site_id"] for c in w.cells]), DAYS * 24),
        "ts_utc": np.tile(stamps, n),
        **{k: np.round(v.reshape(-1), 2).astype(np.float32) for k, v in metrics.items()},
    }

    tmp_out = out.with_suffix(".tmp.duckdb")
    tmp_out.unlink(missing_ok=True)
    db = duckdb.connect(str(tmp_out))
    try:
        _write(db, "site", w.sites)
        _write(db, "cell", w.cells)
        db.execute("CREATE TABLE kpi_hourly AS SELECT * FROM hourly")
        db.execute("ALTER TABLE kpi_hourly ALTER ts_utc TYPE TIMESTAMP")
        _write(db, "outage", w.outages)
        _write(db, "maintenance", w.maintenance)
        _write(db, "complaint", w.complaints)
        _write(db, "alarm", sorted(w.alarms, key=lambda a: (a["raised_utc"], a["site_id"], a["code"])))
        _write(db, "event", w.events)
        _write(db, "transport_link", w.transport)
        db.execute(
            "CREATE TABLE grid_quality (grid_id BIGINT, lat DOUBLE, lng DOUBLE, rsrp_dbm DOUBLE, rsrq_db DOUBLE, sinr_db DOUBLE, "
            "cqi DOUBLE, samples BIGINT, top_cell VARCHAR)"
        )
        if grid:
            db.executemany("INSERT INTO grid_quality VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", grid)
        db.execute("CREATE TABLE scenario (scenario_id VARCHAR, description VARCHAR, detail JSON)")
        db.executemany(
            "INSERT INTO scenario VALUES (?, ?, ?)",
            [(r["scenario_id"], SCENARIOS[r["scenario_id"]], json.dumps(r)) for r in w.scenario_rows],
        )
        meta = {
            "generator_version": GENERATOR_VERSION, "seed": str(seed), "netops_ref_date": ref[0] if ref else "",
            "window_start_utc": _utc(w.start_local).isoformat(), "window_end_utc": _utc(w.start_local + timedelta(days=DAYS)).isoformat(),
            "window_days_local": f"{w.days[0].isoformat()}..{w.days[-1].isoformat()}", "timezone_note": "stored as naive UTC; NetOps times are MYT (UTC+8)",
            "synthetic": "true", "built_at_utc": datetime.now(UTC).isoformat(timespec="seconds"),
        }
        db.execute("CREATE TABLE meta (key VARCHAR PRIMARY KEY, value VARCHAR)")
        db.executemany("INSERT INTO meta VALUES (?, ?)", sorted(meta.items()))
        counts = {t: db.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in
                  ("site", "cell", "kpi_hourly", "outage", "maintenance", "complaint", "alarm", "event", "transport_link", "grid_quality", "scenario")}
    finally:
        db.close()
    os.replace(tmp_out, out)
    return counts


def _has_meta(con: duckdb.DuckDBPyConnection) -> bool:
    return bool(con.execute("SELECT count(*) FROM information_schema.tables WHERE table_name = '_meta'").fetchone()[0])


def _write(db: duckdb.DuckDBPyConnection, table: str, rows: list[dict]) -> None:
    if not rows:
        raise ValueError(f"{table}: nothing to write")
    cols = list(rows[0])
    data = {c: np.array([r[c] for r in rows], dtype=object) for c in cols}
    for c in cols:  # let DuckDB type the columns: lists become JSON text, the rest stays as is
        if any(isinstance(v, list) for v in data[c]):
            data[c] = np.array([json.dumps(v) for v in data[c]], dtype=object)
    db.execute(f"CREATE TABLE {table} AS SELECT * FROM data")


def default_paths() -> tuple[Path, Path]:
    backend = Path(__file__).resolve().parents[3]
    return backend / "netops-mcp" / "data" / "netops.duckdb", Path(os.environ.get("NETINTEL_DB", backend / "data" / "intel.duckdb"))


def main(argv: list[str] | None = None) -> None:
    netops_default, out_default = default_paths()
    parser = argparse.ArgumentParser(prog="netintel-seed", description=__doc__)
    parser.add_argument("--netops-db", type=Path, default=netops_default)
    parser.add_argument("--out", type=Path, default=out_default)
    parser.add_argument("--seed", type=int, default=SEED)
    args = parser.parse_args(argv)
    if not args.netops_db.exists():
        raise SystemExit(f"netops.duckdb not found at {args.netops_db}; seed NetOps first (python run_all.py netops)")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    counts = build(args.netops_db, args.out, args.seed)
    print(f"wrote {args.out}: " + ", ".join(f"{k}={v}" for k, v in counts.items()))


if __name__ == "__main__":
    main()
