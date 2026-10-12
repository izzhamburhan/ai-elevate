"""FastMCP server for the network-operations tools over the synthetic DuckDB dataset.

    uv run python -m netops_mcp.server                 # stdio (Claude Desktop / Code)
    uv run python -m netops_mcp.server --http          # MCP on 127.0.0.1:8000/mcp + REST on /api, /docs
    uv run python -m netops_mcp.server --http --search # also collapse the MCP listing into BM25 tool search
"""

import argparse

from fastmcp import FastMCP

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


def build(search: bool = False) -> FastMCP:
    mcp = FastMCP("netops", instructions=INSTRUCTIONS)
    if search:
        # BM25 tool search: list_tools() collapses to
        # search_tools + call_tool so agents discover tools on demand.
        from fastmcp.server.transforms.search import BM25SearchTransform
        mcp.add_transform(BM25SearchTransform())
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
