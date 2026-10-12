"""Data locations. The intel/ml databases are the existing Order 4/5 builds; only sme_demand.csv is new."""

import os
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[3]
INTEL_DB = Path(os.environ.get("NETINTEL_DB", BACKEND / "data" / "intel.duckdb"))
ML_DB = Path(os.environ.get("MLPREDICT_DB", BACKEND / "data" / "ml.duckdb"))
SME_CSV = Path(__file__).resolve().parent / "data" / "sme_demand.csv"
