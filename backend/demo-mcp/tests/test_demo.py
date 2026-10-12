from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import Callable
from pathlib import Path

import pytest
from demo_mcp import tools
from demo_mcp.server import build_server
from menara_core.errors import InvalidInputError


def test_server_registers_the_four_tools(db_file: Path) -> None:
    listed = asyncio.run(build_server(db_file).list_tools())
    assert {t.name for t in listed} == {"demo_get_clock", "demo_advance_clock", "demo_set_clock", "demo_reset"}


def test_advance_moves_the_clock_forward(conn: sqlite3.Connection, set_clock: Callable[[int], None]) -> None:
    set_clock(0)
    assert tools.advance_clock(conn, 65).data.t_min == 65
    assert tools.get_clock(conn).data.t_min == 65  # persisted, so every other server sees it
    assert tools.advance_clock(conn, 10).data.t_min == 75


def test_set_clock_and_bounds(conn: sqlite3.Connection, set_clock: Callable[[int], None]) -> None:
    set_clock(0)
    assert tools.set_clock(conn, -60).data.t_min == -60
    for bad in (0, 1441, -1):
        with pytest.raises(InvalidInputError):
            tools.advance_clock(conn, bad)
    with pytest.raises(InvalidInputError):
        tools.set_clock(conn, 5000)


def test_reset_restores_the_default_clock(conn: sqlite3.Connection, db_file: Path, set_clock: Callable[[int], None]) -> None:
    tools.set_clock(conn, 500)
    result = tools.reset(conn, db_file)
    assert result.data.clock.t_min == 0
    assert "incident" in result.data.cleared