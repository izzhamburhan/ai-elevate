"""dosm-mcp server. Run: `uv run --package dosm-mcp python -m dosm_mcp [--transport streamable-http --port 8123]`.

Serves the DuckDB built by `python -m dosm_mcp.download`; it never calls DOSM itself, so tools are fast and offline.
"""

from __future__ import annotations

import argparse
from collections.abc import Callable
from pathlib import Path
from typing import Any, Literal

import duckdb
from fastmcp import FastMCP
from menara_core.envelope import Envelope
from menara_core.errors import DatabaseNotSeededError
from menara_core.mcp_server import add_tool_search, serve

from dosm_mcp import tools
from dosm_mcp.db import DB_PATH, connect

NAME = "dosm"
DEFAULT_PORT = 8123
INSTRUCTIONS = (
    "Official Malaysian statistics from DOSM (Department of Statistics Malaysia, OpenDOSM): about 200 datasets on "
    "population, household income, poverty, labour force, CPI and inflation, GDP, trade, industrial production, "
    "internet access and PriceCatcher retail prices, by state and district where published. REAL DATA cached "
    "locally. Read-only. Find a dataset with dosm_search_datasets, read its columns and values with "
    "dosm_describe_dataset, then fetch rows with dosm_query_dataset or dosm_sql. Every response has evidence[] "
    "naming the call that produced it."
)


def build_server(db_path: Path = DB_PATH, *, search: bool = False) -> FastMCP:
    mcp = FastMCP(NAME, instructions=INSTRUCTIONS)
    if search:
        add_tool_search(mcp, NAME)

    def run(call: Callable[[duckdb.DuckDBPyConnection], Envelope[Any]]) -> dict[str, Any]:
        if not db_path.exists():
            raise DatabaseNotSeededError(f"{db_path} not found. Run: uv run python -m dosm_mcp.download")
        conn = connect(db_path)
        try:
            return call(conn).model_dump(mode="json")
        finally:
            conn.close()

    @mcp.tool(
        description="Search the DOSM dataset catalogue by keywords (English), e.g. 'household income district', "
        "'inflation', 'unemployment youth', 'internet access'. Optional filters: category (e.g. Demography, Prices, "
        "Labour Markets, Households, National Accounts), geography (NATIONAL, STATE, DISTRICT, PARLIMEN, DUN) and "
        "frequency (MONTHLY, QUARTERLY, YEARLY). An empty query lists everything. Returns dataset_id, title, "
        "coverage years, last_updated and row count, plus dataset counts per category."
    )
    def dosm_search_datasets(
        query: str = "",
        category: str | None = None,
        geography: str | None = None,
        frequency: str | None = None,
        limit: int = 20,
    ) -> dict[str, Any]:
        return run(lambda conn: tools.search_datasets(conn, query, category, geography, frequency, limit))

    @mcp.tool(
        description="Everything needed to query one DOSM dataset: description, every column with its type, meaning "
        "and the values it takes (e.g. the states, sex 'both'/'male'/'female', age groups, series codes), date "
        "range, the latest rows, methodology and caveats. Call this before dosm_query_dataset or dosm_sql."
    )
    def dosm_describe_dataset(dataset_id: str) -> dict[str, Any]:
        return run(lambda conn: tools.describe_dataset(conn, dataset_id))

    @mcp.tool(
        description="Rows from one DOSM dataset, newest first. filters maps a column to a value or list of values, "
        "e.g. {\"state\": \"Selangor\", \"sex\": \"both\", \"age\": \"overall\", \"ethnicity\": \"overall\"}; text "
        "matching ignores case and state/district names accept common forms (KL, Penang, Hulu/Ulu). "
        "date_from/date_to are YYYY-MM-DD; latest=true keeps only the most recent date that matches. Many "
        "datasets repeat each date per breakdown (sex, age, series, division), so filter those to the 'overall' / "
        "'both' / 'abs' row unless you want the breakdown."
    )
    def dosm_query_dataset(
        dataset_id: str,
        filters: dict[str, Any] | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        latest: bool = False,
        columns: list[str] | None = None,
        order: Literal["desc", "asc"] = "desc",
        limit: int = 200,
    ) -> dict[str, Any]:
        return run(lambda conn: tools.query_dataset(conn, dataset_id, filters, date_from, date_to, latest, columns, order, limit))

    @mcp.tool(
        description="Read-only DuckDB SQL over all DOSM datasets, one table per dataset_id (hyphens become "
        "underscores, e.g. sdg_03_3_1). Use it for joins, aggregates and rankings, e.g. districts by median "
        "household income, or PriceCatcher prices joined to lookup_item and lookup_premise. Tables _catalogue and "
        "_fields hold the metadata. One SELECT/WITH statement; results capped at limit rows."
    )
    def dosm_sql(sql: str, limit: int = 500) -> dict[str, Any]:
        return run(lambda conn: tools.run_sql(conn, sql, limit))

    @mcp.tool(
        description="Socio-economic profile of a Malaysian state, or a district when district is given: latest "
        "population and growth, mean/median household income, absolute and relative poverty, Gini, labour force "
        "and unemployment, piped water/sanitation/electricity coverage, and household internet access "
        "(state level). Each figure carries its reference date and source table."
    )
    def dosm_area_profile(state: str, district: str | None = None) -> dict[str, Any]:
        return run(lambda conn: tools.area_profile(conn, state, district))

    @mcp.tool(
        description="Latest Malaysian headline economic indicators with their reference dates: GDP growth (YoY "
        "and QoQ), CPI inflation, unemployment and participation rate, exports/imports/trade balance, "
        "industrial production growth, leading/coincident/lagging indices and total population."
    )
    def dosm_economy_snapshot() -> dict[str, Any]:
        return run(tools.economy_snapshot)

    return mcp


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="dosm-mcp", description=__doc__)
    parser.add_argument("--transport", choices=["stdio", "streamable-http"], default="stdio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--search", action="store_true", help="collapse the tool list into BM25 search + call tools")
    parser.add_argument("--db", type=Path, default=None)
    args = parser.parse_args(argv)
    serve(build_server(args.db or DB_PATH, search=args.search), args.transport, args.host, args.port)


if __name__ == "__main__":
    main()
