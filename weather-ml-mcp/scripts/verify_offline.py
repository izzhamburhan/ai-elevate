"""Run this in a container with --network none and read-only artifact volumes."""
from dataclasses import replace
import json
import socket

from weather_ml_mcp.config import Settings
from weather_ml_mcp.errors import WeatherError
from weather_ml_mcp.schemas import Forecast
from weather_ml_mcp.service import ForecastService


def forbidden_network(*args, **kwargs):
    raise AssertionError("Offline inference attempted a network connection")


socket.create_connection = forbidden_network
socket.socket.connect = forbidden_network
settings = Settings.from_env()
service = ForecastService(settings)
location = service.repository.locations()[0]
for target in ("precipitation", "temperature_2m"):
    result = Forecast.model_validate(service.predict(location["latitude"], location["longitude"], 6, target))
    assert result.model.device == "cpu" and len(result.forecasts) == 6
    print(json.dumps({"criterion": f"offline_{target}", "status": "PASS", "revision": result.model.revision}))
live = ForecastService(replace(settings, mode="live"), forecaster=service.forecaster)
try:
    live.predict(location["latitude"], location["longitude"], 6, "precipitation")
except WeatherError as error:
    assert error.code == "STALE_OBSERVATIONS", error.code
    print(json.dumps({"criterion": "stale_live_inputs_refused", "status": "PASS"}))
else:
    raise AssertionError("Historical cache was incorrectly accepted for a current forecast")
