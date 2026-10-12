"""FastMCP server for the network-operations tools over the synthetic DuckDB dataset.

    uv run python -m netops_mcp.server                 # stdio (Claude Desktop / Code)
    uv run python -m netops_mcp.server --http          # MCP on 127.0.0.1:8000/mcp + REST on /api, /docs
    uv run python -m netops_mcp.server --http --search # also collapse the MCP listing into BM25 tool search
"""

import argparse

from fastmcp import FastMCP
from fastmcp.server.transforms.search import BM25SearchTransform
from fastmcp.tools import Tool

from netops_mcp import config
from netops_mcp.errors import safe_tool
from netops_mcp.rest import add_rest_routes
from netops_mcp.tools import ALL_TOOLS

INSTRUCTIONS = """Network-operations tools (Unifi Mobile, Malaysia) backed by a synthetic DuckDB dataset.
Coordinates are WGS84; 'lat,lng' strings put latitude first. Radius parameters are in km.
Paginated tools return {total, page, page_size, total_pages, items}; layer tools return GeoJSON.
Failures come back as {"ok": false, "error": {"code", "message"}} instead of raising.
Sample identifiers: IMSI 502153000002017, MSISDN 601110002356, 4G site from get_sites(technology='4g').
search_locations is the exception: it searches REAL Malaysian places and areas (Overture Maps), so use it to
turn a place name into coordinates before calling radius/coordinate tools. The *_admin_area(s)/get_admin_boundary
tools are also real: Malaysian state, district and mukim boundaries (geoBoundaries). Use lookup_admin_area to tag
coordinates (e.g. sites) with their state/district/mukim, and get_admin_boundary for polygons to draw or filter by."""


class _NetopsSearch(BM25SearchTransform):
    """BM25 search whose synthetic tools say what NetOps covers; FastMCP's stock "Search for tools
    using natural language" gives small models no reason to pick it over the map tools."""

    def _make_search_tool(self) -> Tool:
        return super()._make_search_tool().model_copy(
            update={
                "description": "Find network-operations tools (Unifi Mobile, Malaysia): 4G/5G sites and cells, "
                "RAN KPIs, worst and congested cells, coverage, VIP/NTT/CTT tickets, subscribers and "
                "next-best-action, BINs, Malaysian place search and state/district/mukim boundaries. "
                "Describe the task in plain words; returns the matching tools' names and parameters. "
                f"Use this for any network data question, then run the chosen tool with {self._call_tool_name}."
            }
        )

    def _make_call_tool(self) -> Tool:
        return super()._make_call_tool().model_copy(
            update={
                "description": f"Run a tool found with {self._search_tool_name}, passing its name and arguments "
                "exactly as listed there."
            }
        )


def build(search: bool = False) -> FastMCP:
    mcp = FastMCP("netops", instructions=INSTRUCTIONS)
    if search:
        # BM25 tool search: list_tools() collapses to netops_search_tools +
        # netops_call_tool so agents discover tools on demand. The prefix keeps
        # the names unique next to the Menara servers' own search tools.
        mcp.add_transform(_NetopsSearch(search_tool_name="netops_search_tools", call_tool_name="netops_call_tool"))
    for fn in ALL_TOOLS:
        mcp.tool(safe_tool(fn))
    return mcp


mcp = build()


def main() -> None:
    parser = argparse.ArgumentParser(description="NetOps MCP server")
    parser.add_argument("--http", action="store_true", help="serve streamable HTTP instead of stdio")
    parser.add_argument("--host", default=config.HTTP_HOST)
    parser.add_argument("--port", type=int, default=config.HTTP_PORT)
    parser.add_argument("--search", action="store_true", help="enable BM25 tool-search transform")
    args = parser.parse_args()
    server = build(search=True) if args.search else mcp
    if args.http:
        host = "127.0.0.1" if args.host in ("0.0.0.0", "::") else args.host
        config.PUBLIC_URL = config.PUBLIC_URL or f"http://{host}:{args.port}"
        add_rest_routes(server, catalog=mcp)
        server.run(transport="http", host=args.host, port=args.port)
    else:
        server.run()


if __name__ == "__main__":
    main()
