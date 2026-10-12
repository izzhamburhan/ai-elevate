"""Order 5 live demo: Analyze Network -> Predict Future Risk -> Identify Demand -> Recommend Areas for Investigation.

Calls the running NetIntel (:8125) and MLPredict (:8126) MCP servers over streamable HTTP. Every number printed comes from
those calls (model inference on synthetic data); nothing is prewritten. Works with and without the servers' --search mode.

    uv run python -m mlpredict_mcp.demo [--day 2026-10-17] [--out demo_transcript.json]

This module imports no ML library, so it runs on the host even when LightGBM only runs in the container.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import time
from pathlib import Path
from typing import Any

from fastmcp import Client

SCENARIO = {
    "cluster": "Shah Alam",
    "event_id": "EVT-SA-FESTIVAL",
    "story": "A 38,000-person festival at Stadium Shah Alam on Saturday evening (synthetic scenario SCN-UPCOMING-EVENT).",
}


class Server:
    """One MCP server; calls a tool directly or through <prefix>_call_tool when the server runs with --search."""

    def __init__(self, name: str, target: Any) -> None:
        self.name = name
        self.client = Client(target)  # an MCP URL, or a FastMCP server object (tests)
        self.direct: set[str] = set()

    async def __aenter__(self) -> Server:
        await self.client.__aenter__()
        self.direct = {t.name for t in await self.client.list_tools()}
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.client.__aexit__(*exc)

    async def call(self, tool: str, **args: Any) -> dict[str, Any]:
        if tool in self.direct:
            result = await self.client.call_tool(tool, args)
        else:
            result = await self.client.call_tool(f"{self.name}_call_tool", {"name": tool, "arguments": args})
        body: Any = result.structured_content or json.loads(result.content[0].text)
        if "data" not in body and "result" in body:  # the search wrapper nests the tool's own result
            body = body["result"]
        return json.loads(body) if isinstance(body, str) else body


def _line(text: str = "") -> None:
    print(text, flush=True)


async def run(netintel: Any, mlpredict: Any, day: str, out: Path | None = None) -> dict[str, Any]:
    log: list[dict[str, Any]] = []

    async def call(server: Server, tool: str, **args: Any) -> dict[str, Any]:
        t = time.perf_counter()
        body = await server.call(tool, **args)
        ms = round(1000 * (time.perf_counter() - t))
        log.append({"server": server.name, "tool": tool, "arguments": args, "ms": ms, "result": body})
        _line(f"  [{server.name}.{tool} {ms} ms, synthetic={body.get('synthetic')}]")
        return body["data"]

    async with Server("netintel", netintel) as ni, Server("mlpredict", mlpredict) as ml:
        status = await call(ml, "get_ml_model_status")
        _line(f"Models: {status['summary']}")
        _line(f"Scenario: {SCENARIO['story']} ALL DATA IS SYNTHETIC.")

        _line("\n1. ANALYZE NETWORK (recorded data)")
        congestion = await call(ni, "analyze_network_congestion", cluster=SCENARIO["cluster"], days=7)
        _line(f"  {congestion['summary']}")
        anomalies = await call(ml, "detect_network_anomalies", cluster=SCENARIO["cluster"])
        _line(f"  {anomalies['summary']}")
        for p in anomalies["predictions"][:2]:
            _line(f"   - {p['subject']['id']}: {'; '.join(p['evidence'][1:3])}")

        _line("\n2. PREDICT FUTURE RISK")
        forecast = await call(ml, "forecast_network_congestion", event_id=SCENARIO["event_id"])
        _line(f"  {forecast['summary']}")
        for p in forecast["predictions"][:2]:
            _line(f"   - {p['subject']['id']}: peak {p['value']}% PRB ({p['level']}); {p['evidence'][0]}; {p['evidence'][1]}")
        failure = await call(ml, "predict_site_failure_risk", cluster=SCENARIO["cluster"], limit=3)
        _line(f"  {failure['summary']}")
        for s in failure["sites"][:2]:
            _line(f"   - {s['site_id']} {s['risk_level']} (score {s['risk_score']:.2%}): {s['recommended_checks'][0]}")

        _line("\n3. IDENTIFY DEMAND")
        footfall = await call(ml, "predict_area_footfall", day=day, hour_from=16, hour_to=22, cluster=SCENARIO["cluster"])
        _line(f"  {footfall['summary']}")
        demand = await call(ml, "get_business_demand_signals", day=day, hour_from=16, hour_to=22, limit=5)
        _line(f"  {demand['summary']}")

        _line("\n4. RECOMMEND AREAS FOR INVESTIGATION")
        for i, s in enumerate(demand["signals"][:3], 1):
            flags = f" (+ {', '.join(s['secondary_flags'])})" if s["secondary_flags"] else ""
            _line(f"  #{i} {s['name']}, {s['cluster']}: {s['signal']}{flags}, priority {s['investigation_priority']:.2f}, "
                  f"confidence {s['confidence']}")
            _line(f"     -> {s['recommended_investigation']}")
            for e in s["evidence"]:
                _line(f"        * {e}")
        booths = await call(ml, "rank_business_locations", day=day, cluster=SCENARIO["cluster"], top_k=1)
        b = booths["recommendations"][0]
        _line(f"  Pop-up booth check, {b['name']}: ~{b['expected_signups']:.0f} sign-ups (band {b['signups_band'][0]}-{b['signups_band'][1]}), "
              f"RM {b['estimated_cost_rm']}; risks: {' '.join(b['risks'][:2])}")
        _line("\nEvery figure above came from MCP tool calls to local models on synthetic data; it is not real-world performance.")

    transcript = {"scenario": SCENARIO, "day": day, "synthetic": True, "calls": log}
    if out:
        out.write_text(json.dumps(transcript, indent=1, default=str))
        _line(f"Transcript with every raw tool result: {out}")
    return transcript


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="mlpredict-demo", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--netintel", default="http://127.0.0.1:8125/mcp")
    parser.add_argument("--mlpredict", default="http://127.0.0.1:8126/mcp")
    parser.add_argument("--day", default="2026-10-17", help="the festival Saturday (Malaysia time)")
    parser.add_argument("--out", type=Path, default=None, help="write the raw tool results as JSON")
    args = parser.parse_args(argv)
    asyncio.run(run(args.netintel, args.mlpredict, args.day, args.out))


if __name__ == "__main__":
    main()
