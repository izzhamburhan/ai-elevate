"""twin-mcp server. Run: `uv run --package twin-mcp python -m twin_mcp [--transport streamable-http --port 8108]`."""

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

from twin_mcp import tools

NAME = "twin"
DEFAULT_PORT = 8108
INSTRUCTIONS = (
    "Digital twin: simulate a tower failure or a tilt change BEFORE acting. ALL DATA IS SYNTHETIC and the model "
    "is deliberately simple (demo formulas, not RF engineering). Each run is stored and gets a simulation id "
    "you can cite. Writes only its own simulation log. Every response has evidence[] naming the call that "
    "produced it."
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

    @mcp.tool(
        description="Simulate a tower going down: predicted load on each neighbour (overloaded at 85% PRB or more), "
        "subscribers impacted, critical sites affected and a recommendation. site is an enodeb_name or site_id."
    )
    def twin_simulate_failure(site: str) -> dict[str, Any]:
        return run(lambda conn: tools.simulate_failure(conn, site))

    @mcp.tool(
        description="Simulate tilt changes. changes is a list of {enodeb_name, tilt_delta_deg}; positive is more "
        "downtilt, within +/-8. Predicts load on the tilted towers, coverage loss and the neighbours that pick up "
        "the shed traffic, and says whether the change is recommended."
    )
    def twin_simulate_tilt(changes: list[dict[str, Any]]) -> dict[str, Any]:
        return run(lambda conn: tools.simulate_tilt(conn, changes))

    @mcp.tool(description="A stored simulation by id (SIM-0001): its parameters and result.")
    def twin_get_simulation(simulation_id: str) -> dict[str, Any]:
        return run(lambda conn: tools.get_simulation(conn, simulation_id))

    return mcp


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="twin-mcp", description=__doc__)
    parser.add_argument("--transport", choices=["stdio", "streamable-http"], default="stdio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--search", action="store_true", help="collapse the tool list into BM25 search + call tools")
    parser.add_argument("--db", type=Path, default=None)
    args = parser.parse_args(argv)
    serve(build_server(args.db or settings.db_path(), search=args.search), args.transport, args.host, args.port)


if __name__ == "__main__":
    main()
