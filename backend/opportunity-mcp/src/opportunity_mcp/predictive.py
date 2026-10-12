"""Optional Order 5 enrichment: business demand signals from mlpredict-mcp, when that service is running.

Order 7 never depends on it. When the service is unreachable, slow or errors, the caller gets an explicit
"unavailable" status and keeps using graph-derived evidence. Results are attached as supplementary context only and
never change a classification, rank or RM figure.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

from fastmcp import Client

URL = os.environ.get("MLPREDICT_MCP_URL", "http://127.0.0.1:8126/mcp")
TIMEOUT_S = float(os.environ.get("MLPREDICT_TIMEOUT_S", "4"))
FIELDS = ("demand_index", "capacity_pressure", "reliability_risk", "signal", "investigation_priority")


def _areas(payload: Any) -> list[dict[str, Any]]:
    data = payload.get("data", payload) if isinstance(payload, dict) else {}
    rows = data.get("areas") if isinstance(data, dict) else None
    return [r for r in rows if isinstance(r, dict) and r.get("area_id")] if isinstance(rows, list) else []


async def demand_signals(area_ids: list[str], client_factory: Any = Client) -> dict[str, Any]:
    """{area_id: {...signals}, "_status": {...}} - never raises."""
    try:
        async with asyncio.timeout(TIMEOUT_S):
            async with client_factory(URL, timeout=TIMEOUT_S) as client:
                names = {t.name for t in await client.list_tools()}
                args = {"area_ids": area_ids, "limit": max(1, len(area_ids))}
                if "get_business_demand_signals" in names:
                    result = await client.call_tool("get_business_demand_signals", args)
                else:  # servers started with --search expose a call proxy instead
                    proxy = next((n for n in names if n.endswith("_call_tool")), None)
                    if proxy is None:
                        raise LookupError("get_business_demand_signals not offered")
                    result = await client.call_tool(proxy, {"name": "get_business_demand_signals", "arguments": args})
        payload = getattr(result, "structured_content", None) or getattr(result, "data", None) or {}
        rows = {r["area_id"]: {k: r[k] for k in FIELDS if k in r} for r in _areas(payload)}
        return {**rows, "_status": {"available": True, "source": "mlpredict-mcp get_business_demand_signals (Order 5, synthetic)",
                                    "note": "Supplementary context only; it does not change classifications or figures."}}
    except Exception as exc:  # unreachable, timeout, refusal: degrade transparently
        return {"_status": {"available": False, "note": f"Order 5 predictive service unavailable ({type(exc).__name__}); graph-derived evidence used."}}
