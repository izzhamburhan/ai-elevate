"""Deterministic synthetic unit fixtures only; these are never presented as observed weather."""
import asyncio
from dataclasses import replace
from datetime import datetime, timezone
from hashlib import sha256
import json
import sys
from types import SimpleNamespace

import httpx
import numpy as np
import pandas as pd
import pytest
from fastmcp import Client
from pydantic import ValidationError

from weather_ml_mcp.config import Settings, utc_timestamp
from weather_ml_mcp.data import DataRepository, validate_frame
from weather_ml_mcp.errors import WeatherError
from weather_ml_mcp.ingest import ingest_location
from weather_ml_mcp.model import LocalChronos
from weather_ml_mcp.netops import NetOpsInventory
from weather_ml_mcp.schemas import Forecast
from weather_ml_mcp.server import build
from weather_ml_mcp.service import ForecastService

NOW = datetime(2026, 10, 12, 12, tzinfo=timezone.utc)
CUTOFF = "2026-09-25T23:00:00Z"


class FixtureForecaster:
    """Explicit unit-test stand-in; not actual ML and not production fallback."""
    loaded = True
    provenance = {"id": "synthetic-unit-fixture-only", "revision": "fixture", "framework_version": "fixture"}

    def __init__(self):
        self.calls = []

    def load(self):
        pass

    def predict(self, frame, target, horizon):
        self.calls.append((frame.copy(), target, horizon))
        median = 3.0 if target == "precipitation" else 28.0
        return pd.DataFrame({"timestamp": pd.date_range(frame["timestamp"].iloc[-1]+pd.Timedelta(hours=1), periods=horizon, freq="h"),
                             "predictions": [median]*horizon, "0.1": [median-1]*horizon,
                             "0.5": [median]*horizon, "0.9": [median+1]*horizon})


class FixtureInventory:
    def sites(self, region=None):
        return [{"site_id": "SYNTHETIC-UNIT-SITE", "site_name": "Unit fixture", "latitude": 3.14, "longitude": 101.69,
                 "technology": "4G", "network_source": "synthetic unit fixture", "synthetic_network_data": True}]

    def by_ids(self, ids):
        return self.sites()


@pytest.fixture
def dataset(tmp_path):
    settings = Settings(data_dir=tmp_path, model_dir=tmp_path/"model", replay_cutoff=CUTOFF, context_hours=336,
                        metrics_path=tmp_path/"report.json")
    frame = pd.DataFrame({"timestamp": pd.date_range("2026-09-01", "2026-09-30T23:00", freq="h", tz="UTC"),
                          "precipitation": np.zeros(720), "temperature_2m": np.full(720, 28.)})
    save_dataset(settings, frame)
    return settings, frame


def save_dataset(settings, frame):
    parquet = settings.data_dir/"kuala-lumpur.parquet"
    frame.to_parquet(parquet, index=False)
    manifest = {"id": "kuala-lumpur", "name": "Synthetic unit fixture Kuala Lumpur", "latitude": 3.139,
                "longitude": 101.6869, "region": "Central", "grid_coordinate": [3.25, 101.75],
                "source": "SYNTHETIC UNIT FIXTURE — not observed weather", "license": "fixture-only",
                "attribution": "Deterministic test fixture", "units": {"precipitation": "mm", "temperature_2m": "°C"},
                "acquired_at": NOW.isoformat(), "sha256": sha256(parquet.read_bytes()).hexdigest(),
                "last_observation_timestamp": frame["timestamp"].iloc[-1].isoformat()}
    (settings.data_dir/"kuala-lumpur.manifest.json").write_text(json.dumps(manifest))


def service(dataset, **kwargs):
    settings, _ = dataset
    return ForecastService(settings, forecaster=FixtureForecaster(), netops=FixtureInventory(), clock=lambda: NOW, **kwargs)


def test_data_roundtrip_checksum_and_units(dataset):
    settings, expected = dataset
    frame, manifest = DataRepository(settings).load("kuala-lumpur")
    pd.testing.assert_frame_equal(frame, expected)
    assert manifest["validation"] == {"missing_hours": 0, "missing_values": {"precipitation": 0, "temperature_2m": 0}, "records": 720}
    parquet = settings.data_dir/"kuala-lumpur.parquet"
    parquet.write_bytes(parquet.read_bytes()+b"tamper")
    with pytest.raises(WeatherError, match="integrity"):
        DataRepository(settings).load("kuala-lumpur")


@pytest.mark.parametrize("change", ["duplicate", "unaligned", "negative_rain", "infinite", "bad_temperature"])
def test_invalid_dataset_rejected(dataset, change):
    _, frame = dataset
    if change == "duplicate":
        frame.loc[1, "timestamp"] = frame.loc[0, "timestamp"]
    elif change == "unaligned":
        frame.loc[1, "timestamp"] += pd.Timedelta(minutes=1)
    elif change == "negative_rain":
        frame.loc[0, "precipitation"] = -1
    elif change == "infinite":
        frame.loc[0, "temperature_2m"] = float("inf")
    else:
        frame.loc[0, "temperature_2m"] = 200
    with pytest.raises(WeatherError):
        validate_frame(frame)


def test_missing_hours_and_values_reported(dataset):
    _, frame = dataset
    frame = frame.drop(10).reset_index(drop=True)
    frame.loc[0, "precipitation"] = np.nan
    validation = validate_frame(frame)
    assert validation["missing_hours"] == 1
    assert validation["missing_values"]["precipitation"] == 1


def test_timezone_is_required_for_configuration():
    with pytest.raises(ValueError, match="timezone"):
        utc_timestamp("2026-09-25T23:00:00")
    assert utc_timestamp("2026-09-26T07:00:00+08:00").hour == 23
    with pytest.raises(ValueError, match="exactly"):
        Settings(replay_cutoff="2026-09-25T23:10:00Z")


@pytest.mark.parametrize("horizon", [6, 12, 24])
def test_forecast_schema_alignment_and_no_future_leakage(dataset, horizon):
    weather = service(dataset)
    result = weather.predict(3.139, 101.6869, horizon, "precipitation")
    validated = Forecast.model_validate(result)
    assert validated.context_end == utc_timestamp(CUTOFF)
    assert len(result["forecasts"]) == horizon
    assert result["forecast_start"] == "2026-09-26T00:00:00Z"
    assert result["forecasts"][0]["local_timestamp"] == "2026-09-26T08:00:00+08:00"
    assert weather.forecaster.calls[0][0]["timestamp"].max() == pd.Timestamp(CUTOFF)
    assert result["mode"] == "replay"
    assert result["dataset"]["source"].startswith("SYNTHETIC")
    assert any("not a current" in warning for warning in result["warnings"])


@pytest.mark.parametrize("horizon", [0, 7, 48, True])
def test_invalid_horizon_rejected(dataset, horizon):
    with pytest.raises(WeatherError, match="6, 12, or 24"):
        service(dataset).predict(3.139, 101.6869, horizon, "precipitation")


def test_live_mode_refuses_stale_data(dataset):
    settings, frame = dataset
    weather = ForecastService(replace(settings, mode="live"), forecaster=FixtureForecaster(), clock=lambda: NOW)
    with pytest.raises(WeatherError) as captured:
        weather.predict(3.139, 101.6869, 6, "precipitation")
    assert captured.value.code == "STALE_OBSERVATIONS"
    assert weather.forecaster.calls == []


def test_live_mode_never_uses_future_rows(dataset):
    settings, _ = dataset
    stamps = pd.date_range("2026-09-28T12:00Z", "2026-10-13T12:00Z", freq="h")
    frame = pd.DataFrame({"timestamp": stamps, "precipitation": np.zeros(len(stamps)), "temperature_2m": np.full(len(stamps), 28.)})
    save_dataset(settings, frame)
    weather = ForecastService(replace(settings, mode="live"), forecaster=FixtureForecaster(), clock=lambda: NOW)
    result = weather.predict(3.139, 101.6869, 6, "temperature_2m")
    assert result["dataset"]["observation_age_hours"] == 0
    assert weather.forecaster.calls[0][0]["timestamp"].max() == pd.Timestamp(NOW)


@pytest.mark.parametrize("kind", ["gap", "null"])
def test_missing_context_is_rejected_without_future_interpolation(dataset, kind):
    settings, frame = dataset
    if kind == "gap":
        frame = frame.drop(590)
    else:
        frame.loc[590, "precipitation"] = np.nan
    save_dataset(settings, frame)
    weather = service((settings, frame))
    with pytest.raises(WeatherError) as captured:
        weather.predict(3.139, 101.6869, 6, "precipitation")
    assert captured.value.code == "MISSING_CONTEXT"
    assert weather.forecaster.calls == []


def test_missing_outside_context_only_warns(dataset):
    settings, frame = dataset
    frame.loc[1, "precipitation"] = np.nan
    save_dataset(settings, frame)
    result = service((settings, frame)).predict(3.139, 101.6869, 6, "precipitation")
    assert result["dataset"]["missing_records"] == 1
    assert any("outside" in warning for warning in result["warnings"])


def test_coordinates_and_proximity_errors(dataset):
    weather = service(dataset)
    with pytest.raises(WeatherError) as captured:
        weather.predict(91, 101, 6, "precipitation")
    assert captured.value.code == "INVALID_COORDINATES"
    with pytest.raises(WeatherError) as captured:
        weather.predict(5.4141, 100.3288, 6, "precipitation")
    assert captured.value.code == "LOCATION_OUT_OF_RANGE"


def test_model_missing_cache_has_no_network_fallback(dataset, monkeypatch):
    settings, _ = dataset
    def forbidden(*args, **kwargs):
        pytest.fail("Model loader must not use a network request")
    monkeypatch.setattr(httpx.Client, "get", forbidden)
    model = LocalChronos(settings)
    with pytest.raises(WeatherError) as captured:
        model.load()
    assert captured.value.code == "MODEL_UNAVAILABLE"
    assert not model.loaded


def test_model_uses_only_local_path_official_interface(dataset, monkeypatch):
    settings, _ = dataset
    settings.model_dir.mkdir()
    files = {"config.json": b"{}", "model.safetensors": b"synthetic mock weights for unit interface test only"}
    for name, data in files.items():
        (settings.model_dir/name).write_bytes(data)
    (settings.model_dir/"weather-model.json").write_text(json.dumps({
        "id": settings.model_id, "revision": settings.model_revision, "sha256": {name: sha256(data).hexdigest() for name, data in files.items()}}))
    captured = {}
    def from_pretrained(path, **kwargs):
        captured.update(path=path, **kwargs)
        return SimpleNamespace(model=SimpleNamespace(eval=lambda: None))
    monkeypatch.setitem(sys.modules, "chronos", SimpleNamespace(BaseChronosPipeline=SimpleNamespace(from_pretrained=from_pretrained)))
    model = LocalChronos(settings)
    model.load()
    assert captured["path"] == str(settings.model_dir.resolve())
    assert captured["device_map"] == "cpu"
    assert captured["local_files_only"] is True
    assert captured["trust_remote_code"] is False
    assert model.loaded


def test_explicit_ingestion_provenance_utc_parquet_and_units(dataset):
    settings, _ = dataset
    from weather_ml_mcp.data import VARIABLE_UNITS
    times = pd.date_range("2026-09-01", periods=24, freq="h")
    payload = {"latitude": 3.25, "longitude": 101.75, "utc_offset_seconds": 0,
               "hourly_units": {"time": "iso8601", **VARIABLE_UNITS}, "hourly": {"time": [stamp.isoformat() for stamp in times],
                   "precipitation": [0.]*24, "temperature_2m": [28.]*24, "relative_humidity_2m": [80.]*24,
                   "surface_pressure": [1000.]*24, "wind_speed_10m": [10.]*24, "cloud_cover": [70.]*24}}
    requests = []
    def handle(request):
        requests.append(request)
        return httpx.Response(200, json=payload)
    client = httpx.Client(transport=httpx.MockTransport(handle))
    manifest = ingest_location(settings, "kuala-lumpur", "2026-09-01", "2026-09-01", client)
    frame, verified = DataRepository(settings).load("kuala-lumpur")
    assert str(frame["timestamp"].dt.tz) == "UTC"
    assert manifest["license"] == "CC-BY-4.0"
    assert manifest["weather_data_kind"] == "gridded_reanalysis_estimates"
    assert requests[0].url.params["models"] == "era5"
    assert requests[0].url.params["timezone"] == "UTC"
    assert verified["sha256"] == manifest["sha256"]
    payload["hourly_units"]["precipitation"] = "inch"
    with pytest.raises(WeatherError, match="units"):
        ingest_location(settings, "kuala-lumpur", "2026-09-01", "2026-09-01", client)


def test_offline_inference_only_reads_cached_dataset(dataset, monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("Offline point inference must not make a network request")
    monkeypatch.setattr(httpx.Client, "get", forbidden)
    result = service(dataset).predict(3.139, 101.6869, 6, "precipitation")
    assert result["ok"]


def test_netops_exact_site_match_and_read_only(dataset):
    settings, _ = dataset
    requests = []
    def handle(request):
        requests.append(request)
        return httpx.Response(200, json={"items": [{"site_id": "AB12", "latitude": 3.139, "longitude": 101.6869},
                                                     {"site_id": "AB123", "latitude": 3.14, "longitude": 101.69}]})
    client = httpx.Client(transport=httpx.MockTransport(handle))
    inventory = NetOpsInventory(settings, client)
    sites = inventory.by_ids(["AB12"])
    assert len(sites) == 1 and sites[0]["site_id"] == "AB12"
    assert sites[0]["synthetic_network_data"]
    assert all(request.method == "GET" and request.url.path == "/api/search_sites" for request in requests)


def test_geojson_geometry_legend_and_synthetic_sites(dataset):
    weather = service(dataset)
    result = weather.geojson("all", 6)
    assert result["geojson"]["type"] == "FeatureCollection"
    assert len(result["geojson"]["features"]) == 2
    site = result["geojson"]["features"][1]
    assert site["geometry"] == {"type": "Point", "coordinates": [101.69, 3.14]}
    assert site["properties"]["synthetic_network_data"]
    assert site["properties"]["exposure"] == "elevated"
    assert site["properties"]["rainfall_mm"] == 18
    assert result["legend"]["thresholds"]["calibrated_outage_classifier"] is False
    json.dumps(result, allow_nan=False)


def test_sites_exposure_is_not_outage_classifier(dataset):
    result = service(dataset).predict_sites(["SYNTHETIC-UNIT-SITE"], 6)
    assert result["synthetic_network_data"]
    assert "does not predict actual telecom outages" in result["disclaimer"]
    assert result["sites"][0]["weather_exposure"]["exposure"] == "elevated"


def test_model_bad_timestamps_and_crossing_quantiles_fail(dataset):
    weather = service(dataset)
    original = weather.forecaster.predict
    def shifted(*args):
        result = original(*args)
        result["timestamp"] += pd.Timedelta(hours=1)
        return result
    weather.forecaster.predict = shifted
    with pytest.raises(WeatherError, match="timestamps"):
        weather.predict(3.139, 101.6869, 6, "precipitation")
    weather = service(dataset)
    result = weather.predict(3.139, 101.6869, 6, "precipitation")
    result["forecasts"][0]["quantiles"]["0.1"] = 100
    with pytest.raises(ValidationError, match="ordered"):
        Forecast.model_validate(result)


def test_actual_metrics_only_and_status(dataset):
    weather = service(dataset)
    assert weather.metrics()["available"] is False
    assert weather.status()["ready"] is True
    assert weather.status()["locations"][0]["id"] == "kuala-lumpur"


def test_mcp_discovery_readonly_annotations_and_invocation(dataset):
    async def run():
        async with Client(build(service(dataset))) as client:
            tools = await client.list_tools()
            assert {tool.name for tool in tools} == {"predict_rainfall", "predict_temperature", "predict_weather_for_sites",
                                                   "get_weather_model_metrics", "get_weather_model_status", "get_weather_forecast_geojson"}
            assert all(tool.annotations.read_only_hint for tool in tools)
            response = await client.call_tool("predict_rainfall", {"latitude": 3.139, "longitude": 101.6869, "horizon_hours": 6})
            assert response.data["mode"] == "replay"
            assert len(response.data["forecasts"]) == 6
            status = await client.call_tool("get_weather_model_status", {})
            assert status.data["ready"]
    asyncio.run(run())


def test_http_health_readiness_and_forecast_routes(dataset):
    async def run():
        transport = httpx.ASGITransport(app=build(service(dataset)).http_app(path="/mcp"))
        async with httpx.AsyncClient(transport=transport, base_url="http://unit") as client:
            assert (await client.get("/healthz")).status_code == 200
            assert (await client.get("/readyz")).json()["ready"] is True
            assert (await client.get("/api/status")).json()["mode"] == "replay"
            assert (await client.get("/api/forecast-geojson", params={"region": "all", "horizon_hours": 6})).json()["geojson"]["type"] == "FeatureCollection"
            assert (await client.get("/api/forecast-geojson", params={"horizon_hours": 7})).status_code == 422
            assert (await client.post("/api/predict-sites", json={"site_ids": ["unit"], "horizon_hours": 6})).status_code == 200
            assert (await client.post("/api/predict-sites", json={"site_ids": ["unit"], "horizon_hours": 7})).status_code == 422
    asyncio.run(run())
