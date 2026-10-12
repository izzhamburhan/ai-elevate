"""Actual HTTP/MCP smoke checks against cached model inference, without any paid service."""
import argparse
import asyncio
import json
import time

import httpx
from fastmcp import Client

from weather_ml_mcp.schemas import Forecast

TOOLS = {"predict_rainfall", "predict_temperature", "predict_weather_for_sites", "get_weather_model_metrics",
         "get_weather_model_status", "get_weather_forecast_geojson"}


async def verify(url: str, frontend_url: str | None = None, frontend_mcp_url: str | None = None, expected_basemap: str | None = None):
    with httpx.Client(base_url=url, timeout=90) as http:
        deadline = time.monotonic() + 60
        ready = None
        while time.monotonic() < deadline:
            try:
                assert http.get("/healthz").status_code == 200
                ready = http.get("/readyz")
                if ready.status_code == 200:
                    break
            except (httpx.HTTPError, AssertionError):
                pass
            await asyncio.sleep(1)
        assert ready is not None, "Weather HTTP server never became reachable"
        assert ready.status_code == 200 and ready.json()["ready"], ready.text
        location = next(x for x in ready.json()["locations"] if x["ready"])
        bad = http.get("/api/forecast-geojson", params={"horizon_hours": 7})
        assert bad.status_code >= 400 and bad.json()["ok"] is False
    async with Client(f"{url}/mcp") as client:
        tools = await client.list_tools()
        assert {tool.name for tool in tools} == TOOLS
        assert all(tool.annotations.read_only_hint for tool in tools)
        status = (await client.call_tool("get_weather_model_status")).data
        assert status["ready"] and status["read_only_inference"]
        for tool in ("predict_rainfall", "predict_temperature"):
            for horizon in (6, 12, 24):
                result = (await client.call_tool(tool, {"latitude": location["latitude"],
                    "longitude": location["longitude"], "horizon_hours": horizon})).data
                validated = Forecast.model_validate(result)
                assert validated.research_only and validated.model.device == "cpu"
                assert validated.model.id == "autogluon/chronos-2-small"
                assert validated.context_end < validated.forecast_start
                print(json.dumps({"criterion": f"{tool}_{horizon}h", "status": "PASS",
                                  "mode": validated.mode, "points": len(validated.forecasts)}))
        geography = (await client.call_tool("get_weather_forecast_geojson", {"region": "all", "horizon_hours": 6})).data
        assert geography["ok"] and geography["geojson"]["type"] == "FeatureCollection"
        repeated = (await client.call_tool("get_weather_forecast_geojson", {"region": "all", "horizon_hours": 6})).data
        # Wall-clock generation/freshness metadata changes; fixed replay predictions and joins do not.
        for key in ("mode", "model", "geojson", "legend", "warnings"):
            assert geography[key] == repeated[key], f"Repeated cached replay changed {key}"
        print(json.dumps({"criterion": "deterministic_cached_replay", "status": "PASS"}))
        sites = []
        for feature in geography["geojson"]["features"]:
            assert feature["type"] == "Feature" and feature["geometry"]["type"] == "Point"
            lon, lat = feature["geometry"]["coordinates"]
            assert -180 <= lon <= 180 and -90 <= lat <= 90
            if feature["properties"]["kind"] == "telecom_site":
                assert feature["properties"]["synthetic_network_data"] is True
                sites.append(feature["properties"]["site_id"])
        assert sites, "No actual NetOps inventory joined to forecast geography"
        site = (await client.call_tool("predict_weather_for_sites", {"site_ids": sites[:1], "horizon_hours": 6})).data
        assert site["ok"] and site["sites"][0].get("rainfall"), site
        metrics = (await client.call_tool("get_weather_model_metrics")).data
        assert metrics["available"] and metrics["report"]["status"] == "PASS"
        print(json.dumps({"criterion": "http_mcp_netops_geojson_metrics", "status": "PASS",
                          "tools": len(tools), "features": len(geography["geojson"]["features"]), "synthetic_sites": len(sites)}))
    if frontend_url:
        with httpx.Client(base_url=frontend_url, timeout=90) as http:
            result = http.get("/api/weather", params={"action": "forecast", "region": "all", "horizon_hours": 6})
            assert result.status_code == 200 and result.json()["geojson"]["features"]
            result = http.post("/api/mcp/inspect", json={"url": frontend_mcp_url or f"{url}/mcp", "transport": "http"})
            assert result.status_code == 200 and len(result.json()["tools"]) == 6
        # An open app tab with a generated overlay is required; use the existing documented Kepler MCP API.
        async with Client(f"{frontend_url}/api/kepler/mcp") as client:
            async def state():
                return json.loads((await client.call_tool("kepler_get_map_state")).content[0].text)
            before = await state()
            if expected_basemap:
                assert before["basemap"] == expected_basemap, before["basemap"]
                assert any(dataset["id"] == "weather-demo-outline" for dataset in before["datasets"]), "Cached pitch outline was not loaded"
            weather = [layer for layer in before["layers"] if layer["dataId"].startswith("weather-ml-")]
            assert weather, "Generate an overlay in the Weather panel before running browser-map verification"
            retained = {layer["id"]: layer["isVisible"] for layer in before["layers"] if layer not in weather}
            assert retained, "An existing map layer is required to verify preservation"
            for layer in weather:
                await client.call_tool("kepler_update_layer", {"layerId": layer["id"], "isVisible": False})
            hidden = await state()
            assert all(not layer["isVisible"] for layer in hidden["layers"] if layer["dataId"].startswith("weather-ml-"))
            assert all(layer["isVisible"] == retained[layer["id"]] for layer in hidden["layers"] if layer["id"] in retained)
            for layer in weather:
                await client.call_tool("kepler_update_layer", {"layerId": layer["id"], "isVisible": layer["isVisible"]})
            after = await state()
            assert {d["id"] for d in before["datasets"]} == {d["id"] for d in after["datasets"]}
        print(json.dumps({"criterion": "frontend_proxy_connector_kepler_visibility_preservation", "status": "PASS"}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://weather:8001")
    parser.add_argument("--frontend-url", help="App URL with an open map tab and generated Weather overlay")
    parser.add_argument("--frontend-mcp-url", help="Weather MCP URL as reachable by the Next.js server")
    parser.add_argument("--expected-basemap", help="Optionally verify cached pitch uses no_map and a local outline")
    args = parser.parse_args()
    asyncio.run(verify(args.url.rstrip("/"), args.frontend_url.rstrip("/") if args.frontend_url else None, args.frontend_mcp_url, args.expected_basemap))
