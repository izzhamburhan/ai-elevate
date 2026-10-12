"""Verified Parquet observations; inference never downloads or writes data."""
from hashlib import sha256
import json
import math
from pathlib import Path
import re

import numpy as np
import pandas as pd

from .config import Settings, utc_timestamp
from .errors import WeatherError

VARIABLE_UNITS = {
    "precipitation": "mm", "temperature_2m": "°C", "relative_humidity_2m": "%",
    "surface_pressure": "hPa", "wind_speed_10m": "km/h", "cloud_cover": "%",
}
LOCATIONS = {
    "kuala-lumpur": {"name": "Kuala Lumpur", "latitude": 3.139, "longitude": 101.6869, "region": "Central"},
    "penang": {"name": "George Town, Penang", "latitude": 5.4141, "longitude": 100.3288, "region": "Northern"},
    "johor-bahru": {"name": "Johor Bahru", "latitude": 1.4927, "longitude": 103.7414, "region": "Southern"},
    "kuantan": {"name": "Kuantan", "latitude": 3.8077, "longitude": 103.326, "region": "Eastern"},
    "kota-kinabalu": {"name": "Kota Kinabalu", "latitude": 5.9804, "longitude": 116.0735, "region": "Sabah"},
    "kuching": {"name": "Kuching", "latitude": 1.5533, "longitude": 110.3592, "region": "Sarawak"},
}


def validate_coordinates(latitude: float, longitude: float):
    if not math.isfinite(latitude) or not math.isfinite(longitude) or not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise WeatherError("INVALID_COORDINATES", "Latitude/longitude must be finite EPSG:4326 coordinates")


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    a1, a2, dl, do = map(math.radians, (lat1, lat2, lat2-lat1, lon2-lon1))
    h = math.sin(dl/2)**2 + math.cos(a1)*math.cos(a2)*math.sin(do/2)**2
    return 6371.0088 * 2 * math.asin(min(1, math.sqrt(h)))


def validate_frame(frame: pd.DataFrame) -> dict:
    """Reject malformed values; retain nulls/gaps explicitly rather than invent observations."""
    required = {"timestamp", "precipitation", "temperature_2m"}
    if not required.issubset(frame.columns) or frame.empty:
        raise WeatherError("INVALID_DATASET", "Dataset needs timestamp, precipitation and temperature_2m records")
    try:
        stamps = pd.to_datetime(frame["timestamp"], utc=True, errors="raise")
    except (ValueError, TypeError) as exc:
        raise WeatherError("INVALID_TIMESTAMPS", "Dataset contains invalid timestamps") from exc
    if stamps.isna().any() or stamps.duplicated().any():
        raise WeatherError("DUPLICATE_OR_NULL_TIMESTAMPS", "Dataset timestamps must be unique and non-null")
    if not stamps.is_monotonic_increasing or not (stamps == stamps.dt.floor("h")).all():
        raise WeatherError("UNALIGNED_TIMESTAMPS", "Dataset timestamps must be sorted and aligned to UTC hours")
    expected = pd.date_range(stamps.iloc[0], stamps.iloc[-1], freq="h")
    missing_hours = len(expected.difference(pd.DatetimeIndex(stamps)))
    missing_values = {}
    for variable in VARIABLE_UNITS:
        if variable not in frame:
            continue
        raw = frame[variable]
        values = pd.to_numeric(raw, errors="coerce")
        if (raw.notna() & values.isna()).any() or np.isinf(values).any():
            raise WeatherError("INVALID_VALUES", f"{variable} contains non-numeric or infinite values")
        if variable in {"precipitation", "wind_speed_10m"} and (values.dropna() < 0).any():
            raise WeatherError("INVALID_VALUES", f"{variable} cannot be negative")
        if variable in {"relative_humidity_2m", "cloud_cover"} and not values.dropna().between(0, 100).all():
            raise WeatherError("INVALID_VALUES", f"{variable} must be between 0 and 100")
        if variable == "temperature_2m" and not values.dropna().between(-100, 70).all():
            raise WeatherError("INVALID_VALUES", "Temperature outside physical validation range")
        if variable == "surface_pressure" and not values.dropna().between(300, 1100).all():
            raise WeatherError("INVALID_VALUES", "Surface pressure outside physical validation range")
        missing_values[variable] = int(values.isna().sum())
    return {"missing_hours": missing_hours, "missing_values": missing_values, "records": len(frame)}


class DataRepository:
    def __init__(self, settings: Settings):
        self.settings = settings

    def locations(self) -> list[dict]:
        manifests = []
        for path in sorted(self.settings.data_dir.glob("*.manifest.json")):
            try:
                manifest = json.loads(path.read_text())
                self._validate_manifest(manifest)
                manifests.append(manifest)
            except (OSError, ValueError, KeyError, TypeError, WeatherError):
                continue
        return manifests

    @staticmethod
    def _validate_manifest(manifest):
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", manifest["id"]):
            raise WeatherError("INVALID_MANIFEST", "Invalid cached location identifier")
        validate_coordinates(manifest["latitude"], manifest["longitude"])
        validate_coordinates(*manifest["grid_coordinate"])
        utc_timestamp(manifest["acquired_at"])
        for target in ("precipitation", "temperature_2m"):
            if manifest["units"].get(target) != VARIABLE_UNITS[target]:
                raise WeatherError("INVALID_UNITS", f"{target} must use {VARIABLE_UNITS[target]}")
        for key in ("name", "source", "license", "attribution", "sha256"):
            if not manifest.get(key):
                raise WeatherError("INVALID_MANIFEST", f"Dataset provenance missing {key}")

    def load(self, location_id: str) -> tuple[pd.DataFrame, dict]:
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", location_id):
            raise WeatherError("INVALID_LOCATION", "Invalid location identifier")
        parquet = self.settings.data_dir / f"{location_id}.parquet"
        try:
            manifest = json.loads((self.settings.data_dir / f"{location_id}.manifest.json").read_text())
            self._validate_manifest(manifest)
            if manifest["id"] != location_id:
                raise WeatherError("INVALID_MANIFEST", "Dataset location identifier does not match")
            if sha256(parquet.read_bytes()).hexdigest() != manifest["sha256"]:
                raise WeatherError("DATASET_CHECKSUM_MISMATCH", "Cached dataset integrity check failed; reacquire explicitly")
            frame = pd.read_parquet(parquet)
            frame["timestamp"] = pd.to_datetime(frame["timestamp"], utc=True)
            manifest = {**manifest, "validation": validate_frame(frame)}
            return frame, manifest
        except WeatherError:
            raise
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise WeatherError("DATASET_UNAVAILABLE", "Validated cached weather data unavailable; run explicit ingestion", status=503) from exc

    def nearest(self, latitude: float, longitude: float) -> tuple[dict, float]:
        validate_coordinates(latitude, longitude)
        locations = self.locations()
        if not locations:
            raise WeatherError("DATASET_UNAVAILABLE", "No validated weather datasets; run explicit ingestion", status=503)
        closest = min(locations, key=lambda m: distance_km(latitude, longitude, m["latitude"], m["longitude"]))
        distance = distance_km(latitude, longitude, closest["latitude"], closest["longitude"])
        if distance > self.settings.max_location_distance_km:
            raise WeatherError("LOCATION_OUT_OF_RANGE", f"No cached location within {self.settings.max_location_distance_km:g} km")
        return closest, distance
