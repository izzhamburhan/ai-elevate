"""ticket-mcp server. Run: `uv run --package ticket-mcp python -m ticket_mcp [--transport streamable-http --port 8102]`."""

from __future__ import annotations

import argparse
import sqlite3
from collections.abc import Callable
from contextlib import closing
from pathlib import Path
from typing import Any

from fastmcp import FastMCP
from menara_core import settings
from menara_core.db import connect
from menara_core.envelope import Envelope
from menara_core.mcp_server import add_tool_search, serve
from menara_core.seed.schema import upgrade

from ticket_mcp import tools

NAME = "ticket"
DEFAULT_PORT = 8102
INSTRUCTIONS = (
    "UniFi Mobile support tickets for Malaysia. ALL DATA IS SYNTHETIC. "
    "Tickets appear only once the scenario clock reaches their creation time. "
    "customer_ref is a hashed MSISDN: pass it to the user MCP. Network Trouble Tickets (NTTs) group the customer tickets "
    "of one network fault; resolving an NTT resolves its linked tickets. The tools that write only add notes, resolutions and NTTs."
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

    @mcp.tool(description="One ticket with its notes: category, status, location text, geocoded lat/lng, customer_ref (hashed).")
    def ticket_get_ticket(ticket_id: str) -> dict[str, Any]:
        return run(lambda conn: tools.get_ticket(conn, ticket_id))

    @mcp.tool(
        description="Cluster tickets around an anchor ticket: those within radius_km and +/- window_min of it. "
        "Returns the total count, time span, centroid, top locations and the tickets."
    )
    def ticket_cluster_by_location(
        ticket_id: str, radius_km: float = 15.0, window_min: int = 60, limit: int = 100
    ) -> dict[str, Any]:
        return run(lambda conn: tools.cluster_by_location(conn, ticket_id, radius_km, window_min, limit))

    @mcp.tool(
        description="Open tickets (not resolved, already raised) within radius_km of a tower (default 3 km, about its "
        "coverage area), optionally only those raised at or after `since` (ISO time, e.g. when the fault began): the "
        "customers an outage there reaches. Use it to find the tickets to link to an NTT."
    )
    def ticket_list_open_near_tower(
        enodeb_name: str, radius_km: float = tools.NEAR_TOWER_KM, since: str | None = None, limit: int = 200
    ) -> dict[str, Any]:
        return run(lambda conn: tools.open_near_tower(conn, enodeb_name, radius_km, since, limit))

    @mcp.tool(description="Append a note (max 1000 chars) to a ticket.")
    def ticket_add_note(ticket_id: str, text: str, author: str = "agent") -> dict[str, Any]:
        return run(lambda conn: tools.add_note(conn, ticket_id, text, author))

    @mcp.tool(
        description="Close tickets (up to 200), for example the whole cluster of an incident once service is back. "
        "Adds a 'Resolved' note to each. Already-resolved tickets are skipped and reported."
    )
    def ticket_resolve(ticket_ids: list[str], note: str, resolved_by: str = "agent") -> dict[str, Any]:
        return run(lambda conn: tools.resolve(conn, ticket_ids, note, resolved_by))

    @mcp.tool(
        description="Create a Network Trouble Ticket (NTT) bound to a Network Element (tower or feeder). "
        "Auto-deduplicates: if active NTT exists for the NE, reuses it and links any new CTTs. Pass fault_began_at "
        "(ISO time, e.g. the first alarm) when the fault started before the NTT: the MCMC outage time counts from it."
    )
    def ticket_create_ntt(
        network_element_id: str,
        fault_type: str,
        severity: str,
        summary: str,
        ctt_ticket_ids: list[str] | None = None,
        fault_began_at: str | None = None,
    ) -> dict[str, Any]:
        return run(
            lambda conn: tools.create_ntt(
                conn, network_element_id, fault_type, severity, summary, ctt_ticket_ids, fault_began_at
            )
        )

    @mcp.tool(description="Get full details of a Network Trouble Ticket (NTT) by ID, including linked CTTs and notes.")
    def ticket_get_ntt(ntt_id: str) -> dict[str, Any]:
        return run(lambda conn: tools.get_ntt(conn, ntt_id))

    @mcp.tool(description="List Network Trouble Tickets (NTTs), optionally filtered by status or Network Element ID.")
    def ticket_list_ntts(
        status: str | None = None,
        network_element_id: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        return run(lambda conn: tools.list_ntts(conn, status, network_element_id, limit))

    @mcp.tool(description="Link one or more Customer Trouble Tickets (CTTs) to a parent Network Trouble Ticket (NTT).")
    def ticket_link_ctts(ntt_id: str, ctt_ticket_ids: list[str]) -> dict[str, Any]:
        return run(lambda conn: tools.link_ctts(conn, ntt_id, ctt_ticket_ids))

    @mcp.tool(description="Unlink a Customer Trouble Ticket (CTT) from a Network Trouble Ticket (NTT).")
    def ticket_unlink_ctt(ntt_id: str, ctt_ticket_id: str) -> dict[str, Any]:
        return run(lambda conn: tools.unlink_ctt(conn, ntt_id, ctt_ticket_id))

    @mcp.tool(
        description="Resolve a Network Trouble Ticket (NTT). Automatically cascades resolution to all linked CTTs and checks MCMC notification conditions."
    )
    def ticket_resolve_ntt(
        ntt_id: str, resolution_note: str, resolved_by: str = "agent"
    ) -> dict[str, Any]:
        return run(lambda conn: tools.resolve_ntt(conn, ntt_id, resolution_note, resolved_by))

    @mcp.tool(
        description="Check eligibility for a SIMULATED MCMC closure notice and report for an NTT (invented demo rules: outage duration, severity, fault type). Nothing is sent."
    )
    def ticket_check_mcmc(ntt_id: str) -> dict[str, Any]:
        return run(lambda conn: tools.check_mcmc(conn, ntt_id))

    return mcp


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="ticket-mcp", description=__doc__)
    parser.add_argument("--transport", choices=["stdio", "streamable-http"], default="stdio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--search", action="store_true", help="collapse the tool list into BM25 search + call tools")
    parser.add_argument("--db", type=Path, default=None)
    args = parser.parse_args(argv)
    db = args.db or settings.db_path()
    if db.exists():
        # this server owns the ntt tables: bring an older menara.db up to the current columns before serving
        with closing(sqlite3.connect(db)) as conn:
            upgrade(conn)
    serve(build_server(db, search=args.search), args.transport, args.host, args.port)


if __name__ == "__main__":
    main()
