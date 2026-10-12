"""The generator: deterministic, consistent with NetOps, and the scenarios are really in the data."""

from __future__ import annotations

import json
from pathlib import Path

import duckdb
from netintel_mcp import seed


def _con(path: Path) -> duckdb.DuckDBPyConnection:
    return duckdb.connect(str(path), read_only=True)


def test_same_input_and_seed_give_the_same_data(netops_db: Path, intel_db: Path, tmp_path: Path) -> None:
    again = tmp_path / "again.duckdb"
    seed.build(netops_db, again)
    a, b = _con(intel_db), _con(again)
    for table in ("kpi_hourly", "complaint", "alarm", "outage", "maintenance", "scenario", "event", "transport_link"):
        query = f"SELECT count(*), sum(hash(t)) FROM {table} t"
        assert a.execute(query).fetchone() == b.execute(query).fetchone(), table


def test_hourly_rows_cover_every_cell_for_the_window(intel_db: Path) -> None:
    con = _con(intel_db)
    cells = con.execute("SELECT count(*) FROM cell").fetchone()[0]
    assert con.execute("SELECT count(*) FROM kpi_hourly").fetchone()[0] == cells * seed.DAYS * 24
    first, last = con.execute("SELECT min(ts_utc), max(ts_utc) FROM kpi_hourly").fetchone()
    assert (last - first).total_seconds() == (seed.DAYS * 24 - 1) * 3600
    # local midnight of the first day is 16:00 UTC the day before
    assert first.hour == 16


def test_daily_load_follows_netops(intel_db: Path) -> None:
    """Outside the scenarios a cell's daily mean PRB stays close to its NetOps daily value (45% in the fake data)."""
    con = _con(intel_db)
    mean = con.execute(
        "SELECT avg(prb_dl_pct) FROM kpi_hourly WHERE site_id = 'KP304' AND availability_pct > 0"
    ).fetchone()[0]
    assert abs(mean - 45) < 4


def test_netops_outage_takes_the_site_off_air(intel_db: Path) -> None:
    con = _con(intel_db)
    # NTT-1: 2026-10-05 10:00-14:00 MYT = 02:00-06:00 UTC
    rows = con.execute(
        "SELECT max(availability_pct), max(prb_dl_pct) FROM kpi_hourly WHERE site_id = 'KP300' "
        "AND ts_utc >= TIMESTAMP '2026-10-05 02:00' AND ts_utc < TIMESTAMP '2026-10-05 06:00'"
    ).fetchone()
    assert rows == (0.0, 0.0)
    assert con.execute("SELECT count(*) FROM alarm WHERE code = 'S1_LINK_LOST' AND site_id = 'KP300'").fetchone()[0] == 1


def test_scenarios_are_recorded(intel_db: Path) -> None:
    con = _con(intel_db)
    scenarios = {r[0]: json.loads(r[1]) for r in con.execute("SELECT scenario_id, detail FROM scenario").fetchall()}
    assert set(scenarios) == set(seed.SCENARIOS)
    evening = scenarios["SCN-EVENING-CONGESTION"]["cells"][0]
    busy, quiet = con.execute(
        "SELECT avg(prb_dl_pct) FILTER (WHERE hour(ts_utc + INTERVAL 8 HOUR) BETWEEN 19 AND 23), "
        "avg(prb_dl_pct) FILTER (WHERE hour(ts_utc + INTERVAL 8 HOUR) BETWEEN 8 AND 11) FROM kpi_hourly WHERE cell_name = ?",
        [evening],
    ).fetchone()
    assert busy >= 87 and quiet < 70
    hub = scenarios["SCN-TRANSPORT-HUB"]
    assert len(hub["sites"]) == 3 and hub["hub"] == "PJ200"
    assert con.execute("SELECT count(*) FROM complaint WHERE complaint_id LIKE 'CMP-SA-%'").fetchone()[0] == 6


def test_times_are_utc(intel_db: Path) -> None:
    con = _con(intel_db)
    # CMP complaints are written between 20:00 and 21:40 MYT, i.e. 12:00-13:40 UTC
    hours = {r[0] for r in con.execute("SELECT hour(created_utc) FROM complaint WHERE complaint_id BETWEEN 'CMP-SA-0001' AND 'CMP-SA-0005'").fetchall()}
    assert hours <= {12, 13}