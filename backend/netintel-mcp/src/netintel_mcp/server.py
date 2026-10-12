"""netintel-mcp server. Run: `uv run --package netintel-mcp python -m netintel_mcp [--transport streamable-http --port 8125]`."""

from __future__ import annotations

import argparse
from collections.abc import Callable
from typing import Annotated, Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from mcp.types import ToolAnnotations
from menara_core.mcp_server import add_tool_search, serve
from pydantic import Field

from netintel_mcp import tools
from netintel_mcp.store import NotSeededError

NAME = "netintel"
DEFAULT_PORT = 8125
INSTRUCTIONS = (
    "Network intelligence over the NetOps network: investigate a customer complaint, find congested cells, correlate "
    "incidents across sites, combine Weather ML forecasts with site vulnerability, and recommend maintenance. Read-only. "
    "Sites use NetOps Site_ID (e.g. CB5348), cells NetOps Cell_Name, clusters the NetOps cluster name (e.g. Shah Alam). "
    "Times are UTC with a Malaysia-time (+08:00) copy. Every answer has summary, evidence, limitations and a GeoJSON "
    "FeatureCollection for the map. ALL NETWORK DATA IS SYNTHETIC; causes are plausible explanations, not proof."
)
READ_ONLY = ToolAnnotations(read_only_hint=True, destructive_hint=False, idempotent_hint=True, open_world_hint=False)

Hour = Annotated[int, Field(ge=0, le=23, description="Hour of day in Malaysia time (0-23)")]
Lat = Annotated[float, Field(ge=-90, le=90)]
Lng = Annotated[float, Field(ge=-180, le=180)]
Radius = Annotated[float, Field(gt=0, le=50, description="Radius in km around lat/lng")]
SiteIds = Annotated[list[str], Field(min_length=1, max_length=50, description="NetOps Site_ID values")]


def _run(call: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    try:
        return call()
    except (tools.InputError, NotSeededError, ValueError) as exc:
        raise ToolError(str(exc)) from exc


def build_server(*, search: bool = False) -> FastMCP:
    mcp = FastMCP(NAME, instructions=INSTRUCTIONS)
    if search:
        add_tool_search(mcp, NAME)

    @mcp.tool(
        annotations=READ_ONLY,
        description="Investigate a customer complaint such as 'my Internet is slow every evening around 8 PM'. Give complaint_id (e.g. "
        "CMP-SA-0001), or the customer's lat/lng, and the reported hours in Malaysia time (hour_from/hour_to, e.g. 19 and 22). Finds the "
        "serving cell and nearby sites, compares KPIs (PRB load, throughput, latency, loss, SINR, availability) in the reported hours "
        "with other hours over `days`, checks measured signal (RSRP/RSRQ/SINR), outages, maintenance, alarms and crowd events, ranks "
        "plausible causes with evidence and recommends an action.",
    )
    def investigate_customer_complaint(
        complaint_id: str | None = None,
        lat: Lat | None = None,
        lng: Lng | None = None,
        hour_from: Hour | None = None,
        hour_to: Hour | None = None,
        days: Annotated[int, Field(ge=1, le=28)] = 28,
        description: str | None = None,
    ) -> dict[str, Any]:
        return _run(lambda: tools.investigate_customer_complaint(complaint_id, lat, lng, hour_from, hour_to, days, description))

    @mcp.tool(
        annotations=READ_ONLY,
        description="Find congested cells (DL PRB at or above threshold_pct) in a cluster, a circle (lat/lng/radius_km) or a list of sites over the "
        "last `days`: congested hours, busy hour, peak and p95 load, trend against the previous period, users affected (estimate), "
        "severity (CRITICAL/HIGH/MEDIUM/LOW) and a capacity recommendation per cell.",
    )
    def analyze_network_congestion(
        cluster: str | None = None,
        lat: Lat | None = None,
        lng: Lng | None = None,
        radius_km: Radius | None = None,
        site_ids: SiteIds | None = None,
        days: Annotated[int, Field(ge=1, le=14)] = 7,
        threshold_pct: Annotated[float, Field(ge=50, le=100)] = 85.0,
        limit: Annotated[int, Field(ge=1, le=100)] = 20,
    ) -> dict[str, Any]:
        return _run(lambda: tools.analyze_network_congestion(cluster, lat, lng, radius_km, site_ids, days, threshold_pct, limit))

    @mcp.tool(
        annotations=READ_ONLY,
        description="Explain why several neighbouring sites degraded together, e.g. 'why are three neighbouring sites degraded?'. Give site_ids "
        "(or a cluster / circle) and optionally start/end (ISO time; no offset means Malaysia time). Without a window it finds the latest "
        "period when they were degraded together. Correlates degraded KPIs with outages, maintenance, alarms, shared transport hub, "
        "exchange, distance and Weather ML, and returns hypotheses ranked by strength. Correlation, not proof.",
    )
    def correlate_network_incidents(
        site_ids: SiteIds | None = None,
        cluster: str | None = None,
        lat: Lat | None = None,
        lng: Lng | None = None,
        radius_km: Radius | None = None,
        start: str | None = None,
        end: str | None = None,
        use_weather: bool = True,
    ) -> dict[str, Any]:
        return _run(lambda: tools.correlate_network_incidents(site_ids, cluster, lat, lng, radius_km, start, end, use_weather))

    @mcp.tool(
        annotations=READ_ONLY,
        description="Weather exposure of telecom sites: the local Weather ML (Chronos-2 Small) rainfall forecast for each site combined with the "
        "site's vulnerability (microwave backhaul, recent outages, alarms, availability) into a LOW/MEDIUM/HIGH indicator. Up to 25 "
        "sites. Says whether the forecast is a historical replay or live. An exposure heuristic, not a failure prediction.",
    )
    def assess_weather_network_exposure(
        site_ids: SiteIds | None = None,
        cluster: str | None = None,
        lat: Lat | None = None,
        lng: Lng | None = None,
        radius_km: Radius | None = None,
        horizon_hours: Annotated[int, Field(description="6, 12 or 24")] = 24,
    ) -> dict[str, Any]:
        return _run(lambda: tools.assess_weather_network_exposure(site_ids, cluster, lat, lng, radius_km, horizon_hours))

    @mcp.tool(
        annotations=READ_ONLY,
        description="Recommend preventive or corrective maintenance from the network findings: chronically congested sectors, recurring "
        "radio (VSWR) or backhaul alarms, repeated outages, coverage complaint clusters and (include_weather) forecast weather exposure. "
        "Each recommendation has a priority, evidence and a DRAFT ticket. Creates nothing: a human must approve any ticket or dispatch.",
    )
    def recommend_network_maintenance(
        cluster: str | None = None,
        site_ids: SiteIds | None = None,
        lat: Lat | None = None,
        lng: Lng | None = None,
        radius_km: Radius | None = None,
        limit: Annotated[int, Field(ge=1, le=50)] = 10,
        include_weather: bool = False,
    ) -> dict[str, Any]:
        return _run(lambda: tools.recommend_network_maintenance(cluster, site_ids, lat, lng, radius_km, limit, include_weather))

    return mcp


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="netintel-mcp", description=__doc__)
    parser.add_argument("--transport", choices=["stdio", "streamable-http"], default="stdio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--search", action="store_true", help="collapse the tool list into BM25 search + call tools")
    args = parser.parse_args(argv)
    serve(build_server(search=args.search), args.transport, args.host, args.port)


if __name__ == "__main__":
    main()