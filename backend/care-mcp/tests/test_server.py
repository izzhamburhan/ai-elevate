from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from care_mcp.server import build_server


def test_server_registers_its_four_tools(db_file: Path) -> None:
    tools = asyncio.run(build_server(db_file).list_tools())
    assert {t.name for t in tools} == {"care_get_impact", "care_draft_notice", "care_send_notice", "care_list_notices"}


def test_a_tool_returns_an_envelope(db_file: Path) -> None:
    result: Any = asyncio.run(build_server(db_file).call_tool("care_get_impact", {"enodeb_names": ["KKRI-0142"]}))
    payload = result.structured_content
    assert payload["synthetic"] is True and payload["evidence"] and payload["data"]["affected_customers"] == 980


def test_search_mode_lists_a_few_tools_directly_and_still_proxies_calls(db_file: Path) -> None:
    server = build_server(db_file, search=True)
    tools = asyncio.run(server.list_tools())
    assert {t.name for t in tools} == {"care_get_impact", "care_draft_notice", "care_send_notice", "care_list_notices"}
    found: Any = asyncio.run(server.call_tool("care_search_tools", {"query": "draft a customer notice"})).structured_content
    assert found["result"][0]["name"] == "care_draft_notice"
    result: Any = asyncio.run(
        server.call_tool("care_call_tool", {"name": "care_get_impact", "arguments": {"enodeb_names": ["KKRI-0142"]}})
    )
    assert result.structured_content["data"]["affected_customers"] == 980
