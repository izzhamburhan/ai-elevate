"""Where the data and the trained models live. All overridable by environment, all under backend/data by default."""

from __future__ import annotations

import os
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[3]


def intel_db() -> Path:
    return Path(os.environ.get("NETINTEL_DB", BACKEND / "data" / "intel.duckdb"))


def ml_db() -> Path:
    return Path(os.environ.get("MLPREDICT_DB", BACKEND / "data" / "ml.duckdb"))


def models_dir() -> Path:
    return Path(os.environ.get("MLPREDICT_MODELS", BACKEND / "data" / "models"))