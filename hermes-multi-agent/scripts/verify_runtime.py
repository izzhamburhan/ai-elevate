#!/usr/bin/env python3
"""Qualify actual local HTTP, Hermes/MCP evidence and optional Next.js boundaries.

This script never substitutes fixtures or generated weather/telemetry. It submits
real investigations, which may update the selected Hermes profile's memory. It
does not restart services, reset databases, or modify unrelated containers.
"""

from __future__ import annotations

import argparse
from datetime import datetime
import json
import math
from pathlib import Path
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen


AGENTS = {"orchestrator", "forecast", "business", "engineer", "hypothesis"}
OPPORTUNITY_TOOLS = {"opportunity_discover", "opportunity_explain"}
SIMULATE_TOOLS = {"opportunity_simulate"}
TERMINAL = {"completed", "partial", "failed"}
FORECAST_TOOLS = {
    "predict_rainfall", "predict_temperature", "predict_weather_for_sites", "get_weather_forecast_geojson",
}
NETWORK_KPI_TOOLS = {"get_ran_kpi", "get_ran_kpi_summary", "get_congested_cells", "get_worst_cells"}
BUSINESS_TOOLS = {
    "get_sites", "get_site_info", "search_locations", "list_location_categories", "lookup_admin_area",
    "list_admin_areas", "get_admin_boundary",
}
# The Order 2 demonstration request, verbatim.
DEMO_PROMPT = "Investigate telecom sites in Selangor that may be exposed to heavy rainfall."
# Order 6: the Decision Time Machine "Explain with AI" request for the pitch scenario.
EXPLAIN_PROMPT = ("Decision Time Machine: explain the trade-offs and recommend a strategy for opportunity_id=OPP-SME-FIBRE-JOHORB with "
                  "budget_rm=50000, demand_multiplier=1.0, network_risk=medium. Call opportunity_simulate once with exactly these inputs.")
# Order 4: the frontend "Discover opportunities" action sends this request to the Business Hypothesis agent.
DISCOVER_PROMPT = ("Discover the top three TM business opportunities from the Telco Opportunity Graph, form a testable hypothesis "
                   "for each, have the Engineer validate network feasibility for their supporting sites, and report where, why and what TM should do.")
SMOKE_PROMPTS = {
    "forecast": "Use actual Weather ML MCP to assess six-hour rainfall in Kuala Lumpur historical replay. Preserve units, timestamps, source attribution and limitations. Do not invent rainfall.",
    "business": "Assess geographic suitability for a temporary sales booth around Kuala Lumpur using approved existing geographic tools. Distinguish real geography from synthetic scenarios; do not invent measured crowds, attendance or revenue.",
    "engineer": "Investigate synthetic 4G site evening congestion around Shah Alam using actual NetOps MCP network KPI records dated 2026-09-25. Distinguish recorded synthetic telemetry from hypotheses and recommendations.",
}


class QualificationError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise QualificationError(message)


def origin(value: str) -> str:
    parts = urlsplit(value)
    require(parts.scheme in {"http", "https"} and bool(parts.hostname), "Use a configured HTTP(S) service origin")
    require(not parts.username and not parts.password and not parts.query and not parts.fragment, "Origins must not contain credentials, query or fragment")
    require(parts.path in {"", "/"}, "Supply a service origin, without an API path")
    return value.rstrip("/")


def request_json(url: str, body: dict[str, Any] | None = None, timeout: float = 20) -> Any:
    headers = {"Accept": "application/json"}
    encoded = None
    if body is not None:
        encoded = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
        parts = urlsplit(url)
        headers["Origin"] = f"{parts.scheme}://{parts.netloc}"
    request = Request(url, data=encoded, headers=headers, method="POST" if body is not None else "GET")
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except HTTPError as exc:
        # Report service-provided application errors, never credentials or configuration.
        detail = exc.read(2_000).decode("utf-8", errors="replace")
        raise QualificationError(f"HTTP {exc.code}: {detail}") from exc
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise QualificationError(f"Configured local service unavailable or invalid JSON ({type(exc).__name__})") from exc


def valid_timestamp(value: Any) -> bool:
    try:
        return isinstance(value, str) and datetime.fromisoformat(value.replace("Z", "+00:00")).utcoffset() is not None
    except ValueError:
        return False


def validate_agents(payload: Any) -> dict[str, Any]:
    require(isinstance(payload, dict) and payload.get("ready") is True, "Hermes API is not ready")
    profiles = payload.get("agents", [])
    require(isinstance(profiles, list), "Agent discovery must return an array")
    require({item.get("agent_id") for item in profiles} == AGENTS and len(profiles) == len(AGENTS), "Expected five distinct Hermes profiles")
    for agent in profiles:
        name = agent["agent_id"]
        require(agent.get("available") is True, f"Hermes profile {name} is unavailable")
        require(bool(agent.get("name")) and isinstance(agent.get("capabilities"), list) and bool(agent["capabilities"]), f"Profile {name} lacks identity or capabilities")
    return payload


def validate_geojson(value: Any) -> int:
    require(isinstance(value, dict) and value.get("type") == "FeatureCollection", "Investigation must return actual map-compatible GeoJSON")
    features = value.get("features")
    require(isinstance(features, list) and len(features) > 0, "Investigation returned no source-backed geographic findings")
    for index, feature in enumerate(features):
        require(isinstance(feature, dict) and feature.get("type") == "Feature", f"Invalid GeoJSON feature {index}")
        geometry = feature.get("geometry", {})
        require(geometry.get("type") == "Point", f"Expected point geography at feature {index}")
        coordinates = geometry.get("coordinates", [])
        require(isinstance(coordinates, list) and len(coordinates) == 2, f"Invalid WGS84 coordinates at feature {index}")
        require(all(isinstance(item, (int, float)) and not isinstance(item, bool) and math.isfinite(item) for item in coordinates), f"Non-finite coordinates at feature {index}")
        require(-180 <= coordinates[0] <= 180 and -90 <= coordinates[1] <= 90, f"WGS84 coordinate bounds failed at feature {index}")
        properties = feature.get("properties")
        require(isinstance(properties, dict), f"Missing GeoJSON properties at feature {index}")
        require(properties.get("synthetic_weather_data") is not True and properties.get("synthetic_weather") is not True, "Synthetic weather must not be represented as actual Chronos historical replay")
    return len(features)


def successful_tool_calls(task: dict[str, Any]) -> list[dict[str, Any]]:
    calls = task.get("tool_calls", [])
    require(isinstance(calls, list), f"Task {task.get('task_id')} tool_calls must be an array")
    # An execution record must declare success. Mere tool names or proposed calls do not qualify.
    return [call for call in calls if isinstance(call, dict) and call.get("ok") is True and isinstance(call.get("tool"), str)]


def validate_evidence(task: dict[str, Any], expected_tools: set[str], service: str) -> list[str]:
    agent = task.get("agent_id")
    calls = successful_tool_calls(task)
    tools = {call["tool"] for call in calls}
    require(bool(tools & expected_tools), f"{agent} has no successful actual {service} tool execution among {sorted(expected_tools)}")
    for call in calls:
        require(call.get("runtime") == "hermes-agent" and call.get("agent_id") == agent, f"{agent} tool call lacks its actual Hermes execution identity")
        require(valid_timestamp(call.get("executed_at")) and "data" in call, f"{agent} tool call lacks raw result or execution timestamp")
        source = call.get("source", {})
        require(isinstance(source, dict) and source.get("read_only") is True, f"{agent} tool call lacks read-only source provenance")
        if call["tool"] in expected_tools:
            require(source.get("service") == service, f"{agent} executed tool has incorrect upstream service provenance")
    sources = task.get("sources", [])
    require(isinstance(sources, list) and len(sources) > 0, f"{agent} returned no evidence sources")
    require(any(isinstance(source, dict) and source.get("tool") in tools for source in sources), f"{agent} sources do not reference its executed tools")
    if service == "weather":
        weather_sources = [source for source in sources if isinstance(source, dict) and source.get("tool") in FORECAST_TOOLS]
        require(bool(weather_sources), "Forecast output lacks a source reference to real ML forecasting")
        require(all(source.get("synthetic") is False for source in weather_sources), "Historical weather/model sources must be explicitly non-synthetic")
    return sorted(tools)


def validate_job(job: Any, expected_agent: str) -> dict[str, Any]:
    require(isinstance(job, dict), "Investigation response must be structured JSON")
    require(job.get("agent_id") == expected_agent, "Investigation identity differs from requested agent")
    require(job.get("status") in TERMINAL, "Investigation has not reached a terminal state")
    require(job.get("status") != "failed", f"Investigation failed: {job.get('error') or job.get('warnings')}")
    require(valid_timestamp(job.get("created_at")) and valid_timestamp(job.get("updated_at")), "Investigation timestamps must include a timezone")
    require(isinstance(job.get("summary"), str) and bool(job["summary"].strip()), "Investigation has no real agent synthesis")
    tasks = job.get("tasks", [])
    require(isinstance(tasks, list) and len(tasks) > 0, "Investigation contains no actual agent tasks")
    ids = [task.get("task_id") for task in tasks]
    require(len(set(ids)) == len(ids) and all(isinstance(item, str) and bool(item) for item in ids), "Task IDs must be distinct and nonempty")
    by_agent: dict[str, list[dict[str, Any]]] = {}
    for task in tasks:
        require(task.get("agent_id") in AGENTS and task.get("status") in TERMINAL, "Invalid or unfinished specialist task")
        by_agent.setdefault(task["agent_id"], []).append(task)
        if task.get("status") == "completed":
            runtime = task.get("runtime", {})
            require(isinstance(runtime, dict) and runtime.get("name") == "hermes-agent", "Completed task lacks native Hermes execution metadata")
            require(runtime.get("profile") == task["agent_id"] and runtime.get("soul_loaded") is True, "Completed task lacks isolated profile identity/SOUL")
            require(isinstance(runtime.get("revision"), str) and bool(runtime["revision"]) and isinstance(runtime.get("version"), str), "Completed task lacks pinned Hermes runtime provenance")
    explain = expected_agent == "hypothesis" and any(c.get("tool") == "opportunity_simulate" for t in tasks for c in t.get("tool_calls", []))
    agents_required = ({"forecast", "engineer"} if expected_agent == "orchestrator" else {"hypothesis"} if explain
                       else {"hypothesis", "engineer"} if expected_agent == "hypothesis" else {expected_agent})
    evidence = {}
    for agent in agents_required:
        completed = [task for task in by_agent.get(agent, []) if task.get("status") == "completed"]
        require(bool(completed), f"Required real {agent} specialist did not complete")
        relevant = completed[-1]
        require(isinstance(relevant.get("summary"), str) and bool(relevant["summary"].strip()), f"{agent} returned no findings")
        if agent == "forecast":
            evidence[agent] = validate_evidence(relevant, FORECAST_TOOLS, "weather")
        elif agent == "engineer":
            evidence[agent] = validate_evidence(relevant, NETWORK_KPI_TOOLS, "netops")
        elif agent == "hypothesis":
            evidence[agent] = validate_evidence(relevant, SIMULATE_TOOLS if explain else OPPORTUNITY_TOOLS, "opportunity")
        elif agent == "business":
            evidence[agent] = validate_evidence(relevant, BUSINESS_TOOLS, "netops")
    points = validate_geojson(job.get("geojson"))
    simulation = None
    if explain:
        simulation = job.get("simulation")
        require(isinstance(simulation, dict) and simulation.get("recommendation", {}).get("computed") is True and len(simulation.get("strategies", [])) == 3,
                "Explanation lacks the computed simulation")
        simulation = {"recommendation": simulation["recommendation"]["name"], "inputs": simulation["inputs"]}
    feasibility = None
    if expected_agent == "hypothesis" and not explain:
        feasibility = job.get("feasibility")
        require(isinstance(feasibility, list) and feasibility and all(v.get("label") in {"supported", "supported with risk", "blocked until repaired", "not validated"} for v in feasibility),
                "Discovery lacks computed feasibility verdicts")
        feasibility = {v["opportunity_id"]: v["label"] for v in feasibility}
    contradicted = [warning for warning in job.get("warnings", []) if warning.startswith("Report contradicts")]
    ungrounded = [warning for task in tasks for warning in task.get("warnings", []) if warning.startswith("Report names tools this task did not execute")]
    return {"investigation_id": job["investigation_id"], "agent_id": expected_agent, "status": job["status"], "task_agents": sorted(by_agent), "successful_tools": evidence, "map_points": points,
            "ungrounded_tool_claims": ungrounded, "feasibility": feasibility, "simulation": simulation, "contradictions": contradicted,
            "hermes_profiles": {task["agent_id"]: task.get("runtime") for task in tasks if task.get("status") == "completed"}}


def run_investigation(api: str, frontend: str | None, agent: str, prompt: str, timeout: float) -> tuple[dict[str, Any], dict[str, Any]]:
    # When a frontend is supplied, every submission and poll traverses the real Next.js adapter.
    endpoint = f"{frontend}/api/hermes" if frontend else f"{api}/api/investigations"
    submitted = request_json(endpoint, {"agent_id": agent, "prompt": prompt})
    identifier = submitted.get("investigation_id")
    require(isinstance(identifier, str) and bool(identifier), "Real submission did not return an investigation ID")
    deadline = time.monotonic() + timeout
    previous = None
    while time.monotonic() < deadline:
        url = f"{frontend}/api/hermes?{urlencode({'action': 'investigation', 'id': identifier})}" if frontend else f"{api}/api/investigations/{identifier}"
        job = request_json(url)
        require(job.get("investigation_id") == identifier, "Poll returned a different investigation")
        state = (job.get("status"), tuple((task.get("agent_id"), task.get("status"), len(task.get("tool_calls", []))) for task in job.get("tasks", [])))
        if state != previous:
            print(json.dumps({"investigation": identifier, "status": state[0], "activity": state[1]}), flush=True)
            previous = state
        if job.get("status") in TERMINAL:
            return job, validate_job(job, agent)
        time.sleep(2)
    raise QualificationError(f"Investigation {identifier} did not complete within {timeout:g}s; no successful result is implied")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8011", help="Operator-configured Hermes API origin")
    parser.add_argument("--frontend-url", help="Optional running Next.js origin; submissions/polls use its actual proxy")
    parser.add_argument("--runs", type=int, default=3, help="Consecutive real orchestrated investigations")
    parser.add_argument("--timeout", type=float, default=360, help="Maximum seconds per actual investigation")
    parser.add_argument("--agents-smoke", default="", help="Optional comma-separated forecast,business,engineer direct-profile smoke checks")
    parser.add_argument("--prompt", default=DEMO_PROMPT, help="Orchestrator investigation request for the consecutive runs")
    parser.add_argument("--discover", type=int, default=0, help="Consecutive real opportunity discoveries (Business Hypothesis + Engineer)")
    parser.add_argument("--explain", type=int, default=0, help="Consecutive real Decision Time Machine explanations (Business Hypothesis)")
    parser.add_argument("--report", type=Path, help="Write actual full evidence and qualification summary as JSON")
    args = parser.parse_args()
    report: dict[str, Any] = {"qualification": "NOT VERIFIED", "actual_execution": True, "investigations": []}
    started = time.monotonic()
    try:
        api = origin(args.url)
        frontend = origin(args.frontend_url) if args.frontend_url else None
        require(0 <= args.runs <= 10 and 1 <= args.timeout <= 1_800, "Choose 1–10 runs and a bounded positive timeout")
        smoke = [name.strip() for name in args.agents_smoke.split(",") if name.strip()]
        require(set(smoke) <= set(SMOKE_PROMPTS), "Direct smokes support forecast,business,engineer")
        report["health"] = request_json(f"{api}/healthz")
        report["readiness"] = request_json(f"{api}/readyz")
        report["agents"] = validate_agents(request_json(f"{api}/api/agents"))
        if frontend:
            report["frontend_agents"] = validate_agents(request_json(f"{frontend}/api/hermes?action=agents"))
            weather = request_json(f"{frontend}/api/weather?action=status")
            require(weather.get("ready") is True and weather.get("mode") == "replay", "Existing Weather frontend panel must remain ready in historical replay mode")
            forecast = request_json(f"{frontend}/api/weather?action=forecast&region=kuala-lumpur&horizon_hours=6")
            require(forecast.get("mode") == "replay" and forecast.get("research_only") is True, "Weather proxy lost historical replay/research qualification")
            require(forecast.get("model", {}).get("id") == "autogluon/chronos-2-small", "Expected the existing real local Chronos model")
            report["frontend_weather"] = {"status": "PASS", "model": forecast["model"], "map_points": validate_geojson(forecast.get("geojson"))}
        print(json.dumps({"boundary": "profiles and optional frontend/weather", "status": "PASS"}), flush=True)
        for index in range(args.runs):
            before = time.monotonic()
            job, summary = run_investigation(api, frontend, "orchestrator", args.prompt, args.timeout)
            summary["duration_seconds"] = round(time.monotonic() - before, 3)
            summary["run"] = index + 1
            report["investigations"].append({"summary": summary, "actual_job": job})
            print(json.dumps({"run": index + 1, "qualification": "PASS", **summary}), flush=True)
        for index in range(args.discover):
            before = time.monotonic()
            job, summary = run_investigation(api, frontend, "hypothesis", DISCOVER_PROMPT, args.timeout)
            summary["duration_seconds"] = round(time.monotonic() - before, 3)
            report["investigations"].append({"summary": summary, "actual_job": job})
            print(json.dumps({"discovery": index + 1, "qualification": "PASS", **summary}), flush=True)
        for index in range(args.explain):
            before = time.monotonic()
            job, summary = run_investigation(api, frontend, "hypothesis", EXPLAIN_PROMPT, args.timeout)
            summary["duration_seconds"] = round(time.monotonic() - before, 3)
            report["investigations"].append({"summary": summary, "actual_job": job})
            print(json.dumps({"explanation": index + 1, "qualification": "PASS", **summary}), flush=True)
        for agent in smoke:
            job, summary = run_investigation(api, frontend, agent, SMOKE_PROMPTS[agent], args.timeout)
            report["investigations"].append({"summary": summary, "actual_job": job})
            print(json.dumps({"direct_agent": agent, "qualification": "PASS", **summary}), flush=True)
        report["qualification"] = "PASS"
        report["consecutive_orchestrator_runs"] = args.runs
    except (QualificationError, KeyError, TypeError, ValueError) as exc:
        report["qualification"] = "FAIL"
        report["error"] = str(exc)
        print(json.dumps({"qualification": "FAIL", "error": str(exc)}), file=sys.stderr, flush=True)
    finally:
        report["total_seconds"] = round(time.monotonic() - started, 3)
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    return 0 if report["qualification"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
