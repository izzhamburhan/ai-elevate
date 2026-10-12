import re
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

AgentId = Literal["orchestrator", "forecast", "business", "engineer"]
Identifier = str


class InvestigationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    agent_id: AgentId
    prompt: str = Field(min_length=1, max_length=4000)
    session_id: str | None = Field(default=None, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$")


class DelegationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    investigation_id: str
    parent_task_id: str
    agent_id: Literal["forecast", "business", "engineer"]
    task: str = Field(min_length=1, max_length=4000)


def source_summary(service: str, tool: str, reference: str, provenance: dict | None = None) -> dict:
    provenance = provenance or {}
    synthetic = bool(provenance.get("synthetic", service == "netops"))
    kind = provenance.get("data_kind", "local_ml_weather" if service == "weather" else "synthetic_telecom")
    return {
        "source_id": reference, "kind": kind,
        "label": "Actual local Chronos historical replay / ERA5" if service == "weather" else "Existing synthetic NetOps telecom records" if synthetic else "Existing real geographic data / source attribution retained",
        "tool": tool, "reference": reference, "synthetic": synthetic,
    }


def compact_tool_result(result: dict, limit: int = 14000) -> dict:
    """Bound LLM context while retaining the full original result in the investigation audit."""
    import json
    import copy
    bounded = copy.deepcopy(result)
    data = bounded.get("data")
    if isinstance(data, dict) and isinstance(data.get("geojson"), dict):
        features = data["geojson"].get("features", [])
        weather = [f for f in features if f.get("properties", {}).get("kind") == "weather_location"]
        sites = [f for f in features if f.get("properties", {}).get("kind") != "weather_location"]
        data["geojson"]["features"] = weather + sites[:3]
        data["full_feature_count"] = len(features)
        data["agent_context_note"] = "GeoJSON sample only; full MCP geography is retained for the map."
        data["interpretation"] = "Rainfall values are Chronos predictions for historical forecast valid times, not observed weather at those times. weather_distance_km is distance from a telecom site to its cached weather location, NOT distance from the user's town. Sampled regional sites must retain their actual names and may lie outside the requested town."
    if len(json.dumps(bounded)) > limit:
        return {"ok": result.get("ok", False), "source": result.get("source"),
                "warnings": result.get("warnings", []) + ["Large tool result abbreviated for agent context; full evidence remains in the audit."],
                "data_excerpt": json.dumps(bounded.get("data"), ensure_ascii=False)[:limit], "error": result.get("error")}
    return bounded


def final_report(text: str) -> tuple[str, bool]:
    """Drop process narration a local model writes before its first report heading.

    Only text before the first Markdown heading is removed; the report itself is unchanged.
    """
    lines = text.strip().splitlines()
    first = next((index for index, line in enumerate(lines) if line.lstrip().startswith("#")), None)
    if not first:
        return text.strip(), False
    return "\n".join(lines[first:]).strip(), True


def unexecuted_tool_claims(summary: str, approved: set[str], executed: set[str]) -> list[str]:
    """Approved tool names a report mentions although this task never executed them."""
    return sorted(name for name in approved - executed if re.search(rf"\b{re.escape(name)}\b", summary or ""))


def delegation_evidence(calls: list[dict]) -> list[dict]:
    """Exchange bounded factual receipts along with specialist prose, never private memory."""
    evidence = []
    for call in calls:
        if not call.get("ok"):
            continue
        bounded = compact_tool_result(call, limit=7000)
        evidence.append({key: bounded.get(key) for key in ("tool", "data", "data_excerpt", "source", "warnings") if key in bounded})
    return evidence

