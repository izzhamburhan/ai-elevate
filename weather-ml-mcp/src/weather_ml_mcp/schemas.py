"""Strict structured output schemas for agent consumption."""
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Location(StrictModel):
    id: str
    name: str
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    requested_latitude: float = Field(ge=-90, le=90)
    requested_longitude: float = Field(ge=-180, le=180)
    distance_km: float = Field(ge=0)
    coordinate_system: str = "EPSG:4326"
    display_timezone: str = "Asia/Kuala_Lumpur"


class ModelProvenance(StrictModel):
    id: str
    revision: str
    framework: str = "chronos-forecasting"
    framework_version: str
    license: str = "Apache-2.0"
    device: str = "cpu"
    fine_tuned: bool = False


class DatasetProvenance(StrictModel):
    source: str
    last_observation_timestamp: datetime
    acquired_at: datetime
    license: str
    attribution: str
    sha256: str
    weather_data_kind: str = "gridded_reanalysis_estimates"
    observation_age_hours: float = Field(ge=0)
    requested_coordinate: list[float]
    grid_coordinate: list[float]
    missing_records: int = Field(ge=0)


class ForecastPoint(StrictModel):
    timestamp: datetime
    local_timestamp: str
    value: float
    quantiles: dict[str, float]

    @model_validator(mode="after")
    def ordered_quantiles(self):
        if set(self.quantiles) != {"0.1", "0.5", "0.9"}:
            raise ValueError("Forecast must have 0.1/0.5/0.9 quantiles")
        if not self.quantiles["0.1"] <= self.quantiles["0.5"] <= self.quantiles["0.9"]:
            raise ValueError("Forecast quantiles are not ordered")
        return self


class Forecast(StrictModel):
    ok: bool = True
    research_only: bool = True
    disclaimer: str = "Experimental local ML prediction; not an official meteorological forecast."
    mode: Literal["replay", "live"]
    target: Literal["precipitation", "temperature_2m"]
    horizon_hours: Literal[6, 12, 24]
    generated_at: datetime
    forecast_start: datetime
    forecast_end: datetime
    units: str
    point_estimate: str = "median"
    location: Location
    model: ModelProvenance
    dataset: DatasetProvenance
    context_start: datetime
    context_end: datetime
    context_records: int
    interval: str = "10th–90th prediction quantiles; nominal 80% interval, not calibrated rainfall-event probability"
    inference_seconds: float = Field(ge=0)
    forecasts: list[ForecastPoint]
    warnings: list[str]

    @model_validator(mode="after")
    def aligned(self):
        if len(self.forecasts) != self.horizon_hours:
            raise ValueError("Forecast output does not match requested horizon")
        if self.forecast_start <= self.context_end:
            raise ValueError("Forecast must follow the historical context")
        return self
