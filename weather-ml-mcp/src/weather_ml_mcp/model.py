"""Official Chronos dataframe interface, local CPU weights only."""
from hashlib import sha256
from importlib.metadata import version
import json
import logging
import threading

import numpy as np
import pandas as pd

from .config import Settings
from .errors import WeatherError

log = logging.getLogger(__name__)


def file_sha256(path):
    digest = sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


class LocalChronos:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.pipeline = None
        self._lock = threading.RLock()
        self.last_error = None
        self.provenance = None

    @property
    def loaded(self):
        return self.pipeline is not None

    def load(self):
        with self._lock:
            if self.pipeline is not None:
                return
            try:
                model_dir = self.settings.model_dir
                manifest = json.loads((model_dir / "weather-model.json").read_text())
                if manifest["id"] != self.settings.model_id:
                    raise ValueError("Model identifier differs from configuration")
                if self.settings.model_revision and manifest["revision"] != self.settings.model_revision:
                    raise ValueError("Model revision differs from configuration")
                for filename in ("config.json", "model.safetensors"):
                    if file_sha256(model_dir / filename) != manifest["sha256"][filename]:
                        raise ValueError("Model cache checksum mismatch")
                import torch
                from chronos import BaseChronosPipeline
                torch.set_num_threads(self.settings.cpu_threads)
                # No hub identifier is passed, remote code is disabled, and HF offline env is set in the container.
                self.pipeline = BaseChronosPipeline.from_pretrained(
                    str(model_dir.resolve()), device_map="cpu", torch_dtype=torch.float32,
                    local_files_only=True, trust_remote_code=False,
                )
                self.pipeline.model.eval()
                self.provenance = {"id": manifest["id"], "revision": manifest["revision"],
                                   "framework": "chronos-forecasting", "framework_version": version("chronos-forecasting"),
                                   "license": "Apache-2.0", "device": "cpu", "fine_tuned": False}
                self.last_error = None
                log.info("model_loaded", extra={"model_id": manifest["id"], "revision": manifest["revision"], "device": "cpu"})
            except Exception as exc:
                self.pipeline = None
                self.last_error = "Cached model unavailable, invalid, or incompatible; run bootstrap and verify pinned dependencies"
                log.error("model_load_failed", extra={"error_type": type(exc).__name__})
                raise WeatherError("MODEL_UNAVAILABLE", self.last_error, status=503) from exc

    def predict(self, frame: pd.DataFrame, target: str, horizon: int) -> pd.DataFrame:
        """Forecast exactly one target with past observations only; raw quantiles used by evaluation too."""
        self.load()
        if target not in {"precipitation", "temperature_2m"} or horizon not in (6, 12, 24):
            raise WeatherError("INVALID_PREDICTION_REQUEST", "Only precipitation/temperature_2m and 6/12/24 hours are supported")
        context = frame[["timestamp", target]].copy()
        if context[target].isna().any():
            raise WeatherError("MISSING_CONTEXT", "Model context contains missing target observations")
        # Chronos uses naive datetimes internally. These remain UTC, then outputs are reattached to UTC.
        context["timestamp"] = pd.to_datetime(context["timestamp"], utc=True).dt.tz_localize(None)
        context["item_id"] = target
        try:
            with self._lock:
                import torch
                with torch.inference_mode():
                    result = self.pipeline.predict_df(context, prediction_length=horizon,
                        quantile_levels=[0.1, 0.5, 0.9], id_column="item_id", timestamp_column="timestamp",
                        target=target, batch_size=1, context_length=self.settings.context_hours)
            result["timestamp"] = pd.to_datetime(result["timestamp"], utc=True)
            columns = ["predictions", "0.1", "0.5", "0.9"]
            if len(result) != horizon or not np.isfinite(result[columns].to_numpy(dtype=float)).all():
                raise ValueError("Nonfinite or incomplete model predictions")
            if not ((result["0.1"] <= result["0.5"]) & (result["0.5"] <= result["0.9"])).all():
                raise ValueError("Crossing quantiles")
            if target == "precipitation":
                result[columns] = result[columns].clip(lower=0)
            return result
        except WeatherError:
            raise
        except Exception as exc:
            log.error("inference_failed", extra={"error_type": type(exc).__name__, "target": target})
            raise WeatherError("INFERENCE_FAILED", "Local Chronos inference failed; no forecast values are available", status=503) from exc
