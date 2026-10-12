"""Causal forecasting orchestration and transparent geographic exposure rules."""
from datetime import timedelta
import json
import logging
import math
import threading
import time
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from .config import Settings, utc_now, utc_timestamp
from .data import DataRepository, distance_km
from .errors import WeatherError
from .model import LocalChronos
from .netops import NetOpsInventory
from .schemas import Forecast

log = logging.getLogger(__name__)
HORIZONS = (6, 12, 24)


class ForecastService:
    def __init__(self, settings: Settings, repository=None, forecaster=None, netops=None, clock=utc_now):
        self.settings = settings
        self.repository = repository or DataRepository(settings)
        self.forecaster = forecaster or LocalChronos(settings)
        self.netops = netops or NetOpsInventory(settings)
        self.clock = clock
        self._cache = {}
        self._lock = threading.RLock()

    def _context(self, frame, target):
        now = self.clock()
        cutoff = utc_timestamp(self.settings.replay_cutoff) if self.settings.mode == "replay" else now.replace(minute=0, second=0, microsecond=0)
        if cutoff > now:
            raise WeatherError("FUTURE_REPLAY_CUTOFF", "Replay cutoff must not be in the future")
        selected = frame.loc[frame["timestamp"] <= cutoff].tail(self.settings.context_hours).copy()
        if selected.empty or len(selected) < self.settings.min_context_hours:
            raise WeatherError("INSUFFICIENT_CONTEXT", f"At least {self.settings.min_context_hours} historical hours are required")
        last = selected["timestamp"].iloc[-1].to_pydatetime()
        if self.settings.mode == "replay" and last != cutoff:
            raise WeatherError("REPLAY_CUTOFF_UNAVAILABLE", "Cached observations do not include the exact replay cutoff")
        age = max(0, (now-last).total_seconds()/3600)
        if self.settings.mode == "live" and age > self.settings.freshness_hours:
            raise WeatherError("STALE_OBSERVATIONS", f"Latest cached observation is {age:.1f} hours old; live inference requires <= {self.settings.freshness_hours:g} hours. Acquire sufficiently fresh inputs or use explicitly labeled replay mode", status=503)
        expected = pd.date_range(selected["timestamp"].iloc[0], selected["timestamp"].iloc[-1], freq="h")
        if len(expected) != len(selected) or not pd.DatetimeIndex(selected["timestamp"]).equals(expected):
            raise WeatherError("MISSING_CONTEXT", "Historical model context has missing hours; reacquire data. No future interpolation is permitted")
        values = selected[target].to_numpy(dtype=float)
        if not np.isfinite(values).all():
            raise WeatherError("MISSING_CONTEXT", f"Historical {target} context has missing values; no values are fabricated")
        return selected, age

    def predict(self, latitude: float, longitude: float, horizon_hours: int, target: str) -> dict:
        if isinstance(horizon_hours, bool) or horizon_hours not in HORIZONS:
            raise WeatherError("INVALID_HORIZON", "horizon_hours must be 6, 12, or 24")
        if target not in {"precipitation", "temperature_2m"}:
            raise WeatherError("INVALID_TARGET", "Only precipitation and temperature_2m are supported")
        location, distance = self.repository.nearest(latitude, longitude)
        frame, manifest = self.repository.load(location["id"])
        context, age = self._context(frame, target)
        last = context["timestamp"].iloc[-1]
        key = (location["id"], manifest["sha256"], last.isoformat(), target, horizon_hours)
        # Serialize inference to cap peak CPU memory; memoization remains in process memory only.
        with self._lock:
            if key in self._cache:
                result, elapsed = self._cache[key]
            else:
                started = time.monotonic()
                result = self.forecaster.predict(context, target, horizon_hours)
                elapsed = time.monotonic()-started
                if len(self._cache) >= 96:
                    self._cache.pop(next(iter(self._cache)))
                self._cache[key] = (result.copy(), elapsed)
        expected = pd.date_range(last+pd.Timedelta(hours=1), periods=horizon_hours, freq="h")
        stamps = pd.to_datetime(result["timestamp"], utc=True)
        if len(result) != horizon_hours or not pd.DatetimeIndex(stamps).equals(expected):
            raise WeatherError("INVALID_MODEL_OUTPUT", "Model timestamps did not match the requested UTC forecast hours", status=503)
        warnings = ["Experimental zero-shot time-series forecasting; not an official meteorological forecast.",
                    "Prediction quantiles are not calibrated rainfall-event confidence or outage probabilities.",
                    "Historical inputs are gridded ERA5 reanalysis estimates, not on-site weather station measurements."]
        if self.settings.mode == "replay":
            warnings.append(f"Historical replay from {last.isoformat()}; these are historical simulated forecast valid times, not a current forecast.")
        if distance > 0.5:
            warnings.append(f"Using nearest cached weather location {distance:.1f} km away; this is not a site-specific weather prediction.")
        if target == "precipitation":
            warnings.append("Negative precipitation point/quantile predictions are clipped to zero; interval calibration has not been adjusted.")
        validation = manifest["validation"]
        missing = validation["missing_hours"] + sum(validation["missing_values"].values())
        if missing:
            warnings.append(f"Dataset contains {missing} missing hours/values outside the selected complete model context.")
        forecasts = []
        for _, row in result.iterrows():
            timestamp = pd.Timestamp(row["timestamp"]).to_pydatetime()
            forecasts.append({"timestamp": timestamp, "local_timestamp": timestamp.astimezone(ZoneInfo("Asia/Kuala_Lumpur")).isoformat(),
                              "value": float(row["0.5"]), "quantiles": {q: float(row[q]) for q in ("0.1", "0.5", "0.9")}})
        output = Forecast.model_validate({"mode": self.settings.mode, "target": target, "horizon_hours": horizon_hours,
            "generated_at": self.clock(), "forecast_start": expected[0].to_pydatetime(), "forecast_end": expected[-1].to_pydatetime(),
            "units": "mm" if target == "precipitation" else "°C", "location": {
                "id": manifest["id"], "name": manifest["name"], "latitude": manifest["latitude"], "longitude": manifest["longitude"],
                "requested_latitude": latitude, "requested_longitude": longitude, "distance_km": distance},
            "model": self.forecaster.provenance, "dataset": {"source": manifest["source"],
                "last_observation_timestamp": last.to_pydatetime(), "acquired_at": utc_timestamp(manifest["acquired_at"]),
                "license": manifest["license"], "attribution": manifest["attribution"], "sha256": manifest["sha256"],
                "weather_data_kind": manifest.get("weather_data_kind", "gridded_reanalysis_estimates"),
                "observation_age_hours": age, "requested_coordinate": [manifest["latitude"], manifest["longitude"]],
                "grid_coordinate": manifest["grid_coordinate"], "missing_records": missing},
            "context_start": context["timestamp"].iloc[0].to_pydatetime(), "context_end": last.to_pydatetime(),
            "context_records": len(context), "inference_seconds": elapsed, "forecasts": forecasts, "warnings": warnings})
        return output.model_dump(mode="json")

    def exposure(self, peak: float):
        if peak >= self.settings.high_rainfall_mm_per_hour:
            return "high"
        if peak >= self.settings.elevated_rainfall_mm_per_hour:
            return "elevated"
        return "low"

    def _summary(self, rainfall: dict, temperature: dict):
        total = sum(point["value"] for point in rainfall["forecasts"])
        peak = max(point["value"] for point in rainfall["forecasts"])
        mean_temp = sum(point["value"] for point in temperature["forecasts"])/temperature["horizon_hours"]
        return {"rainfall_mm": total, "peak_rainfall_mm": peak, "temperature_c": mean_temp, "exposure": self.exposure(peak),
                "forecast_start": rainfall["forecast_start"], "forecast_end": rainfall["forecast_end"],
                "mode": rainfall["mode"], "source": rainfall["dataset"]["source"], "model_id": rainfall["model"]["id"], "units": "mm",
                "quantile_interpretation": rainfall["interval"], "weather_location_id": rainfall["location"]["id"],
                "last_observation_timestamp": rainfall["dataset"]["last_observation_timestamp"],
                "exposure_rule": "Category based on maximum forecast hourly median rainfall; geographic exposure only, not outage prediction"}

    def predict_sites(self, site_ids: list[str], horizon_hours: int) -> dict:
        sites, warnings = [], []
        for site in self.netops.by_ids(site_ids):
            try:
                rainfall = self.predict(site["latitude"], site["longitude"], horizon_hours, "precipitation")
                temperature = self.predict(site["latitude"], site["longitude"], horizon_hours, "temperature_2m")
                sites.append({"site": site, "rainfall": rainfall, "temperature": temperature,
                              "weather_exposure": self._summary(rainfall, temperature)})
            except WeatherError as exc:
                sites.append({"site": site, **exc.response()})
                warnings.append(f"{site['site_id']}: {exc.code}")
        return {"ok": True, "research_only": True, "mode": self.settings.mode, "generated_at": self.clock().isoformat(),
                "synthetic_network_data": True, "disclaimer": "Geographic weather exposure only; does not predict actual telecom outages.",
                "sites": sites, "warnings": warnings, "exposure_thresholds": self.thresholds()}

    def thresholds(self):
        return {"statistic": "maximum hourly median rainfall", "units": "mm/hour", "elevated": self.settings.elevated_rainfall_mm_per_hour,
                "high": self.settings.high_rainfall_mm_per_hour, "calibrated_outage_classifier": False}

    def geojson(self, region: str, horizon_hours: int) -> dict:
        if not isinstance(region, str) or len(region) > 64:
            raise WeatherError("INVALID_REGION", "Use all, a cached location ID, or a NetOps region")
        manifests = self.repository.locations()
        selected = [m for m in manifests if region.casefold() in {"all", m["id"].casefold(), m.get("region", "").casefold(), m["name"].casefold()}]
        if not selected:
            raise WeatherError("REGION_UNAVAILABLE", "No cached weather locations in that region")
        features, warnings, weather_by_id = [], [], {}
        for manifest in selected:
            rainfall = self.predict(manifest["latitude"], manifest["longitude"], horizon_hours, "precipitation")
            temperature = self.predict(manifest["latitude"], manifest["longitude"], horizon_hours, "temperature_2m")
            properties = {"kind": "weather_location", "location_name": manifest["name"], "synthetic_network_data": False,
                          **self._summary(rainfall, temperature), "forecast_quantiles": rainfall["forecasts"]}
            features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [manifest["longitude"], manifest["latitude"]]}, "properties": properties})
            weather_by_id[manifest["id"]] = (rainfall, temperature)
            warnings.extend(rainfall["warnings"])
        try:
            netops_region = None if region.casefold() == "all" else selected[0].get("region")
            inventory = self.netops.sites(netops_region)
            excluded = 0
            for site in inventory:
                nearest = min(selected, key=lambda m: distance_km(site["latitude"], site["longitude"], m["latitude"], m["longitude"]))
                distance = distance_km(site["latitude"], site["longitude"], nearest["latitude"], nearest["longitude"])
                if distance > self.settings.max_location_distance_km:
                    excluded += 1
                    continue
                rainfall, temperature = weather_by_id[nearest["id"]]
                properties = {"kind": "telecom_site", "location_name": site.get("site_name", site["site_id"]),
                              "site_id": site["site_id"], "technology": site.get("technology", "4G"), "synthetic_network_data": True,
                              "network_source": site["network_source"], "weather_distance_km": distance, **self._summary(rainfall, temperature)}
                features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [site["longitude"], site["latitude"]]}, "properties": properties})
            if excluded:
                warnings.append(f"Excluded {excluded} inventory sites outside the cached weather proximity threshold.")
            if len(inventory) >= self.settings.netops_max_sites:
                warnings.append(f"NetOps overlay capped at {self.settings.netops_max_sites} inventory sites.")
        except WeatherError as exc:
            warnings.append(exc.message)
        rainfall = next(iter(weather_by_id.values()))[0]
        return {"ok": True, "research_only": True, "mode": self.settings.mode, "generated_at": self.clock().isoformat(),
                "model": rainfall["model"], "dataset": rainfall["dataset"], "datasets": [pair[0]["dataset"] for pair in weather_by_id.values()],
                "geojson": {"type": "FeatureCollection", "features": features}, "warnings": list(dict.fromkeys(warnings)),
                "legend": {"title": "Weather exposure (maximum hourly median rainfall)", "units": "mm/hour", "thresholds": self.thresholds(),
                           "categories": [{"category": "low", "color": "#4ade80"}, {"category": "elevated", "color": "#fbbf24"}, {"category": "high", "color": "#f87171"}],
                           "rainfall_mm": "Sum of hourly forecast medians; not the median of accumulated rainfall",
                           "attribution": rainfall["dataset"]["attribution"], "disclaimer": "Experimental weather exposure, not official forecast or outage prediction"}}

    def status(self, load_model=True):
        errors, locations = [], []
        if load_model:
            try:
                self.forecaster.load()
            except WeatherError as exc:
                errors.append(exc.message)
        for manifest in self.repository.locations():
            entry = {key: manifest[key] for key in ("id", "name", "latitude", "longitude")}
            try:
                frame, _ = self.repository.load(manifest["id"])
                for target in ("precipitation", "temperature_2m"):
                    context, age = self._context(frame, target)
                entry.update(ready=True, observation_age_hours=age, last_observation_timestamp=context["timestamp"].iloc[-1].isoformat(),
                             cache_last_observation_timestamp=manifest["last_observation_timestamp"])
            except WeatherError as exc:
                entry.update(ready=False, warning=exc.message)
                errors.append(f"{manifest['id']}: {exc.message}")
            locations.append(entry)
        if not locations:
            errors.append("No validated cached datasets; run explicit ingestion")
        return {"ok": True, "ready": self.forecaster.loaded and bool(locations) and not errors,
                "mode": self.settings.mode, "model_loaded": self.forecaster.loaded, "model": self.forecaster.provenance,
                "locations": locations, "supported_horizons": list(HORIZONS), "warnings": errors,
                "read_only_inference": True, "research_only": True, "offline_model_loading": True,
                "replay_cutoff": self.settings.replay_cutoff if self.settings.mode == "replay" else None,
                "generated_at": self.clock().isoformat()}

    def metrics(self):
        try:
            report = json.loads(self.settings.metrics_path.read_text())
            # Keep agent context focused on pooled test scores. Full per-window records stay in the explicit report artifact.
            summary = {key: value for key, value in report.items()
                       if key not in {"windows", "locations", "metrics", "runtime", "skipped_windows", "model_errors"}}
            summary["metrics"] = [metric for metric in report.get("metrics", [])
                                  if metric.get("split") == "test" and metric.get("location_id") == "ALL"]
            summary["runtime"] = {key: value for key, value in report.get("runtime", {}).items() if key != "calls"}
            summary["skipped_window_count"] = len(report.get("skipped_windows", []))
            summary["model_error_count"] = len(report.get("model_errors", []))
            summary["location_count"] = len(report.get("locations", []))
            return {"available": True, "report": summary, "full_report_available": True, "research_only": True}
        except (OSError, ValueError):
            return {"available": False, "reason": "No cached evaluation report; run the explicit evaluation job", "research_only": True}
