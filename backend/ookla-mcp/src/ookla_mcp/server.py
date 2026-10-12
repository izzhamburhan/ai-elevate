"""ookla-mcp server. Run: `uv run --package ookla-mcp python -m ookla_mcp [--transport streamable-http --port 8122]`.

Serves layers cached by `python -m ookla_mcp.build_layer`; it never reads S3 itself.
"""

from __future__ import annotations

import argparse
import json
from typing import Any, Literal
from urllib.parse import urlencode

from fastmcp import FastMCP
from menara_core.mcp_server import add_tool_search, serve
from starlette.requests import Request
from starlette.responses import JSONResponse

from ookla_mcp.db import DATA_DIR, connect, layer_path

NAME = "ookla"
DEFAULT_PORT = 8122
ATTRIBUTION = "Speedtest® by Ookla® Global Fixed and Mobile Network Performance Maps. Provided by Ookla."
INSTRUCTIONS = (
    "Real measured internet speed (download/upload Mbps, latency) in Malaysia from Ookla Open Data, as an H3 "
    "hexbin layer per quarter. Data is all providers combined, not operator-specific. Read-only."
)
SCOPE = " Metrics are test-weighted averages of Ookla speed tests for ALL providers combined, not operator-specific."
COLUMNS = "h3, lat, lon, avg_down_mbps, avg_up_mbps, avg_latency_ms, tests, tile_count"
Type = Literal["mobile", "fixed"]
CORS = {"Access-Control-Allow-Origin": "*"}
# Outline-only hexagons in #0EC7D4, as kepler visConfig for the map's update-layer tool.
MAP_STYLE = {"visConfig": {"filled": False, "stroked": True, "strokeColor": [14, 199, 212], "thickness": 1}}
# Set by main() for HTTP transports so get_hex_layer can hand out a geojson_url.
PUBLIC_URL = ""


def query(type_: str, year: int, quarter: int, res: int, sql: str, params: list[Any]) -> list[dict[str, Any]] | dict[str, Any]:
    """Run sql with {layer} bound to the cached file; an error dict if that layer has not been built."""
    path = layer_path(type_, year, quarter, res)
    if not path.exists():
        return {
            "ok": False,
            "error": f"layer {path.name} not built. Run: python -m ookla_mcp.build_layer --type {type_} "
            f"--year {year} --quarter {quarter} --res {res}",
            "available_layers": sorted(p.stem for p in DATA_DIR.glob("*.parquet")),
            "attribution": ATTRIBUTION,
        }
    conn = connect()
    try:
        cur = conn.execute(sql.replace("{layer}", f"read_parquet('{path.as_posix()}')"), params)
        names = [d[0] for d in cur.description]
        return [dict(zip(names, row, strict=True)) for row in cur.fetchall()]
    finally:
        conn.close()


def hex_layer(
    type_: str, year: int, quarter: int, res: int, bbox: list[float] | None, min_tests: int, format: str, limit: int
) -> dict[str, Any]:
    where, params = "tests >= ?", [min_tests]
    if bbox:
        where += " AND lon BETWEEN ? AND ? AND lat BETWEEN ? AND ?"
        params += [bbox[0], bbox[2], bbox[1], bbox[3]]
    geom = ", ST_AsGeoJSON(ST_GeomFromText(h3_cell_to_boundary_wkt(h3))) AS geometry" if format == "geojson" else ""
    sql = f"SELECT {COLUMNS}{geom}, count(*) OVER () AS total FROM {{layer}} WHERE {where} ORDER BY tests DESC LIMIT ?"
    rows = query(type_, year, quarter, res, sql, [*params, limit])
    if isinstance(rows, dict):
        return rows
    total = rows[0]["total"] if rows else 0
    for r in rows:
        del r["total"]
    meta = {"type": type_, "year": year, "quarter": quarter, "res": res, "total": total, "returned": len(rows)}
    if format == "geojson":
        features = [{"type": "Feature", "geometry": json.loads(r.pop("geometry")), "properties": r} for r in rows]
        return {**meta, "layer": {"type": "FeatureCollection", "features": features}, "attribution": ATTRIBUTION}
    return {**meta, "rows": rows, "attribution": ATTRIBUTION}


def build_server(*, search: bool = False) -> FastMCP:
    mcp = FastMCP(NAME, instructions=INSTRUCTIONS)
    if search:
        add_tool_search(mcp, NAME)

    @mcp.custom_route("/geojson/hex_layer", methods=["GET"])
    async def geojson(request: Request) -> JSONResponse:
        """get_hex_layer as a bare FeatureCollection, for map clients that load data by URL (kepler fetches it
        from the browser, hence the CORS header)."""
        q = request.query_params
        bbox = [float(v) for v in q["bbox"].split(",")] if q.get("bbox") else None
        out = hex_layer(
            q["type"], int(q["year"]), int(q["quarter"]), int(q.get("res", 8)), bbox,
            int(q.get("min_tests", 5)), "geojson", int(q.get("limit", 5000)),
        )  # fmt: skip
        return JSONResponse(out.get("layer", out), status_code=200 if "layer" in out else 404, headers=CORS)
    built = sorted(p.stem for p in DATA_DIR.glob("*.parquet"))
    scope = SCOPE + f" Available layers (type_YYYYqQ_rRES): {', '.join(built) or 'none'}."

    @mcp.tool(
        description="H3 hexbin layer of Ookla speed-test results in Malaysia for a quarter: per cell avg download/"
        "upload Mbps, avg latency ms, total tests and tile count, busiest cells first. bbox is [min_lon, min_lat, "
        "max_lon, max_lat]. format='geojson' returns a FeatureCollection of hexagons, 'rows' plain records. "
        "To DRAW the hexagons on a map, keep format='rows' and give geojson_url to the map's load-data tool as its "
        "url (never copy the coordinates into the map tool), then style the layer with map_style." + scope
    )
    def get_hex_layer(
        type: Type,
        year: int,
        quarter: int,
        res: int = 8,
        bbox: list[float] | None = None,
        min_tests: int = 5,
        format: Literal["rows", "geojson"] = "rows",
        limit: int = 5000,
    ) -> dict[str, Any]:
        out = hex_layer(type, year, quarter, res, bbox, min_tests, format, limit)
        if PUBLIC_URL and "total" in out:
            args = {"type": type, "year": year, "quarter": quarter, "res": res, "min_tests": min_tests, "limit": limit}
            if bbox:
                args["bbox"] = ",".join(map(str, bbox))
            out["geojson_url"] = f"{PUBLIC_URL}/geojson/hex_layer?{urlencode(args)}"
            out["map_style"] = MAP_STYLE
        return out

    @mcp.tool(
        description="Ookla speed-test metrics for the H3 cell containing a lat/lon in Malaysia plus its 6 neighbours "
        "(neighbours without data have null metrics)." + scope
    )
    def get_hex_at_point(lat: float, lon: float, type: Type, year: int, quarter: int, res: int = 8) -> dict[str, Any]:
        sql = f"""
            WITH c AS (SELECT h3_latlng_to_cell(?, ?, ?) AS cell),
            disk AS (SELECT h3_h3_to_string(unnest(h3_grid_disk(cell, 1))) AS h3, h3_h3_to_string(cell) AS center FROM c)
            SELECT d.h3, h3_cell_to_lat(d.h3) AS lat, h3_cell_to_lng(d.h3) AS lon,
                   l.avg_down_mbps, l.avg_up_mbps, l.avg_latency_ms, l.tests, l.tile_count, d.h3 = d.center AS is_center
            FROM disk d LEFT JOIN {{layer}} l ON l.h3 = d.h3
            ORDER BY is_center DESC, d.h3
        """
        rows = query(type, year, quarter, res, sql, [lat, lon, res])
        if isinstance(rows, dict):
            return rows
        for r in rows:
            del r["is_center"]
        return {
            "type": type,
            "year": year,
            "quarter": quarter,
            "res": res,
            "cell": rows[0],
            "neighbours": rows[1:],
            "attribution": ATTRIBUTION,
        }

    return mcp


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="ookla-mcp", description=__doc__)
    parser.add_argument("--transport", choices=["stdio", "streamable-http"], default="stdio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--search", action="store_true", help="collapse the tool list into BM25 search + call tools")
    args = parser.parse_args(argv)
    global PUBLIC_URL
    if args.transport != "stdio":
        PUBLIC_URL = f"http://{args.host}:{args.port}"
    serve(build_server(search=args.search), args.transport, args.host, args.port)


if __name__ == "__main__":
    main()
