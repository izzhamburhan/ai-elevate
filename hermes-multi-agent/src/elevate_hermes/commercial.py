"""Order 7 commercial applications: Hermes may explain the computed result but never introduce its own money figures."""

from __future__ import annotations

import re
from typing import Any

TOOLS = ("opportunity_revenue_leaks", "opportunity_absence_gaps", "opportunity_event_packages")
_MONEY = re.compile(r"RM\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(k|K|million|m)\b)?")


def from_tasks(tasks: list[dict[str, Any]], task_id: str) -> dict[str, Any] | None:
    """The task's latest successful commercial tool result (authoritative)."""
    task = next((t for t in tasks if t["task_id"] == task_id), None)
    calls = [c for c in (task or {}).get("tool_calls", []) if c.get("ok") and c.get("tool") in TOOLS]
    if not calls:
        return None
    data = calls[-1]["data"].get("data", calls[-1]["data"])
    return {"tool": calls[-1]["tool"], "application": data.get("application"), "headline": data.get("headline"), "data": data}


def _numbers(value: Any) -> list[float]:
    if isinstance(value, bool):
        return []
    if isinstance(value, (int, float)):
        return [float(value)]
    if isinstance(value, dict):
        return [n for v in value.values() for n in _numbers(v)]
    if isinstance(value, list):
        return [n for v in value for n in _numbers(v)]
    if isinstance(value, str):
        return [float(m.replace(",", "")) for m in re.findall(r"\d[\d,]*(?:\.\d+)?", value)]
    return []


def unverified_figures(report: str, data: dict[str, Any]) -> list[str]:
    """RM amounts in the report that match no number in the computed result (exactly or as a rounding of one)."""
    known = _numbers(data)
    issues = []
    for match in _MONEY.finditer(report or ""):
        amount = float(match.group(1).replace(",", "")) * {"k": 1e3, "K": 1e3, "m": 1e6, "million": 1e6}.get(match.group(2) or "", 1)
        if not any(abs(n - amount) <= max(1.0, 0.005 * abs(n)) or round(n, -2) == amount or round(n, -3) == amount for n in known):
            issues.append(match.group(0).strip().rstrip(".,"))
    return sorted(set(issues))
