"""Seeding from NetOps: towers, cells, KPI and status come from a netops.duckdb file."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import duckdb
import pytest
from menara_core import settings
from menara_core.ids import parse_enodeb
from menara_core.scenario import load_scenario
from menara_core.seed import towers as gen
from menara_core.seed.build import build

SITES_PER_CLUSTER = 14  # the scenario needs 12 sites in one cluster


def _netops_db(path: Path) -> Path:
    conn = duckdb.connect(str(path))
    conn.execute(
        """CREATE TABLE Site4G (Site_ID VARCHAR, Site_Name VARCHAR, Vendor VARCHAR, Type VARCHAR, State VARCHAR,
           Cluster_ID VARCHAR, Cluster_Name VARCHAR, eNodeB_ID BIGINT, Latitude DOUBLE, Longitude DOUBLE, Status VARCHAR)"""
    )
    conn.execute("CREATE TABLE TM_Cluster (Cluster_ID VARCHAR, Morphology VARCHAR)")
    conn.execute(
        """CREATE TABLE Cell4G (Cell_Name VARCHAR, Site_ID VARCHAR, Freq_Band VARCHAR, Azimuth DOUBLE,
           E_Tilt VARCHAR, M_Tilt VARCHAR)"""
    )
    conn.execute(
        """CREATE TABLE network_kpi (site_id VARCHAR, provider VARCHAR, prb DOUBLE, volte_drop_rate DOUBLE,
           dl_throughput DOUBLE)"""
    )
    clusters = [
        ("CL_KN_01", "Kota Bharu", "Kelantan", 6.125, 102.24, "Urban"),
        ("CL_KL_01", "KLCC", "WP Kuala Lumpur", 3.157, 101.713, "Dense Urban"),
    ]
    n = 0
    for cid, cname, state, lat, lng, morph in clusters:
        conn.execute("INSERT INTO TM_Cluster VALUES (?, ?)", [cid, morph])
        for i in range(SITES_PER_CLUSTER):
            n += 1
            sid = f"EC{1000 + n}"
            status = {1: "Out of Service", 2: "Plan Maintenance", 3: "Congested"}.get(i, "Operational")
            conn.execute(
                "INSERT INTO Site4G VALUES (?, ?, 'Huawei', 'Macro', ?, ?, ?, ?, ?, ?, ?)",
                [sid, f"{sid}_{cname.upper().replace(' ', '')}", state, cid, cname, 100000 + n, lat + i * 0.002, lng + i * 0.002, status],
            )
            conn.execute("INSERT INTO Cell4G VALUES (?, ?, 'FDD-LTE850', 120, '3', '1')", [f"{sid}_a", sid])
            conn.execute("INSERT INTO Cell4G VALUES (?, ?, 'TDD-LTE2300', 240, '2', '0')", [f"{sid}_b", sid])
            conn.execute("INSERT INTO network_kpi VALUES (?, 'TM4G', 30, 0.5, 20)", [sid])
    conn.close()
    return path


@pytest.fixture(scope="module")
def linked(tmp_path_factory: pytest.TempPathFactory) -> sqlite3.Connection:
    folder = tmp_path_factory.mktemp("linked")
    netops = _netops_db(folder / "netops.duckdb")
    db = folder / "menara.db"
    build(db, load_scenario(settings.default_scenario_path()), seed=7, netops_db=netops)
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    return conn


def test_one_tower_per_netops_site_and_every_tower_links_back(linked: sqlite3.Connection) -> None:
    assert linked.execute("SELECT COUNT(*) FROM tower").fetchone()[0] == 2 * SITES_PER_CLUSTER
    assert linked.execute("SELECT COUNT(*) FROM netops_link").fetchone()[0] == 2 * SITES_PER_CLUSTER
    orphans = linked.execute("SELECT COUNT(*) FROM tower t LEFT JOIN netops_link l USING (enodeb_name) WHERE l.enodeb_name IS NULL").fetchone()[0]
    assert orphans == 0


def test_tower_name_is_the_netops_site_name_and_ids_stay_in_menara_format(linked: sqlite3.Connection) -> None:
    rows = linked.execute("SELECT t.enodeb_name, t.name, l.netops_site_id FROM tower t JOIN netops_link l USING (enodeb_name)").fetchall()
    for row in rows:
        parse_enodeb(row["enodeb_name"])
        assert row["name"].startswith(row["netops_site_id"] + "_")


def test_cells_come_from_netops_bands(linked: sqlite3.Connection) -> None:
    bands = {r[0] for r in linked.execute("SELECT DISTINCT band FROM cell")}
    assert bands == {"B5", "B40"}
    tilt = linked.execute("SELECT tilt_deg FROM cell WHERE band = 'B5' LIMIT 1").fetchone()[0]
    assert tilt == 4.0  # E_Tilt 3 + M_Tilt 1


def test_scripted_cluster_sits_on_real_netops_sites_in_the_nearest_cluster(linked: sqlite3.Connection) -> None:
    rows = linked.execute(
        "SELECT t.enodeb_name, t.town, l.netops_cluster_id FROM tower t JOIN netops_link l USING (enodeb_name) WHERE t.enodeb_name LIKE 'KKRI-%'"
    ).fetchall()
    assert len(rows) == 12
    assert {r["netops_cluster_id"] for r in rows} == {"CL_KN_01"}
    assert {r["town"] for r in rows} == {"Kota Bharu"}


def test_netops_status_drives_baseline_state_and_a_down_site_has_an_alarm(linked: sqlite3.Connection) -> None:
    # the 2nd site of each cluster is "Out of Service"; the scripted cluster is driven by the scenario instead
    down = {
        r[0]
        for r in linked.execute(
            """SELECT s.enodeb_name FROM tower_state s JOIN (SELECT enodeb_name, MAX(t_min) m FROM tower_state WHERE t_min <= 0
               GROUP BY enodeb_name) x ON x.enodeb_name = s.enodeb_name AND x.m = s.t_min WHERE s.status = 'DOWN'"""
        )
    }
    klcc_down = {n for n in down if not n.startswith("KKRI")}
    assert len(klcc_down) == 1
    assert linked.execute("SELECT COUNT(*) FROM tower_alarm WHERE enodeb_name = ?", [next(iter(klcc_down))]).fetchone()[0] == 1


def test_building_from_netops_does_not_leak_into_the_default_towns(linked: sqlite3.Connection) -> None:
    assert len(gen.TOWNS) == 26 and gen.TOWNS[0][0] == "KULP"
    assert "KULP" in gen.URBAN_CODES