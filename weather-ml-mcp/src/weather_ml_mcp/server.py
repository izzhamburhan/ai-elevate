"""FastMCP streamable HTTP and a deliberately narrow read-only REST surface."""
import argparse
import asyncio
import json
import logging
import sys
from typing import Annotated, Literal

from fastmcp import FastMCP
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.requests import Request
from starlette.responses import JSONResponse

from .config import Settings, utc_now
from .errors import WeatherError
from .service import ForecastService

log = logging.getLogger(__name__)
Horizon = Literal[6, 12, 24]
Latitude = Annotated[float, Field(ge=-90, le=90, description="WGS84 latitude")]
Longitude = Annotated[float, Field(ge=-180, le=180, description="WGS84 longitude")]


class JsonLogFormatter(logging.Formatter):
    def format(self, record):
        payload = {"timestamp": utc_now().isoformat(), "level": record.levelname.lower(),
                   "logger": record.name, "event": record.getMessage()}
        for key in ("error_type", "model_id", "revision", "device", "target"):
            if hasattr(record, key):
                payload[key] = getattr(record, key)
        return json.dumps(payload)


def invoke(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except WeatherError as exc:
        return exc.response()
    except Exception as exc:
        log.error("request_failed", extra={"error_type": type(exc).__name__})
        return WeatherError("SERVICE_ERROR", "Weather operation failed; no prediction values are fabricated", status=503).response()


class SitesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    site_ids: list[str] = Field(min_length=1, max_length=25)
    horizon_hours: Horizon


def build(service: ForecastService | None = None) -> FastMCP:
    service = service or ForecastService(Settings.from_env())
    mcp = FastMCP("weather-ml", instructions="""Local CPU Chronos-2-small ML weather research tools.
All forecasts use cached historical ERA5 reanalysis and local pretrained weights, never an LLM or paid service.
Check get_weather_model_status before forecasting. In replay mode, forecast valid times are historical; do not
present them as current forecasts. Live mode refuses stale inputs. Units precipitation mm per hourly record,
temperature degrees Celsius. Quantiles are uncalibrated and are not rain-event or outage probabilities.
Sites come from the existing synthetic NetOps inventory. Exposure categories are transparent geographic rules,
not predictions of actual telecom outages. Forecast GeoJSON may be sent to the existing Kepler add-data tool.
Never call these results official meteorological forecasts.""")
    hints = {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False}

    @mcp.tool(annotations=hints)
    async def predict_rainfall(latitude: Latitude, longitude: Longitude, horizon_hours: Horizon) -> dict:
        """Predict hourly precipitation with local ML (mm), UTC/local times and 10/50/90 quantiles. Research only."""
        return await asyncio.to_thread(invoke, service.predict, latitude, longitude, horizon_hours, "precipitation")

    @mcp.tool(annotations=hints)
    async def predict_temperature(latitude: Latitude, longitude: Longitude, horizon_hours: Horizon) -> dict:
        """Predict hourly 2 m temperature with local ML (°C), provenance and quantiles. Research only."""
        return await asyncio.to_thread(invoke, service.predict, latitude, longitude, horizon_hours, "temperature_2m")

    @mcp.tool(annotations={**hints, "openWorldHint": True})
    async def predict_weather_for_sites(site_ids: Annotated[list[str], Field(min_length=1, max_length=25)], horizon_hours: Horizon) -> dict:
        """Join exact synthetic NetOps site IDs to nearby cached weather forecasts; exposure is not an outage prediction."""
        return await asyncio.to_thread(invoke, service.predict_sites, site_ids, horizon_hours)

    @mcp.tool(annotations=hints)
    async def get_weather_model_metrics() -> dict:
        """Read the actual cached chronological backtest report, or explicitly report that evaluation is unavailable."""
        return await asyncio.to_thread(invoke, service.metrics)

    @mcp.tool(annotations=hints)
    async def get_weather_model_status() -> dict:
        """Report cached model readiness, locations, data freshness, replay/live mode and limitations."""
        return await asyncio.to_thread(invoke, service.status)

    @mcp.tool(annotations={**hints, "openWorldHint": True})
    async def get_weather_forecast_geojson(region: Annotated[str, Field(min_length=1, max_length=64)] = "all", horizon_hours: Horizon = 6) -> dict:
        """Return a Kepler-compatible weather/site point overlay with research provenance, units and exposure legend."""
        return await asyncio.to_thread(invoke, service.geojson, region, horizon_hours)

    @mcp.custom_route("/healthz", methods=["GET"])
    async def health(request: Request):
        return JSONResponse({"ok": True, "service": "weather-ml-mcp", "research_only": True})

    @mcp.custom_route("/readyz", methods=["GET"])
    async def ready(request: Request):
        result = await asyncio.to_thread(invoke, service.status)
        return JSONResponse(result, status_code=200 if result.get("ready") else 503)

    @mcp.custom_route("/api/status", methods=["GET"])
    async def status(request: Request):
        return JSONResponse(await asyncio.to_thread(invoke, service.status))

    @mcp.custom_route("/api/metrics", methods=["GET"])
    async def metrics(request: Request):
        return JSONResponse(await asyncio.to_thread(invoke, service.metrics))

    @mcp.custom_route("/api/forecast-geojson", methods=["GET"])
    async def geojson(request: Request):
        try:
            horizon = int(request.query_params.get("horizon_hours", "6"))
        except ValueError:
            return JSONResponse(WeatherError("INVALID_HORIZON", "horizon_hours must be 6, 12, or 24").response(), status_code=422)
        result = await asyncio.to_thread(invoke, service.geojson, request.query_params.get("region", "all"), horizon)
        return JSONResponse(result, status_code=200 if result.get("ok") else 422)

    @mcp.custom_route("/api/predict-sites", methods=["POST"])
    async def sites(request: Request):
        body = await request.body()
        if len(body) > 8192:
            return JSONResponse(WeatherError("INVALID_REQUEST", "Site request is too large").response(), status_code=413)
        try:
            args = SitesRequest.model_validate_json(body)
        except ValidationError:
            return JSONResponse(WeatherError("INVALID_REQUEST", "Provide site_ids (1–25 IDs) and horizon_hours (6/12/24)").response(), status_code=422)
        result = await asyncio.to_thread(invoke, service.predict_sites, args.site_ids, args.horizon_hours)
        return JSONResponse(result, status_code=200 if result.get("ok") else 422)

    return mcp


def main():
    settings = Settings.from_env()
    parser = argparse.ArgumentParser(description="Read-only local weather research MCP server")
    parser.add_argument("--host", default=settings.host)
    parser.add_argument("--port", type=int, default=settings.port)
    parser.add_argument("--stdio", action="store_true")
    args = parser.parse_args()
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(JsonLogFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
    # FastMCP installs Rich handlers during import. Route them through the same JSON formatter.
    fastmcp_log = logging.getLogger("fastmcp")
    fastmcp_log.handlers.clear()
    fastmcp_log.propagate = True
    # Upstream HTTP URLs and MCP session identifiers need not appear in application logs.
    for logger_name in ("httpx", "httpcore", "mcp.server.streamable_http", "mcp.server.streamable_http_manager"):
        logging.getLogger(logger_name).setLevel(logging.WARNING)
    server = build()
    if args.stdio:
        server.run()
    else:
        server.run(transport="http", host=args.host, port=args.port, path="/mcp", show_banner=False,
                   uvicorn_config={"log_config": None, "access_log": False})


if __name__ == "__main__":
    main()
