"""demo-mcp server. Run: `uv run --package demo-mcp python -m demo_mcp [--transport streamable-http --port 8124]`."""

from __future__ import annotations

import argparse
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastmcp import FastMCP
from menara_core import settings
from menara_core.db import connect
from menara_core.envelope import Envelope
from menara_core.mcp_server import add_tool_search, serve

from demo_mcp import tools

NAME = "demo"
DEFAULT_PORT = 8124
INSTRUCTIONS = (
    "DEMO ONLY. The scenario clock of the synthetic data: read it, or move it forward so slow things (a drone "
    "inspection, watching a RAN change) can finish. Use demo_advance_clock only to wait for something you "
    "already started. ALL DATA IS SYNTHETIC."
)


def build_server(db_path: Path, *, search: bool = False) -> FastMCP:
    mcp = FastMCP(NAME, instructions=INSTRUCTIONS)
    if search:
        add_tool_search(mcp, NAME)

    def run(call: Callable[[Any], Envelope[Any]]) -> dict[str, Any]:
        conn = connect(db_path, owned_tables=tools.OWNED_TABLES)
        try:
            return call(conn).model_dump(mode="json")
        finally:
            conn.close()

    @mcp.tool(description="The current scenario time: minutes since T0 (negative = before) and the timestamp.")
    def demo_get_clock() -> dict[str, Any]:
        return run(tools.get_clock)

    @mcp.tool(
        description="DEMO ONLY. Moves the scenario clock forward by `minutes` (1 to 1440) so slow things can "
        "finish. Use it only to wait for something you have already started."
    )
    def demo_advance_clock(minutes: int) -> dict[str, Any]:
        return run(lambda conn: tools.advance_clock(conn, minutes))

    @mcp.tool(description="DEMO ONLY. Sets the scenario clock to t_min (-1440 to 4320 minutes from T0).")
    def demo_set_clock(t_min: int) -> dict[str, Any]:
        return run(lambda conn: tools.set_clock(conn, t_min))

    @mcp.tool(
        description="DEMO ONLY. Clears every runtime row (incidents, approvals, RAN changes, drone missions, ...) "
        "and puts the clock and policy settings back to their defaults."
    )
    def demo_reset() -> dict[str, Any]:
        return run(lambda conn: tools.reset(conn, db_path))

    return mcp


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="demo-mcp", description=__doc__)
    parser.add_argument("--transport", choices=["stdio", "streamable-http"], default="stdio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--search", action="store_true", help="collapse the tool list into BM25 search + call tools")
    parser.add_argument("--db", type=Path, default=None)
    args = parser.parse_args(argv)
    serve(build_server(args.db or settings.db_path(), search=args.search), args.transport, args.host, args.port)


if __name__ == "__main__":
    main()
