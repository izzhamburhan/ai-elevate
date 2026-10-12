from __future__ import annotations

import asyncio
from typing import Any

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError
from netintel_mcp.server import build_server

TOOLS = {
    "investigate_customer_complaint",
    "analyze_network_congestion",
    "correlate_network_incidents",
    "assess_weather_network_exposure",
    "recommend_network_maintenance",
}


async def _list() -> list[Any]:
    async with Client(build_server()) as client:
        return await client.list_tools()


def test_server_registers_five_read_only_tools() -> None:
    listed = asyncio.run(_list())
    assert {t.name for t in listed} == TOOLS
    for tool in listed:
        assert tool.annotations.read_only_hint is True and tool.annotations.destructive_hint is False


def test_a_tool_returns_the_envelope() -> None:
    async def call() -> Any:
        async with Client(build_server()) as client:
            return await client.call_tool("analyze_network_congestion", {"cluster": "Shah Alam", "days": 7})

    result = asyncio.run(call())
    payload = result.structured_content
    assert payload["synthetic"] is True and payload["data"]["geojson"]["type"] == "FeatureCollection"


def test_bad_input_is_a_tool_error() -> None:
    async def call() -> Any:
        async with Client(build_server()) as client:
            return await client.call_tool("analyze_network_congestion", {"cluster": "Atlantis"})

    with pytest.raises(ToolError, match="Unknown cluster"):
        asyncio.run(call())


def test_search_mode_collapses_the_listing() -> None:
    async def names() -> set[str]:
        async with Client(build_server(search=True)) as client:
            return {t.name for t in await client.list_tools()}

    assert asyncio.run(names()) == {"netintel_search_tools", "netintel_call_tool"}