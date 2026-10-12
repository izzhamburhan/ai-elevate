"""Configuration shared by explicit acquisition jobs and read-only inference."""
from dataclasses import dataclass
from datetime import datetime, timezone
import os
from pathlib import Path

PINNED_MODEL_REVISION = "ddec01313e50b6bc58ebaa92ede81bc24a3d9f9a"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_timestamp(value: str | datetime) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00")) if isinstance(value, str) else value
    if parsed.tzinfo is None:
        raise ValueError("Timestamp must include a timezone (use UTC Z or +00:00)")
    return parsed.astimezone(timezone.utc)


@dataclass(frozen=True)
class Settings:
    data_dir: Path = Path("data")
    model_dir: Path = Path("models/chronos-2-small")
    model_id: str = "autogluon/chronos-2-small"
    model_revision: str = PINNED_MODEL_REVISION
    mode: str = "replay"
    replay_cutoff: str = "2026-09-30T23:00:00Z"
    context_hours: int = 336
    min_context_hours: int = 168
    freshness_hours: float = 6.0
    max_location_distance_km: float = 50.0
    cpu_threads: int = 2
    netops_url: str = "http://localhost:8000"
    netops_max_sites: int = 200
    elevated_rainfall_mm_per_hour: float = 2.5
    high_rainfall_mm_per_hour: float = 10.0
    metrics_path: Path = Path("data/evaluation/report.json")
    host: str = "127.0.0.1"
    port: int = 8001

    def __post_init__(self):
        if self.mode not in {"replay", "live"}:
            raise ValueError("WEATHER_MODE must be replay or live")
        if self.min_context_hours < 24 or self.context_hours < self.min_context_hours:
            raise ValueError("Context must be at least the minimum (minimum >=24)")
        if not 1 <= self.cpu_threads <= 16:
            raise ValueError("WEATHER_CPU_THREADS must be between 1 and 16")
        if self.freshness_hours <= 0 or self.max_location_distance_km <= 0:
            raise ValueError("Freshness and location distance must be positive")
        if not 0 <= self.elevated_rainfall_mm_per_hour < self.high_rainfall_mm_per_hour:
            raise ValueError("Exposure thresholds must be nonnegative and increasing")
        if self.mode == "replay":
            cutoff = utc_timestamp(self.replay_cutoff)
            if cutoff.minute or cutoff.second or cutoff.microsecond:
                raise ValueError("Replay cutoff must fall exactly on a UTC hour")

    @classmethod
    def from_env(cls):
        data_dir = Path(os.getenv("WEATHER_DATA_DIR", "data"))
        return cls(
            data_dir=data_dir,
            model_dir=Path(os.getenv("WEATHER_MODEL_DIR", "models/chronos-2-small")),
            model_id=os.getenv("WEATHER_MODEL_ID", "autogluon/chronos-2-small"),
            model_revision=os.getenv("WEATHER_MODEL_REVISION", PINNED_MODEL_REVISION),
            mode=os.getenv("WEATHER_MODE", "replay"),
            replay_cutoff=os.getenv("WEATHER_REPLAY_CUTOFF", "2026-09-30T23:00:00Z"),
            context_hours=int(os.getenv("WEATHER_CONTEXT_HOURS", "336")),
            min_context_hours=int(os.getenv("WEATHER_MIN_CONTEXT_HOURS", "168")),
            freshness_hours=float(os.getenv("WEATHER_FRESHNESS_HOURS", "6")),
            max_location_distance_km=float(os.getenv("WEATHER_MAX_LOCATION_DISTANCE_KM", "50")),
            cpu_threads=int(os.getenv("WEATHER_CPU_THREADS", "2")),
            netops_url=os.getenv("WEATHER_NETOPS_URL", "http://localhost:8000").rstrip("/"),
            netops_max_sites=int(os.getenv("WEATHER_NETOPS_MAX_SITES", "200")),
            elevated_rainfall_mm_per_hour=float(os.getenv("WEATHER_ELEVATED_RAINFALL_MM_PER_HOUR", "2.5")),
            high_rainfall_mm_per_hour=float(os.getenv("WEATHER_HIGH_RAINFALL_MM_PER_HOUR", "10")),
            metrics_path=Path(os.getenv("WEATHER_METRICS_PATH", str(data_dir / "evaluation/report.json"))),
            host=os.getenv("WEATHER_HTTP_HOST", "127.0.0.1"),
            port=int(os.getenv("WEATHER_HTTP_PORT", "8001")),
        )
