"""Opportunity graph and ranking over a small fake network (explicitly synthetic fixtures)."""

from __future__ import annotations

import asyncio
import csv
import json
from pathlib import Path

import pytest
from fastmcp import Client
from opportunity_mcp import graph, paths, rank, server, sme_seed


@pytest.fixture()
def og(built: dict[str, Path]) -> graph.OpportunityGraph:
    return graph.build(built["intel"], built["ml"], built["sme"])


def test_sme_seed_is_deterministic_labelled_and_tied_to_existing_areas(built):
    first, second = sme_seed.build_rows(built["intel"]), sme_seed.build_rows(built["intel"])
    assert first == second
    assert {row["synthetic"] for row in first} == {"true"} and {row["generator"] for row in first} == {sme_seed.GENERATOR}
    for row in first:
        assert row["sme_count"] > 0 and 20 <= row["fibre_serviceable_pct"] <= 95


def test_committed_seed_matches_its_generator_when_real_data_exists():
    if not paths.INTEL_DB.exists():
        pytest.skip("real intel.duckdb not built on this machine")
    with paths.SME_CSV.open(encoding="utf-8") as handle:
        committed = list(csv.DictReader(handle))
    assert committed == [{k: str(v) for k, v in row.items()} for row in sme_seed.build_rows()]


def test_graph_connects_every_site_to_one_area_and_every_area_to_demand(og):
    for site in og.nodes("site"):
        assert len(og.neighbours(site, "area")) == 1
    for area in og.nodes("area"):
        assert len(og.neighbours(area, "sme")) == 1
    summary = og.summary()
    assert summary["node_kinds"]["area"] == summary["node_kinds"]["sme"]
    assert og.provenance["synthetic"] is True


def test_discovery_is_deterministic_explainable_and_never_claims_revenue(og):
    first, second = rank.discover(og, 3), rank.discover(og, 3)
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)
    opportunities = first["opportunities"]
    assert [o["rank"] for o in opportunities] == list(range(1, len(opportunities) + 1))
    assert len({o["where"]["area_id"] for o in opportunities}) == len(opportunities)
    scores = [o["scores"]["overall"] for o in opportunities]
    assert scores == sorted(scores, reverse=True)
    for o in opportunities:
        assert o["synthetic"] is True and o["why"] and o["what_tm_should_do"] and o["risks"]
        assert 0 < o["confidence"] <= 0.85
        assert all("synthetic" in line.lower() for line in o["why"])  # every SME, event, footfall and serviceability figure is labelled
        assert o["validation_status"] == "graph-ranked; not validated by agents"
        low, high = o["commercial_potential"]["indicative_monthly_recurring_rm"]
        assert 0 <= low <= high and "Not verified revenue" in o["commercial_potential"]["label"]
    kinds = {f["properties"]["kind"] for f in first["geojson"]["features"]}
    assert "opportunity" in kinds
    for feature in first["geojson"]["features"]:
        lng, lat = feature["geometry"]["coordinates"]
        assert -180 <= lng <= 180 and -90 <= lat <= 90 and feature["properties"]["synthetic"] is True


def test_server_lists_three_read_only_tools_and_rejects_unknown_areas(built, monkeypatch):
    monkeypatch.setattr(paths, "INTEL_DB", built["intel"])
    server._graph.cache_clear()
    monkeypatch.setattr(server, "_graph", lambda: graph.build(built["intel"], built["ml"], built["sme"]))

    async def check():
        async with Client(server.build_server()) as client:
            tools = await client.list_tools()
            assert {t.name for t in tools} == {"opportunity_discover", "opportunity_explain", "opportunity_graph_summary"}
            assert all(t.annotations.read_only_hint and not t.annotations.destructive_hint for t in tools)
            result = await client.call_tool("opportunity_discover", {"top_k": 2})
            assert result.structured_content["synthetic"] is True
            assert len(result.structured_content["data"]["opportunities"]) <= 2
            explained = await client.call_tool("opportunity_explain", {"area": "Shah Alam"})
            assert explained.structured_content["data"]["signals"]["cluster"] == "Shah Alam"
            failed = await client.call_tool("opportunity_explain", {"area": "Atlantis"}, raise_on_error=False)
            assert failed.is_error
    asyncio.run(check())
