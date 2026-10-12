"""Order 6 Decision Time Machine: the computed simulation a Business Hypothesis report must not contradict."""

from __future__ import annotations

from typing import Any

STRATEGY_NAMES = {"campaign": "Targeted sales campaign", "network_first": "Fix network, then sell", "phased_pilot": "Phased pilot"}


def from_tasks(tasks: list[dict[str, Any]], task_id: str) -> dict[str, Any] | None:
    """The task's latest successful opportunity_simulate result, reduced to the authoritative numbers."""
    task = next((t for t in tasks if t["task_id"] == task_id), None)
    calls = [c for c in (task or {}).get("tool_calls", []) if c.get("ok") and c.get("tool") == "opportunity_simulate"]
    if not calls:
        return None
    data = calls[-1]["data"].get("data", calls[-1]["data"])
    return {
        "inputs": data["inputs"], "recommendation": data["recommendation"],
        "strategies": [{k: s[k] for k in ("strategy_id", "name", "expected_spend_rm", "net_contribution_24m_rm",
                                          "probability_of_loss_24m", "payback_month_p50")} for s in data["strategies"]],
    }


def contradictions(report: str, simulation: dict[str, Any]) -> list[str]:
    """Recommendation lines that name a different strategy than the computed one."""
    computed = simulation["recommendation"]["name"].lower()
    issues = []
    for line in (report or "").splitlines():
        lowered = line.lower()
        if "recommend" not in lowered:
            continue
        named = [name for name in STRATEGY_NAMES.values() if name.lower() in lowered]
        if named and computed not in lowered:
            issues.append(f"report recommends '{named[0]}', computed '{simulation['recommendation']['name']}'")
    return issues
