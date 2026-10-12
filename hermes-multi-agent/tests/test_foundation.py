"""Adapter unit tests use explicitly synthetic fixtures; runtime qualification is separate."""
import asyncio
from pathlib import Path

import httpx
from pydantic import ValidationError
import pytest

from elevate_hermes.config import Settings
from elevate_hermes.contracts import InvestigationRequest, compact_tool_result, source_summary
from elevate_hermes.server import build
from elevate_hermes.store import Store, source_geojson


def test_investigation_rejects_paths_profiles_and_tool_injection():
    with pytest.raises(ValidationError):
        InvestigationRequest(agent_id="../../engineer", prompt="test")
    with pytest.raises(ValidationError):
        InvestigationRequest(agent_id="forecast", prompt="test", session_id="../engineer")
    with pytest.raises(ValidationError):
        InvestigationRequest(agent_id="forecast", prompt="test", tools=["terminal"])


def test_durable_ledger_and_interrupted_job_recovery(tmp_path):
    store = Store(tmp_path / "jobs.sqlite")
    interrupted = store.create("forecast", "synthetic test fixture")
    completed = store.create("engineer", "synthetic test fixture")
    store.update(completed["investigation_id"], lambda job: job.update(status="completed", summary="fixture"))
    restored = Store(tmp_path / "jobs.sqlite")
    restored.recover_interrupted()
    assert restored.get(interrupted["investigation_id"])["status"] == "failed"
    assert "restarted" in restored.get(interrupted["investigation_id"])["error"]
    assert restored.get(completed["investigation_id"])["summary"] == "fixture"


def test_failed_or_prose_only_findings_cannot_create_map_points():
    assert source_geojson([{"ok": False, "data": {"sites": [{"latitude": 3, "longitude": 101}]}}]) is None
    assert source_geojson([{"ok": True, "tool": "fixture", "agent_id": "engineer", "data": {"text": "latitude 3 longitude 101"}}]) is None


def test_factual_map_coordinates_and_source_classes():
    evidence = [
        {"ok": True, "tool": "get_sites", "agent_id": "engineer", "source": {"synthetic": True},
         "data": {"sites": [{"site_id": "TEST-SYNTHETIC", "latitude": 3.1, "longitude": 101.5}]}},
        {"ok": True, "tool": "search_locations", "agent_id": "business", "source": {"synthetic": False},
         "data": {"items": [{"id": "FIXTURE-GEO", "lat": 3.2, "lng": 101.6, "attribution": "test-only fixture"}]}},
    ]
    geo = source_geojson(evidence)
    assert len(geo["features"]) == 2
    assert geo["features"][0]["geometry"]["coordinates"] == [101.5, 3.1]
    assert geo["features"][0]["properties"]["synthetic_network_data"] is True
    assert geo["features"][1]["properties"]["synthetic_network_data"] is False
    assert geo["features"][1]["properties"]["kind"] == "geographic_location"


def test_invalid_coordinates_are_not_rendered():
    call = {"ok": True, "tool": "get_sites", "agent_id": "engineer", "data": {"sites": [
        {"latitude": float("nan"), "longitude": 101}, {"latitude": 91, "longitude": 101}, {"latitude": True, "longitude": 101}]}}
    assert source_geojson([call]) is None


def test_compact_model_context_does_not_mutate_full_evidence():
    features = [{"type": "Feature", "properties": {"kind": "telecom_site", "site_id": f"FIXTURE-{i}"}} for i in range(30)]
    result = {"ok": True, "data": {"geojson": {"type": "FeatureCollection", "features": features}}}
    bounded = compact_tool_result(result)
    assert len(bounded["data"]["geojson"]["features"]) == 3
    assert len(result["data"]["geojson"]["features"]) == 30
    assert bounded["data"]["full_feature_count"] == 30


def test_source_labels_preserve_real_geography_and_replay():
    assert source_summary("netops", "search_locations", "fixture", {"synthetic": False, "data_kind": "real_geographic_dataset"})["synthetic"] is False
    assert source_summary("weather", "predict_rainfall", "fixture")["synthetic"] is False
    assert source_summary("netops", "get_sites", "fixture")["synthetic"] is True


def test_internal_delegation_requires_active_worker_authorization(tmp_path):
    async def check():
        app = build(Settings(state_dir=tmp_path))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/internal/delegate", json={"investigation_id": "fixture", "parent_task_id": "fixture", "agent_id": "engineer", "task": "synthetic test"})
            assert response.status_code == 403
            response = await client.post("/api/investigations", json={"agent_id": "forecast", "prompt": "test", "url": "http://unapproved"})
            assert response.status_code == 422
    asyncio.run(check())


def test_specialist_cannot_delegate_even_with_valid_worker_token(tmp_path):
    async def check():
        app = build(Settings(state_dir=tmp_path))
        runtime = app.state.runtime
        job = runtime.store.create("forecast", "synthetic unit fixture")
        runtime.tokens[job["investigation_id"]] = "unit-test-only-token"
        runtime.store.update(job["investigation_id"], lambda value: value["tasks"].append({"task_id": "fixture", "agent_id": "forecast", "status": "running"}))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/internal/delegate", headers={"X-Elevate-Worker-Token": "unit-test-only-token"}, json={
                "investigation_id": job["investigation_id"], "parent_task_id": "fixture", "agent_id": "engineer", "task": "fixture"})
            assert response.status_code == 403
    asyncio.run(check())


def test_final_report_drops_only_narration_before_first_heading():
    from elevate_hermes.contracts import final_report
    text = "The response is truncated. Let me parse it.\n\n## Findings\nCB5348 low exposure."
    assert final_report(text) == ("## Findings\nCB5348 low exposure.", True)
    assert final_report("## Findings\nok") == ("## Findings\nok", False)
    assert final_report("No heading at all.") == ("No heading at all.", False)


def test_report_claims_about_unexecuted_tools_are_flagged():
    from elevate_hermes.contracts import unexecuted_tool_claims
    approved = {"get_sites", "get_ran_kpi", "get_ntt_tickets"}
    summary = "No NTTs were returned when queried with `get_ntt_tickets`; get_sites listed CB5348."
    assert unexecuted_tool_claims(summary, approved, {"get_sites", "get_ran_kpi"}) == ["get_ntt_tickets"]
    assert unexecuted_tool_claims(summary, approved, approved) == []
    assert unexecuted_tool_claims("get_ran_kpi_summary only", {"get_ran_kpi"}, set()) == []
