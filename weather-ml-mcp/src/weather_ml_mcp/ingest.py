"""Explicit, reproducible archive acquisition; never called by inference."""
import argparse
from datetime import date
from hashlib import sha256
import json

import httpx
import pandas as pd

from .config import Settings, utc_now
from .data import LOCATIONS, VARIABLE_UNITS, validate_coordinates, validate_frame
from .errors import WeatherError

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"


def ingest_location(settings: Settings, location_id: str, start: str, end: str, client=None) -> dict:
    if location_id not in LOCATIONS:
        raise ValueError(f"Unknown location {location_id}")
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    if first > last or last >= utc_now().date():
        raise ValueError("Dates must be increasing completed UTC days")
    location = LOCATIONS[location_id]
    params = {"latitude": location["latitude"], "longitude": location["longitude"],
              "start_date": start, "end_date": end, "hourly": ",".join(VARIABLE_UNITS),
              "timezone": "UTC", "temperature_unit": "celsius", "wind_speed_unit": "kmh",
              "precipitation_unit": "mm", "models": "era5"}
    own_client = client is None
    client = client or httpx.Client(timeout=90)
    try:
        response = client.get(ARCHIVE_URL, params=params)
        response.raise_for_status()
        payload = response.json()
    finally:
        if own_client:
            client.close()
    if payload.get("utc_offset_seconds") != 0:
        raise WeatherError("INVALID_TIMEZONE", "Archive did not return UTC timestamps")
    grid_coordinate = [payload["latitude"], payload["longitude"]]
    validate_coordinates(*grid_coordinate)
    units = payload["hourly_units"]
    if any(units.get(v) != unit for v, unit in VARIABLE_UNITS.items()):
        raise WeatherError("INVALID_UNITS", "Archive variable units do not match requested units")
    hourly = payload["hourly"]
    frame = pd.DataFrame({"timestamp": pd.to_datetime(hourly["time"], utc=True),
                          **{v: hourly[v] for v in VARIABLE_UNITS}})
    validation = validate_frame(frame)
    if frame["timestamp"].iloc[0].date() != first or frame["timestamp"].iloc[-1].date() != last:
        raise WeatherError("INCOMPLETE_DATE_RANGE", "Archive date range differs from requested range")
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    parquet = settings.data_dir / f"{location_id}.parquet"
    temporary = parquet.with_suffix(".parquet.tmp")
    frame.to_parquet(temporary, index=False)
    checksum = sha256(temporary.read_bytes()).hexdigest()
    manifest = {"schema_version": 1, "id": location_id, **location, "coordinate_system": "EPSG:4326",
                "grid_coordinate": grid_coordinate, "source": "Open-Meteo Historical Weather API (ERA5 reanalysis)",
                "source_url": ARCHIVE_URL, "request_parameters": params,
                "weather_data_kind": "gridded_reanalysis_estimates", "license": "CC-BY-4.0",
                "attribution": "Weather data by Open-Meteo.com; ERA5 reanalysis by ECMWF/Copernicus Climate Change Service (C3S)",
                "acquired_at": utc_now().isoformat(), "last_observation_timestamp": frame["timestamp"].iloc[-1].isoformat(),
                "first_observation_timestamp": frame["timestamp"].iloc[0].isoformat(), "units": units,
                "sha256": checksum, "validation": validation}
    manifest_path = settings.data_dir / f"{location_id}.manifest.json"
    temp_manifest = manifest_path.with_suffix(".json.tmp")
    temp_manifest.write_text(json.dumps(manifest, indent=2) + "\n")
    temporary.replace(parquet)
    temp_manifest.replace(manifest_path)
    return manifest


def main():
    parser = argparse.ArgumentParser(description="Download historical ERA5 reanalysis into validated local Parquet")
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--locations", default="kuala-lumpur,penang,johor-bahru")
    args = parser.parse_args()
    settings = Settings.from_env()
    for location_id in args.locations.split(","):
        manifest = ingest_location(settings, location_id.strip(), args.start, args.end)
        print(json.dumps({"event": "dataset_ingested", "location": manifest["id"], "records": manifest["validation"]["records"], "sha256": manifest["sha256"]}))


if __name__ == "__main__":
    main()
