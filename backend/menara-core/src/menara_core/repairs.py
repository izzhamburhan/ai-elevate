"""Repairs bring a faulty tower back. Readers of a tower's status and alarms apply this overlay.

The seeded `tower_state` and `tower_alarm` are the history the world was given. Two sandboxed actions repair a tower:
a field job that has finished (field-mcp's `field_job`: EN_ROUTE until its ETA, then FIELD_WORK_MIN on site) and a
soft reset of a hung cell (ran-mcp's `ran_reset_cell` change), which only clears a CELL_HUNG fault. A repair counts
when it happened during the tower's current fault. The seeded KPIs only know the outage (no traffic), so a dead sample
taken after the repair reads as the tower's normal traffic (`restored_kpi`, applied by `kpi_overlay.adjust`).
Nothing here writes; the owners keep their tables.
All data is synthetic.
"""

from __future__ import annotations

import sqlite3

FIELD_WORK_MIN = 90  # how long a crew works on site before the job is done
RESETTABLE = frozenset({"CELL_HUNG"})  # faults a soft reset clears
DAY_MIN = 24 * 60


def _fault_start(conn: sqlite3.Connection, name: str, now: int) -> int | None:
    """When the fault the tower is in at `now` began, or None when its seeded state is UP."""
    start = None
    for row in conn.execute(
        "SELECT t_min, status FROM tower_state WHERE enodeb_name = ? AND t_min <= ? ORDER BY t_min DESC", (name, now)
    ):
        if row["status"] == "UP":
            break
        start = int(row["t_min"])
    return start


def _active_codes(conn: sqlite3.Connection, name: str, now: int) -> set[str]:
    return {
        str(r["code"])
        for r in conn.execute(
            "SELECT code FROM tower_alarm WHERE enodeb_name = ? AND raised_min <= ? AND (cleared_min IS NULL OR cleared_min > ?)",
            (name, now, now),
        )
    }


def repaired_min(conn: sqlite3.Connection, name: str, now: int) -> int | None:
    """The minute the tower's current fault was repaired, if it was by `now`."""
    start = _fault_start(conn, name, now)
    if start is None:
        return None
    fixes: list[int] = []
    job = conn.execute(
        "SELECT MIN(dispatched_min + eta_min + :work) FROM field_job "
        "WHERE enodeb_name = :name AND dispatched_min >= :start AND dispatched_min + eta_min + :work <= :now",
        {"work": FIELD_WORK_MIN, "name": name, "start": start, "now": now},
    ).fetchone()[0]
    if job is not None:
        fixes.append(int(job))
    codes = _active_codes(conn, name, now)
    if codes and codes <= RESETTABLE:
        reset = conn.execute(
            "SELECT MIN(c.applied_min) FROM ran_change c JOIN ran_change_item i ON i.change_id = c.change_id "
            "WHERE c.action = 'ran_reset_cell' AND i.enodeb_name = ? AND c.applied_min >= ? AND c.applied_min <= ?",
            (name, start, now),
        ).fetchone()[0]
        if reset is not None:
            fixes.append(int(reset))
    return min(fixes) if fixes else None


def status(conn: sqlite3.Connection, name: str, now: int, seeded: str) -> str:
    """The tower's status at `now` after repairs: a repaired fault reads UP."""
    if seeded == "UP":
        return seeded
    return "UP" if repaired_min(conn, name, now) is not None else seeded


def alarm_cleared_min(conn: sqlite3.Connection, name: str, now: int, raised_min: int) -> int | None:
    """When a repair cleared an alarm that the seed leaves open, or None."""
    fixed = repaired_min(conn, name, now)
    return fixed if fixed is not None and raised_min <= fixed else None


def restored_kpi(
    conn: sqlite3.Connection, name: str, t_min: int, prb: float, drop: float, thr: float
) -> tuple[float, float, float]:
    """A sample with no traffic, taken once the tower was repaired, reads as its live sample nearest the same time a
    day earlier (so the daily load curve holds). Any other sample is returned as is."""
    if prb > 0 or thr > 0 or repaired_min(conn, name, t_min) is None:
        return prb, drop, thr
    row = conn.execute(
        "SELECT prb_util, drop_rate, throughput_mbps FROM tower_kpi "
        "WHERE enodeb_name = ? AND t_min < ? AND (prb_util > 0 OR throughput_mbps > 0) ORDER BY ABS(t_min - ?) LIMIT 1",
        (name, t_min, t_min - DAY_MIN),
    ).fetchone()
    return (row["prb_util"], row["drop_rate"], row["throughput_mbps"]) if row else (prb, drop, thr)
