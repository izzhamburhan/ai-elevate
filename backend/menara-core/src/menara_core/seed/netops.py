"""Link the Menara seed to NetOps: towers, cells, KPI baselines and status come from netops.duckdb.

NetOps stays the main data. Menara reads it (read-only) when `menara-seed --netops-db <file>` is given and
keeps its own ID formats, so every Menara tower maps back to one NetOps `Site4G` row (see the `netops_link`
table). The scripted flood scenario is re-anchored onto real NetOps sites in the cluster nearest to it.
"""

from __future__ import annotations

import random
import re
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from menara_core.geo import haversine_km
from menara_core.ids import cell_id_for, site_id_for
from menara_core.scenario import ClusterTower, Scenario
from menara_core.seed import sites as site_seed
from menara_core.seed import towers as gen

STATE_MAP = {
    "WP Kuala Lumpur": "Wilayah Persekutuan",
    "WP Putrajaya": "Wilayah Persekutuan",
    "WP Labuan": "Wilayah Persekutuan",
    "Kedah & Perlis": "Kedah",
}
BAND_MAP = {"FDD-LTE850": "B5", "TDD-LTE2300": "B40", "TDD-LTE2600": "B38"}
TYPE_MAP = {"Macro": "macro", "IBC": "rooftop", "Small Cell": "pole"}
RESERVED_CODES = {"KKRI"}  # the scripted scenario cluster keeps its own code
CONGESTED_MIN_PRB = 80.0


@dataclass(frozen=True)
class Forced:
    """Baseline state taken from NetOps instead of drawn at random."""

    status: str  # UP | DEGRADED | DOWN
    base: tuple[float, float, float]  # prb_util, drop_rate, throughput_mbps


@dataclass
class NetopsLink:
    towers: list[gen.TowerRow]  # baseline towers, one per NetOps site
    cluster: list[gen.TowerRow]  # the scripted scenario towers, placed on NetOps sites
    cells: dict[str, list[tuple[str, str, str, int, float]]]
    forced: dict[str, Forced]
    towns: list[tuple[str, str, str, float, float, int, float]]
    urban_codes: set[str]
    links: list[tuple[str, str, int, str]]  # enodeb_name, netops_site_id, netops_enodeb_id, netops_cluster_id
    scenario: Scenario  # re-anchored copy


def _code_for(name: str, taken: set[str]) -> str:
    """Unique 4-letter area code for a cluster name (KLCC, KOTA -> KBHR, ...)."""
    words = [re.sub(r"[^A-Z]", "", w.upper()) for w in name.split()]
    words = [w for w in words if w]
    letters = "".join(words) or "XXXX"
    candidates = [letters[:4]]
    if len(words) > 1:
        candidates += [words[0][:2] + words[1][:2], words[0][:1] + words[1][:3], words[0][:3] + words[1][:1]]
    candidates += [letters[:3] + letters[-1], letters[:2] + letters[-2:]]
    for cand in candidates:
        cand = (cand + "XXXX")[:4]
        if cand not in taken and cand not in RESERVED_CODES:
            return cand
    for a in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        cand = letters[:3].ljust(3, "X") + a
        if cand not in taken and cand not in RESERVED_CODES:
            return cand
    raise ValueError(f"no free area code for {name}")


def _tilt(electrical: Any, mechanical: Any) -> float:
    def num(value: Any) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0

    return round(min(12.0, max(0.0, num(electrical) + num(mechanical))), 1)


def _shift(obj: Any, dlat: float, dlng: float) -> None:
    """Move every lat/lng in a scenario by the same offset (the cluster's towers are placed separately)."""
    if isinstance(obj, BaseModel):
        fields = type(obj).model_fields
        if "lat" in fields and "lng" in fields and not isinstance(obj, ClusterTower):
            obj.lat += dlat
            obj.lng += dlng
        for name in fields:
            if name != "towers" or not hasattr(obj, "code"):
                _shift(getattr(obj, name), dlat, dlng)
    elif isinstance(obj, list):
        for item in obj:
            _shift(item, dlat, dlng)
    elif isinstance(obj, dict):
        for item in obj.values():
            _shift(item, dlat, dlng)


def load(path: Path, rng: random.Random, scenario: Scenario) -> NetopsLink:
    import duckdb

    try:
        conn = duckdb.connect(str(path), read_only=True)
    except duckdb.IOException as exc:
        raise SystemExit(
            f"Cannot read {path}: stop the NetOps server first (DuckDB allows one process), "
            "or pass a copy of the file."
        ) from exc
    try:
        sites = conn.execute(
            """SELECT s.Site_ID, s.Site_Name, s.Vendor, s.Type, s.State, s.Cluster_ID, s.Cluster_Name,
                      s.eNodeB_ID, s.Latitude, s.Longitude, s.Status, c.Morphology
               FROM Site4G s LEFT JOIN TM_Cluster c USING (Cluster_ID)
               WHERE s.Latitude IS NOT NULL AND s.Longitude IS NOT NULL
               ORDER BY s.Site_ID"""
        ).fetchall()
        cell_rows = conn.execute(
            "SELECT Site_ID, Freq_Band, Azimuth, E_Tilt, M_Tilt FROM Cell4G ORDER BY Site_ID, Cell_Name"
        ).fetchall()
        kpi_rows = conn.execute(
            """SELECT site_id, avg(prb), avg(volte_drop_rate), avg(dl_throughput)
               FROM network_kpi WHERE provider = 'TM4G' GROUP BY site_id"""
        ).fetchall()
    finally:
        conn.close()
    if not sites:
        raise SystemExit(f"{path} has no Site4G rows; run `python -m netops_mcp.seed` first.")

    # one 4-letter area code per NetOps cluster
    clusters: dict[str, dict[str, Any]] = {}
    for _sid, _n, _v, _t, state, cid, cname, _e, lat, lng, _s, morph in sites:
        entry = clusters.setdefault(
            cid, {"name": cname, "state": STATE_MAP.get(state, state), "morph": morph, "lat": [], "lng": []}
        )
        entry["lat"].append(lat)
        entry["lng"].append(lng)
    taken: set[str] = set()
    for cid in sorted(clusters):
        clusters[cid]["code"] = _code_for(clusters[cid]["name"], taken)
        taken.add(clusters[cid]["code"])
        clusters[cid]["clat"] = sum(clusters[cid]["lat"]) / len(clusters[cid]["lat"])
        clusters[cid]["clng"] = sum(clusters[cid]["lng"]) / len(clusters[cid]["lng"])

    # the scripted flood cluster is re-anchored on the NetOps cluster nearest to it
    scripted = scenario.cluster.towers
    s_lat = sum(t.lat for t in scripted) / len(scripted)
    s_lng = sum(t.lng for t in scripted) / len(scripted)
    anchor_id = min(clusters, key=lambda c: haversine_km(s_lat, s_lng, clusters[c]["clat"], clusters[c]["clng"]))
    anchor = clusters[anchor_id]
    by_distance = sorted(sites, key=lambda r: haversine_km(anchor["clat"], anchor["clng"], r[8], r[9]))
    chosen = by_distance[: len(scripted)]
    if len(chosen) < len(scripted):
        raise SystemExit(f"NetOps has only {len(chosen)} sites; the scenario needs {len(scripted)}.")
    pairs = zip(sorted(scripted, key=lambda t: (t.lat, t.lng)), sorted(chosen, key=lambda r: (r[8], r[9])), strict=True)
    placed = {t.enodeb: site for t, site in pairs}
    chosen_ids = {site[0] for site in chosen}

    kpi = {sid: (prb, drop, thr) for sid, prb, drop, thr in kpi_rows}
    band_cells: dict[tuple[str, str], list[tuple[Any, Any, Any]]] = {}
    for sid, band, azimuth, e_tilt, m_tilt in cell_rows:
        band_cells.setdefault((sid, band), []).append((azimuth, e_tilt, m_tilt))

    used: set[str] = set(placed)
    towers: list[gen.TowerRow] = []
    cluster_rows: list[gen.TowerRow] = []
    cells: dict[str, list[tuple[str, str, str, int, float]]] = {}
    forced: dict[str, Forced] = {}
    links: list[tuple[str, str, int, str]] = []

    def row_for(site: tuple[Any, ...], enodeb: str) -> gen.TowerRow:
        sid, sname, vendor, stype, state, cid, cname, _enb, lat, lng, _status, _m = site
        return gen.TowerRow(
            enodeb_name=enodeb,
            site_id=site_id_for(enodeb),
            name=sname,
            town=cname,
            state=STATE_MAP.get(state, state),
            lat=round(lat, 5),
            lng=round(lng, 5),
            tower_type=TYPE_MAP.get(stype, "macro"),
            vendor=vendor,
            firmware=rng.choice(gen.FIRMWARE),
        )

    def add_cells(site: tuple[Any, ...], enodeb: str) -> None:
        rows = []
        for freq, menara_band in BAND_MAP.items():
            group = band_cells.get((site[0], freq))
            if group:
                azimuth, e_tilt, m_tilt = group[0]
                rows.append(
                    (cell_id_for(enodeb, menara_band), enodeb, menara_band, int(round(azimuth or 0)) % 360, _tilt(e_tilt, m_tilt))
                )
        if not rows:  # a site with no cell records still needs one
            rows.append((cell_id_for(enodeb, "B5"), enodeb, "B5", 0, 4.0))
        cells[enodeb] = rows

    def add_state(site: tuple[Any, ...], enodeb: str) -> None:
        status = {"Out of Service": "DOWN", "Plan Maintenance": "DEGRADED"}.get(site[10], "UP")
        prb, drop, thr = kpi.get(site[0], (None, None, None))
        prb = min(95.0, max(5.0, prb if prb is not None else 40.0))
        if site[10] == "Congested":
            prb = max(prb, CONGESTED_MIN_PRB)
        forced[enodeb] = Forced(status, (round(prb, 1), round(drop if drop is not None else 0.7, 2), round(thr if thr is not None else 25.0, 1)))

    for enodeb, site in placed.items():
        cluster_rows.append(row_for(site, enodeb))
        add_cells(site, enodeb)
        # the scripted incident drives these towers' status and KPI; only the NetOps identity is kept
        links.append((enodeb, site[0], int(site[7]), site[5]))

    for site in sites:
        if site[0] in chosen_ids:
            continue
        code = clusters[site[5]]["code"]
        digits = int(re.sub(r"\D", "", site[0]) or 0) % 10000
        while f"{code}-{digits:04d}" in used:
            digits = (digits + 1) % 10000
        enodeb = f"{code}-{digits:04d}"
        used.add(enodeb)
        towers.append(row_for(site, enodeb))
        add_cells(site, enodeb)
        add_state(site, enodeb)
        links.append((enodeb, site[0], int(site[7]), site[5]))

    towns = [
        (c["code"], c["name"], c["state"], round(c["clat"], 4), round(c["clng"], 4), len(c["lat"]), 5.0)
        for _cid, c in sorted(clusters.items())
    ]
    urban = {c["code"] for c in clusters.values() if c["morph"] in ("Dense Urban", "Urban")}

    anchored = scenario.model_copy(deep=True)
    _shift(anchored, anchor["clat"] - s_lat, anchor["clng"] - s_lng)
    anchored.cluster.town = anchor["name"]
    anchored.cluster.state = anchor["state"]
    for tower in anchored.cluster.towers:
        site = placed[tower.enodeb]
        tower.lat, tower.lng = round(site[8], 5), round(site[9], 5)

    return NetopsLink(towers, cluster_rows, cells, forced, towns, urban, links, anchored)


@contextmanager
def use_towns(link: NetopsLink) -> Iterator[None]:
    """Point the town-based builders (weather, grid, flood, sites, malls) at the NetOps clusters, then restore."""
    saved_towns = list(gen.TOWNS)
    saved_urban = (set(gen.URBAN_CODES), set(site_seed.URBAN_CODES))
    gen.TOWNS[:] = link.towns
    for target in (gen.URBAN_CODES, site_seed.URBAN_CODES):
        target.clear()
        target.update(link.urban_codes)
    try:
        yield
    finally:
        gen.TOWNS[:] = saved_towns
        gen.URBAN_CODES.clear()
        gen.URBAN_CODES.update(saved_urban[0])
        site_seed.URBAN_CODES.clear()
        site_seed.URBAN_CODES.update(saved_urban[1])