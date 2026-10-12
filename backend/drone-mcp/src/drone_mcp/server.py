"""drone-mcp server. Run: `uv run --package drone-mcp python -m drone_mcp [--transport streamable-http --port 8110]`."""

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

from drone_mcp import tools

NAME = "drone"
DEFAULT_PORT = 8110
INSTRUCTIONS = (
    "Simulated drones that inspect towers. ALL DATA IS SYNTHETIC; vision findings are canned, not from a real "
    "model. A dispatch needs a signed policy_token from policy-mcp for action drone_dispatch on that tower. "
    "Flight and inspection follow the scenario clock, so findings appear only after the clock reaches the "
    "end of the inspection. Every response has evidence[] naming the call that produced it."
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

    @mcp.tool(description="Drones with their depot and whether they are idle or out on a mission, and when they are free.")
    def drone_list_drones() -> dict[str, Any]:
        return run(tools.list_drones)

    @mcp.tool(
        description="Dispatch the nearest idle drone (within 150 km) to inspect a tower. Needs a policy_token for "
        "action drone_dispatch on that tower. Returns the mission with its flight time."
    )
    def drone_dispatch(enodeb_name: str, policy_token: str, reason: str = "") -> dict[str, Any]:
        return run(lambda conn: tools.dispatch(conn, enodeb_name, policy_token, reason))

    @mcp.tool(
        description="A mission: status (EN_ROUTE, ON_SITE, COMPLETE), progress, arrival and completion times, and "
        "once complete the structured findings (access road, tower structure, antenna, power cabinet, genset, hazards)."
    )
    def drone_get_mission(mission_id: str) -> dict[str, Any]:
        return run(lambda conn: tools.get_mission(conn, mission_id))

    @mcp.tool(description="Missions, newest first. Optional status (EN_ROUTE, ON_SITE, COMPLETE) and tower filters.")
    def drone_list_missions(
        status: str | None = None, enodeb_name: str | None = None, limit: int = 50
    ) -> dict[str, Any]:
        return run(lambda conn: tools.list_missions(conn, status, enodeb_name, limit))

    return mcp


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="drone-mcp", description=__doc__)
    parser.add_argument("--transport", choices=["stdio", "streamable-http"], default="stdio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--search", action="store_true", help="collapse the tool list into BM25 search + call tools")
    parser.add_argument("--db", type=Path, default=None)
    args = parser.parse_args(argv)
    serve(build_server(args.db or settings.db_path(), search=args.search), args.transport, args.host, args.port)


if __name__ == "__main__":
    main()
