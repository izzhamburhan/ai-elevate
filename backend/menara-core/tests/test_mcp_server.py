from __future__ import annotations

import asyncio
from typing import Any

from fastmcp import FastMCP

from menara_core.mcp_server import LIST_DIRECTLY_UP_TO, add_tool_search


def _server(tool_count: int) -> FastMCP:
    mcp = FastMCP("demo", instructions="Demo tools. More text.")
    add_tool_search(mcp, "demo")
    for i in range(tool_count):

        def tool(x: int = 0, _i: int = i) -> dict[str, Any]:
            return {"tool": _i, "x": x}

        mcp.tool(tool, name=f"demo_tool_{i}", description=f"Demo tool number {i}.")
    return mcp


def _names(mcp: FastMCP) -> set[str]:
    return {t.name for t in asyncio.run(mcp.list_tools())}


def test_a_small_server_lists_its_tools_directly() -> None:
    assert _names(_server(LIST_DIRECTLY_UP_TO)) == {f"demo_tool_{i}" for i in range(LIST_DIRECTLY_UP_TO)}


def test_a_large_server_collapses_into_search() -> None:
    assert _names(_server(LIST_DIRECTLY_UP_TO + 1)) == {"demo_search_tools", "demo_call_tool"}


def test_the_call_tool_still_reaches_a_directly_listed_tool() -> None:
    mcp = _server(2)
    result: Any = asyncio.run(mcp.call_tool("demo_call_tool", {"name": "demo_tool_1", "arguments": {"x": 7}}))
    assert result.structured_content == {"tool": 1, "x": 7}
