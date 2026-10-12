"""opportunity-mcp server. Run: `uv run python -m opportunity_mcp --transport streamable-http --port 8127`.

Tools are always listed explicitly (the --search flag that run_all.py passes is accepted and ignored): there are only
three, and the Hermes Business Hypothesis Agent allowlists them by name.
"""

from __future__ import annotations

import argparse
from datetime import timedelta
from functools import lru_cache
from typing import Annotated, Any

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from mcp.types import ToolAnnotations
from menara_core.mcp_server import serve
from pydantic import Field
from starlette.requests import Request
from starlette.responses import JSONResponse

from opportunity_mcp import graph, rank

NAME = "opportunity"
DEFAULT_PORT = 8127
INSTRUCTIONS = (
    "Telco Opportunity Graph: connects existing synthetic NetOps sites, busy-hour KPIs, outages, complaints, backhaul, upcoming "
    "events, footfall, booth history, rain and a synthetic SME demand/serviceability seed for 38 Malaysian areas, then ranks "
    "business opportunities for TM with evidence, network feasibility, an assumption-labelled indicative potential, confidence and "
    "risks. Read-only. ALL DATA IS SYNTHETIC; scores are correlations, potential is not verified revenue."
)
READ_ONLY = ToolAnnotations(read_only_hint=True, destructive_hint=False, idempotent_hint=True, open_world_hint=False)


@lru_cache(maxsize=1)
def _graph() -> graph.OpportunityGraph:
    return graph.build()


def _envelope(data: dict[str, Any], tool: str) -> dict[str, Any]:
    og = _graph()
    end = og.data_end_utc
    data_end = {"utc": end.isoformat() + "Z", "myt": (end + timedelta(hours=8)).isoformat() + "+08:00"}
    return {"synthetic": True, "as_of": data_end["utc"],
            "data": {**data, "provenance": {**og.provenance, "method": "NetworkX graph + rule-based weighted percentile ranking"},
                     "data_freshness": {"data_end": data_end, "live": False, "note": "Synthetic window ending at the NetOps reference date."},
                     "limitations": rank.LIMITATIONS},
            "evidence": [{"source": "opportunity-mcp", "tool": tool, "ref": og.provenance["sme_generator"], "as_of": data_end["utc"]}],
            "warnings": []}


def build_server() -> FastMCP:
    mcp = FastMCP(NAME, instructions=INSTRUCTIONS)

    @mcp.custom_route("/healthz", methods=["GET"])
    async def health(_: Request) -> JSONResponse:
        try:
            summary = _graph().summary()
        except FileNotFoundError as exc:
            return JSONResponse({"ok": False, "error": str(exc)}, status_code=503)
        return JSONResponse({"ok": True, "service": "opportunity-mcp", "graph": summary})

    @mcp.tool(annotations=READ_ONLY, description=(
        "Discover and rank the top business opportunities for TM across Malaysian areas from the opportunity graph. Returns, per "
        "opportunity: where (area, coordinates, supporting Site_IDs), why (demand and network signals), what TM should do, a testable "
        "hypothesis, scores, network feasibility, an indicative assumption-labelled commercial range, confidence, risks, validation "
        "checks, and a GeoJSON layer. Deterministic for the same data."))
    def opportunity_discover(top_k: Annotated[int, Field(ge=1, le=5)] = 3) -> dict[str, Any]:
        return _envelope(rank.discover(_graph(), top_k), "opportunity_discover")

    @mcp.tool(annotations=READ_ONLY, description=(
        "Explain one area's full graph neighbourhood signals (sites, busy-hour PRB, outages, complaints, backhaul sharing, upcoming "
        "events, footfall, booth history, rain, SME demand and serviceability). area_id like AREA-JOHORB or a cluster name like Johor Bahru."))
    def opportunity_explain(area: Annotated[str, Field(min_length=2, max_length=64)]) -> dict[str, Any]:
        signals = rank.area_signals(_graph())
        match = signals.get(area) or next((s for s in signals.values() if s["cluster"].lower() == area.lower()), None)
        if match is None:
            raise ToolError(f"Unknown area '{area}'. Use an area_id such as AREA-KLCC or a cluster name such as KLCC.")
        point = {"type": "Feature", "geometry": {"type": "Point", "coordinates": [match["lng"], match["lat"]]},
                 "properties": {"id": match["area_id"], "kind": "opportunity_area", "area": match["name"], "synthetic": True}}
        return _envelope({"summary": f"Graph signals for {match['name']}.", "signals": match,
                          "geojson": {"type": "FeatureCollection", "features": [point]}}, "opportunity_explain")

    @mcp.tool(annotations=READ_ONLY, description="Summarise the opportunity graph: node and edge counts by type and data provenance.")
    def opportunity_graph_summary() -> dict[str, Any]:
        return _envelope({"summary": "Opportunity graph structure.", "graph": _graph().summary()}, "opportunity_graph_summary")

    return mcp


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="opportunity-mcp", description=__doc__)
    parser.add_argument("--transport", choices=["stdio", "streamable-http"], default="stdio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--search", action="store_true", help="accepted for run_all.py compatibility; tools stay explicit")
    args = parser.parse_args(argv)
    serve(build_server(), args.transport, args.host, args.port)


if __name__ == "__main__":
    main()
