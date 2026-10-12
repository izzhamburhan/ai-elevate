"""demo-mcp tool logic: read, move and reset the scenario clock."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from menara_core import clock, settings
from menara_core.envelope import Envelope, wrap
from menara_core.errors import InvalidInputError
from menara_core.reset import reset_runtime_state
from menara_core.scenario import load_scenario

from demo_mcp.models import ClockState, ResetResult

SOURCE = "demo-mcp"
OWNED_TABLES: frozenset[str] = frozenset({"scenario_state"})
MAX_ADVANCE_MIN = 1440
MIN_SET_MIN, MAX_SET_MIN = -1440, 4320


def _state(conn: sqlite3.Connection) -> ClockState:
    return ClockState(t_min=clock.now_min(conn), at=clock.as_of(conn))


def get_clock(conn: sqlite3.Connection) -> Envelope[ClockState]:
    return wrap(conn, source=SOURCE, tool="demo_get_clock", data=_state(conn))


def advance_clock(conn: sqlite3.Connection, minutes: int) -> Envelope[ClockState]:
    if not 1 <= minutes <= MAX_ADVANCE_MIN:
        raise InvalidInputError(f"minutes must be between 1 and {MAX_ADVANCE_MIN}")
    clock.set_now(conn, clock.now_min(conn) + minutes)
    return wrap(conn, source=SOURCE, tool="demo_advance_clock", data=_state(conn))


def set_clock(conn: sqlite3.Connection, t_min: int) -> Envelope[ClockState]:
    if not MIN_SET_MIN <= t_min <= MAX_SET_MIN:
        raise InvalidInputError(f"t_min must be between {MIN_SET_MIN} and {MAX_SET_MIN}")
    clock.set_now(conn, t_min)
    return wrap(conn, source=SOURCE, tool="demo_set_clock", data=_state(conn))


def reset(conn: sqlite3.Connection, db_path: Path) -> Envelope[ResetResult]:
    """Clear runtime rows and restore the clock. Uses its own connection, so the caller's stays read-only."""
    cleared = reset_runtime_state(db_path, load_scenario(settings.default_scenario_path()))
    return wrap(
        conn, source=SOURCE, tool="demo_reset", data=ResetResult(cleared=cleared, clock=_state(conn))
    )