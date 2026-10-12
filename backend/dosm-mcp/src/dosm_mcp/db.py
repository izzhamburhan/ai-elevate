"""Paths of the local DOSM cache and a read-only DuckDB connection to it."""

from __future__ import annotations

import os
import re
from pathlib import Path

import duckdb

DATA_DIR = Path(os.environ.get("DOSM_DATA_DIR", Path(__file__).resolve().parents[2] / "data"))
DB_PATH = DATA_DIR / "dosm.duckdb"
PARQUET_DIR = DATA_DIR / "parquet"
STATE_PATH = DATA_DIR / "state.json"


def table_name(dataset_id: str) -> str:
    """DuckDB table for a dataset id: ids like sdg_03-3-1 become sdg_03_3_1."""
    return re.sub(r"\W", "_", dataset_id.lower())


def connect(path: Path = DB_PATH) -> duckdb.DuckDBPyConnection:
    """Read-only, and no file or network access beyond this database, so free-form SQL is safe to run."""
    return duckdb.connect(str(path), read_only=True, config={"enable_external_access": False})
