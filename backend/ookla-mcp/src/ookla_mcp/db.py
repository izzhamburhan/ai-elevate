"""DuckDB connection with httpfs, spatial and h3 loaded, plus the cached layer paths."""

from __future__ import annotations

from pathlib import Path

import duckdb

DATA_DIR = Path(__file__).resolve().parents[2] / "data"


def layer_path(type_: str, year: int, quarter: int, res: int) -> Path:
    return DATA_DIR / f"{type_}_{year}q{quarter}_r{res}.parquet"


def connect() -> duckdb.DuckDBPyConnection:
    conn = duckdb.connect()
    conn.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; INSTALL h3 FROM community; LOAD h3;")
    return conn
