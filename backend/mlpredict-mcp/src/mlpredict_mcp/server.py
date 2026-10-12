"""mlpredict-mcp server. Run: `uv run --package mlpredict-mcp python -m mlpredict_mcp [--transport streamable-http --port 8126]`."""

from __future__ import annotations

import argparse
from collections.abc import Callable
from typing import Annotated, Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from mcp.types import ToolAnnotations
from menara_core.mcp_server import add_tool_search, serve
from netintel_mcp.tools import InputError
from pydantic import Field

from mlpredict_mcp import tools

NAME = "mlpredict"
DEFAULT_PORT = 8126
INSTRUCTIONS = (
    "Local machine-learning predictions on the NetOps network and Malaysian commercial areas: crowd/footfall forecasts, the best "
    "areas for a temporary sales booth, site outage risk for the next 24 hours, hourly congestion forecasts up to a week ahead, "
    "anomaly detection, and business demand signals that combine them per area. Read-only. Models are LightGBM and Isolation Forest trained locally; no LLM produces numbers. "
    "Times: UTC plus a Malaysia-time (+08:00) copy; dates without an offset are Malaysia time. ALL DATA IS SYNTHETIC: metrics "
    "are synthetic benchmarks, and every answer carries its uncertainty, provenance and limitations, plus GeoJSON for the map."
)
READ_ONLY = ToolAnnotations(read_only_hint=True, destructive_hint=False, idempotent_hint=True, open_world_hint=False)

Hour = Annotated[int, Field(ge=0, le=23, description="Hour of day, Malaysia time")]
Day = Annotated[str, Field(description="Date in Malaysia time, YYYY-MM-DD")]
Lat = Annotated[float, Field(ge=-90, le=90)]
Lng = Annotated[float, Field(ge=-180, le=180)]
Radius = Annotated[float, Field(gt=0, le=100)]
SiteIds = Annotated[list[str], Field(min_length=1, max_length=50, description="NetOps Site_ID values")]


def _run(call: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    try:
        return call()
    except (InputError, tools.NotTrainedError, ValueError) as exc:
        raise ToolError(str(exc)) from exc


def build_server(*, search: bool = False) -> FastMCP:
    mcp = FastMCP(NAME, instructions=INSTRUCTIONS)
    if search:
        add_tool_search(mcp, NAME)

    @mcp.tool(annotations=READ_ONLY, description=(
        "Forecast aggregate visitors (footfall) for commercial areas in a time window, e.g. 'which areas will be most crowded on "
        "Saturday 4-9 PM?'. day defaults to the next Saturday after the data; hours are Malaysia time. Returns areas ranked by "
        "expected visitors with a P10-P90 band, peak hour and nearby events. Up to 7 days ahead."))
    def predict_area_footfall(day: Day | None = None, hour_from: Hour = 16, hour_to: Hour = 20, area_ids: list[str] | None = None,
                              cluster: str | None = None, lat: Lat | None = None, lng: Lng | None = None, radius_km: Radius | None = None,
                              limit: Annotated[int, Field(ge=1, le=50)] = 10) -> dict[str, Any]:
        return _run(lambda: tools.predict_area_footfall(day, hour_from, hour_to, area_ids, cluster, lat, lng, radius_km, limit))

    @mcp.tool(annotations=READ_ONLY, description=(
        "Recommend the best areas for a temporary TM sales booth, e.g. 'the three best areas this weekend'. Ranks areas by predicted "
        "sign-ups (a synthetic proxy, not revenue) from the footfall forecast, nearby events, network availability and staff, with "
        "the ranking factors, a band, estimated cost and risks (including forecast network congestion nearby)."))
    def rank_business_locations(day: Day | None = None, hour_from: Hour = 12, hour_to: Hour = 19, top_k: Annotated[int, Field(ge=1, le=10)] = 3,
                                staff: Annotated[int, Field(ge=1, le=10)] = 3, cluster: str | None = None,
                                area_ids: list[str] | None = None) -> dict[str, Any]:
        return _run(lambda: tools.rank_business_locations(day, hour_from, hour_to, top_k, staff, cluster, area_ids))

    @mcp.tool(annotations=READ_ONLY, description=(
        "Estimate which sites are most at risk of a total/partial outage in the next 24 hours (a cluster, circle, list of sites, or "
        "the whole network). Returns risk score and level, the model's contributing factors, historical evidence and preventive checks."))
    def predict_site_failure_risk(cluster: str | None = None, site_ids: SiteIds | None = None, lat: Lat | None = None, lng: Lng | None = None,
                                  radius_km: Radius | None = None, limit: Annotated[int, Field(ge=1, le=100)] = 10) -> dict[str, Any]:
        return _run(lambda: tools.predict_site_failure_risk(cluster, site_ids, lat, lng, radius_km, limit))

    @mcp.tool(annotations=READ_ONLY, description=(
        "Forecast hourly DL PRB load per cell and flag cells that may congest, e.g. during the upcoming weekend event. Give a cluster, "
        "circle or sites; start/end in ISO time (no offset = Malaysia time), up to 7 days past the data; default the coming weekend. "
        "Give event_id (e.g. EVT-SA-FESTIVAL) to forecast the cells within 3 km of an event for its hours. "
        "Returns per-cell risk, peak, busy hours, an interval and the events in the area."))
    def forecast_network_congestion(start: str | None = None, end: str | None = None, cluster: str | None = None, site_ids: SiteIds | None = None,
                                    lat: Lat | None = None, lng: Lng | None = None, radius_km: Radius | None = None,
                                    threshold_pct: Annotated[float, Field(ge=50, le=100)] = 85.0,
                                    limit: Annotated[int, Field(ge=1, le=100)] = 20, event_id: str | None = None) -> dict[str, Any]:
        return _run(lambda: tools.forecast_network_congestion(start, end, cluster, site_ids, lat, lng, radius_km, threshold_pct, limit, event_id))

    @mcp.tool(annotations=READ_ONLY, description=(
        "Detect abnormal network behaviour (throughput drops, traffic spikes, loss/latency jumps, availability drops) in a cluster, "
        "circle or sites over a recorded window (default the last 24 hours of data). Returns the most unusual sites with score, "
        "metrics, time and potential impact. An anomaly score is not a failure probability."))
    def detect_network_anomalies(start: str | None = None, end: str | None = None, cluster: str | None = None, site_ids: SiteIds | None = None,
                                 lat: Lat | None = None, lng: Lng | None = None, radius_km: Radius | None = None,
                                 limit: Annotated[int, Field(ge=1, le=100)] = 20) -> dict[str, Any]:
        return _run(lambda: tools.detect_network_anomalies(start, end, cluster, site_ids, lat, lng, radius_km, limit))

    @mcp.tool(annotations=READ_ONLY, description=(
        "Business demand signals per commercial area for a future window, e.g. 'where should we investigate demand and capacity this "
        "Saturday?'. Combines the footfall, booth, congestion and failure models into a demand index, capacity pressure, reliability "
        "risk, a signal (demand_exceeds_capacity, reliability_risk, demand_with_headroom, structural_congestion, steady) and a ranked "
        "investigation priority with evidence. The output schema (demand-signals-v1) is the Opportunity Graph contract."))
    def get_business_demand_signals(day: Day | None = None, hour_from: Hour = 12, hour_to: Hour = 22, cluster: str | None = None,
                                    area_ids: list[str] | None = None, limit: Annotated[int, Field(ge=1, le=50)] = 10) -> dict[str, Any]:
        return _run(lambda: tools.get_business_demand_signals(day, hour_from, hour_to, cluster, area_ids, limit))

    @mcp.tool(annotations=READ_ONLY, description=(
        "Evaluation metrics of the models (footfall, booth, failure, congestion, anomaly) against simple baselines on held-out later "
        "data. Synthetic benchmarks."))
    def get_ml_model_metrics(model: str | None = None) -> dict[str, Any]:
        return _run(lambda: tools.get_ml_model_metrics(model))

    @mcp.tool(annotations=READ_ONLY, description="Whether the models are trained and loaded: versions, training time, data and library versions.")
    def get_ml_model_status() -> dict[str, Any]:
        return _run(tools.get_ml_model_status)

    return mcp


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="mlpredict-mcp", description=__doc__)
    parser.add_argument("--transport", choices=["stdio", "streamable-http"], default="stdio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--search", action="store_true", help="collapse the tool list into BM25 search + call tools")
    args = parser.parse_args(argv)
    serve(build_server(search=args.search), args.transport, args.host, args.port)


if __name__ == "__main__":
    main()
