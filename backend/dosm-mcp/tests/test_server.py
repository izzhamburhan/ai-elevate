from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest
from dosm_mcp.server import build_server
from fastmcp.exceptions import ToolError

TOOLS = {
    "dosm_search_datasets",
    "dosm_describe_dataset",
    "dosm_query_dataset",
    "dosm_sql",
    "dosm_area_profile",
    "dosm_economy_snapshot",
}


def call(db_file: Path, name: str, args: dict[str, Any]) -> Any:
    return asyncio.run(build_server(db_file).call_tool(name, args)).structured_content


def test_server_registers_the_tools(db_file: Path) -> None:
    tools = asyncio.run(build_server(db_file).list_tools())
    assert {t.name for t in tools} == TOOLS


def test_responses_are_real_data_envelopes(db_file: Path) -> None:
    payload = call(db_file, "dosm_search_datasets", {"query": "household income"})
    assert payload["synthetic"] is False
    assert payload["evidence"][0]["source"] == "dosm-mcp"
    assert payload["data"]["datasets"][0]["dataset_id"] == "hh_income_district"


def test_describe_lists_column_values_and_converts_dates(db_file: Path) -> None:
    data = call(db_file, "dosm_describe_dataset", {"dataset_id": "population_state"})["data"]
    state = next(c for c in data["columns"] if c["name"] == "state")
    date = next(c for c in data["columns"] if c["name"] == "date")
    assert state["values"] == ["Selangor", "W.P. Kuala Lumpur"]
    assert date["type"] == "DATE"
    assert data["date_range"] == {"first": "2025-01-01", "latest": "2026-01-01"}


def test_query_matches_place_aliases_and_renamed_districts(db_file: Path) -> None:
    kl = call(db_file, "dosm_query_dataset", {"dataset_id": "population_state", "filters": {"state": "KL"}, "latest": True})
    assert [r["population"] for r in kl["data"]["rows"]] == [2010.0]
    income = call(db_file, "dosm_query_dataset", {"dataset_id": "hh_income_district", "filters": {"district": "hulu langat"}})
    assert [r["district"] for r in income["data"]["rows"]] == ["Ulu Langat", "Hulu Langat"]


def test_query_rejects_unknown_column(db_file: Path) -> None:
    with pytest.raises(ToolError, match="No column 'nope'"):
        call(db_file, "dosm_query_dataset", {"dataset_id": "population_state", "filters": {"nope": 1}})


def test_unknown_or_missing_dataset_says_what_to_do(db_file: Path) -> None:
    with pytest.raises(ToolError, match="population_state"):
        call(db_file, "dosm_describe_dataset", {"dataset_id": "population_stat"})
    with pytest.raises(ToolError, match="dosm_mcp.download not_downloaded"):
        call(db_file, "dosm_describe_dataset", {"dataset_id": "not_downloaded"})


def test_sql_reads_tables_including_renamed_ids(db_file: Path) -> None:
    payload = call(db_file, "dosm_sql", {"sql": "SELECT value FROM sdg_03_3_1"})
    assert payload["data"]["rows"] == [{"value": 1.5}]


@pytest.mark.parametrize(
    "sql",
    ["DROP TABLE population_state", "SELECT 1; SELECT 2", "SELECT * FROM read_csv('C:/Windows/win.ini')"],
)
def test_sql_is_read_only_and_sandboxed(db_file: Path, sql: str) -> None:
    with pytest.raises(ToolError):
        call(db_file, "dosm_sql", {"sql": sql})


def test_area_profile_for_a_district(db_file: Path) -> None:
    data = call(db_file, "dosm_area_profile", {"state": "selangor", "district": "Hulu Langat"})["data"]
    assert data["district"] == "Ulu Langat"
    assert data["population"]["thousands"] == 1526.4
    assert data["household_income_rm"]["income_median"] == 11404


def test_area_profile_population_growth(db_file: Path) -> None:
    data = call(db_file, "dosm_area_profile", {"state": "Kuala Lumpur"})["data"]
    assert data["state"] == "W.P. Kuala Lumpur"
    assert data["population"]["growth_pct"] == 0.5


def test_economy_snapshot_reads_reserved_word_columns(db_file: Path) -> None:
    data = call(db_file, "dosm_economy_snapshot", {})["data"]
    assert data["economic_indicators"]["leading"] == 110.1
