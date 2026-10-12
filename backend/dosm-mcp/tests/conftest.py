from __future__ import annotations

from pathlib import Path
from typing import Any

import duckdb
import pytest
from dosm_mcp import download

TABLES = {
    "population_state": """
        SELECT * FROM (VALUES
            ('W.P. Kuala Lumpur', TIMESTAMP '2025-01-01', 'both', 'overall', 'overall', 2000.0),
            ('W.P. Kuala Lumpur', TIMESTAMP '2026-01-01', 'both', 'overall', 'overall', 2010.0),
            ('Selangor', TIMESTAMP '2026-01-01', 'both', 'overall', 'overall', 7400.0)
        ) t(state, date, sex, age, ethnicity, population)""",
    "population_district": """
        SELECT * FROM (VALUES
            ('Selangor', 'Ulu Langat', TIMESTAMP '2026-01-01', 'both', 'overall', 'overall', 1526.4),
            ('Selangor', 'Petaling', TIMESTAMP '2026-01-01', 'both', 'overall', 'overall', 2300.0)
        ) t(state, district, date, sex, age, ethnicity, population)""",
    "hh_income_district": """
        SELECT * FROM (VALUES
            ('Selangor', 'Hulu Langat', TIMESTAMP '2022-01-01', 10000, 8000),
            ('Selangor', 'Ulu Langat', TIMESTAMP '2024-01-01', 13000, 11404)
        ) t(state, district, date, income_mean, income_median)""",
    "economic_indicators": """
        SELECT * FROM (VALUES (TIMESTAMP '2026-07-01', 110.1, 120.2, 130.3)) t(date, "leading", coincident, lagging)""",
    "sdg_03-3-1": "SELECT 2024 AS year, 1.5 AS value",
}


def _entry(dataset_id: str, title: str, category: str, geography: list[str]) -> dict[str, Any]:
    return {
        "id": dataset_id,
        "table_name": download.table_name(dataset_id),
        "title": title,
        "description": f"{title} description",
        "category": category,
        "subcategory": category,
        "frequency": "YEARLY",
        "geography": geography,
        "demography": [],
        "dataset_begin": 2019,
        "dataset_end": 2026,
        "data_as_of": "2026",
        "last_updated": "2026-10-07 13:00",
        "next_update": "",
        "methodology": "",
        "caveat": "",
        "link_parquet": f"https://storage.dosm.gov.my/x/{dataset_id}.parquet",
        "link_csv": "",
        "fields": [{"name": "state", "title": "State", "description": "[Categorical] One of 16 states"}],
    }


CATALOGUE = [
    _entry("population_state", "Population Table: States", "Demography", ["STATE"]),
    _entry("population_district", "Population Table: Administrative Districts", "Demography", ["DISTRICT"]),
    _entry("hh_income_district", "Household Income by Administrative District", "Households", ["DISTRICT"]),
    _entry("economic_indicators", "Malaysian Economic Indicators", "Statistical Indicators", ["NATIONAL"]),
    _entry("sdg_03-3-1", "SDG 3.3.1", "Statistical Indicators", ["NATIONAL"]),
    _entry("not_downloaded", "Never downloaded", "Prices", ["NATIONAL"]),
]


@pytest.fixture(scope="session")
def db_file(tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("dosm")
    parquet = root / "parquet"
    parquet.mkdir()
    conn = duckdb.connect()
    for dataset_id, sql in TABLES.items():
        conn.execute(f"COPY ({sql}) TO '{(parquet / f'{dataset_id}.parquet').as_posix()}' (FORMAT parquet)")
    conn.close()
    mp = pytest.MonkeyPatch()
    mp.setattr(download, "DATA_DIR", root)
    mp.setattr(download, "PARQUET_DIR", parquet)
    mp.setattr(download, "DB_PATH", root / "dosm.duckdb")
    try:
        return download.build_db(CATALOGUE)
    finally:
        mp.undo()
