"""Repairs: a finished field job or a reset of a hung cell brings a faulty tower back UP."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from menara_core import clock, repairs
from menara_core.db import connect
from menara_core.testing import build_test_db

AT = "2026-11-14T07:12:00+08:00"


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    db = build_test_db(tmp_path)
    c = connect(db, owned_tables={"tower_state", "tower_alarm", "field_job", "ran_change", "ran_change_item"})
    yield c
    c.close()


def _up_tower(conn: sqlite3.Connection, now: int) -> str:
    for row in conn.execute("SELECT enodeb_name FROM tower ORDER BY enodeb_name"):
        state = conn.execute(
            "SELECT status FROM tower_state WHERE enodeb_name = ? AND t_min <= ? ORDER BY t_min DESC LIMIT 1",
            (row["enodeb_name"], now),
        ).fetchone()
        alarms = conn.execute("SELECT 1 FROM tower_alarm WHERE enodeb_name = ?", (row["enodeb_name"],)).fetchone()
        if state and state["status"] == "UP" and alarms is None:
            return str(row["enodeb_name"])
    raise AssertionError("no healthy tower in the test data")


def _fault(conn: sqlite3.Connection, name: str, now: int, code: str) -> None:
    conn.execute("INSERT INTO tower_state VALUES (?, ?, 'DEGRADED', 90, 1)", (name, now - 30))
    conn.execute("INSERT INTO tower_alarm VALUES (?, ?, ?, 'MAJOR', 'test fault', ?, NULL)", (f"ALM-T-{code}", name, code, now - 30))


def _reset(conn: sqlite3.Connection, name: str, at: int) -> None:
    conn.execute(
        "INSERT INTO ran_change (change_id, action, status, applied_min, applied_at, approved_by, reason) "
        "VALUES ('CHG-T1', 'ran_reset_cell', 'COMPLETED', ?, ?, 'test', 'test')",
        (at, AT),
    )
    conn.execute("INSERT INTO ran_change_item VALUES ('CHG-T1', ?, ?, 0, 1.0, 1)", (name, f"{name}-B5"))


def _job(conn: sqlite3.Connection, name: str, at: int, eta: int) -> None:
    tech = conn.execute("SELECT tech_id FROM technician LIMIT 1").fetchone()["tech_id"]
    conn.execute(
        "INSERT INTO field_job (job_id, tech_id, enodeb_name, task, skill, dispatched_min, dispatched_at, eta_min, access, approved_by, reason) "
        "VALUES ('JOB-T1', ?, ?, 'fix it', 'RAN', ?, ?, ?, 'ROAD', 'test', 'test')",
        (tech, name, at, AT, eta),
    )


def test_healthy_tower_needs_no_repair(conn: sqlite3.Connection) -> None:
    now = clock.now_min(conn)
    name = _up_tower(conn, now)
    assert repairs.repaired_min(conn, name, now) is None
    assert repairs.status(conn, name, now, "UP") == "UP"


def test_reset_clears_a_hung_cell(conn: sqlite3.Connection) -> None:
    now = clock.now_min(conn)
    name = _up_tower(conn, now)
    _fault(conn, name, now, "CELL_HUNG")
    assert repairs.status(conn, name, now, "DEGRADED") == "DEGRADED"
    _reset(conn, name, now)
    assert repairs.repaired_min(conn, name, now) == now
    assert repairs.status(conn, name, now, "DEGRADED") == "UP"
    assert repairs.alarm_cleared_min(conn, name, now, now - 30) == now


def test_reset_does_not_fix_a_broken_link(conn: sqlite3.Connection) -> None:
    now = clock.now_min(conn)
    name = _up_tower(conn, now)
    _fault(conn, name, now, "LINK_DOWN")
    _reset(conn, name, now)
    assert repairs.status(conn, name, now, "DEGRADED") == "DEGRADED"


def test_field_job_repairs_once_the_work_is_done(conn: sqlite3.Connection) -> None:
    now = clock.now_min(conn)
    name = _up_tower(conn, now)
    _fault(conn, name, now, "LINK_DOWN")
    _job(conn, name, now, eta=40)
    done = now + 40 + repairs.FIELD_WORK_MIN
    assert repairs.status(conn, name, done - 1, "DEGRADED") == "DEGRADED"
    assert repairs.repaired_min(conn, name, done) == done
    assert repairs.status(conn, name, done, "DEGRADED") == "UP"


def test_repair_before_the_fault_does_not_count(conn: sqlite3.Connection) -> None:
    now = clock.now_min(conn)
    name = _up_tower(conn, now)
    _reset(conn, name, now - 60)
    _fault(conn, name, now, "CELL_HUNG")
    assert repairs.status(conn, name, now, "DEGRADED") == "DEGRADED"