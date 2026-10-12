from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from user_mcp.server import build_server


def test_server_registers_its_tools(db_file: Path) -> None:
    tools = asyncio.run(build_server(db_file).list_tools())
    assert {t.name for t in tools} == {
        "user_get_serving_cell",
        "user_get_experience",
        "user_list_in_area",
        "user_list_on_tower",
        "user_get_trail",
    }


def test_new_tools_answer_through_the_server(db_file: Path) -> None:
    server = build_server(db_file)
    listed = asyncio.run(server.call_tool("user_list_on_tower", {"enodeb_name": "KKRI-0143"}))
    payload: Any = listed.structured_content
    assert payload["synthetic"] is True and payload["data"]["subscribers_total"] == 40
    digest = payload["data"]["subscribers"][0]["msisdn_hash"]
    trail = asyncio.run(server.call_tool("user_get_trail", {"msisdn_hash": digest}))
    body: Any = trail.structured_content
    assert body["data"]["segments"] and body["data"]["location_precision"] == "cell"