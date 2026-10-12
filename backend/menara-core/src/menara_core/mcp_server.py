"""FastMCP plumbing shared by every Menara server: BM25 tool search and the run call."""

from __future__ import annotations

from fastmcp import FastMCP
from fastmcp.server.transforms.search import BM25SearchTransform
from fastmcp.tools import Tool


class DescribedBM25SearchTransform(BM25SearchTransform):
    """BM25 search whose two synthetic tools say what the server covers.

    FastMCP's stock descriptions ("Search for tools using natural language") give a model nothing to
    go on, so small models skip them and reach for a better-described tool from another server.
    """

    def __init__(self, *, topic: str, search_tool_name: str, call_tool_name: str) -> None:
        super().__init__(search_tool_name=search_tool_name, call_tool_name=call_tool_name)
        self._topic = topic

    def _make_search_tool(self) -> Tool:
        return super()._make_search_tool().model_copy(
            update={
                "description": f"Find tools for: {self._topic} Describe the task in plain words; returns the "
                f"matching tools' names and parameters. Use this before saying the data isn't available, "
                f"then run the chosen tool with {self._call_tool_name}."
            }
        )

    def _make_call_tool(self) -> Tool:
        return super()._make_call_tool().model_copy(
            update={
                "description": f"Run a tool found with {self._search_tool_name}, passing its name and arguments "
                "exactly as listed there."
            }
        )


def add_tool_search(mcp: FastMCP, prefix: str) -> None:
    """Collapse the tool listing into <prefix>_search_tools + <prefix>_call_tool (BM25 ranking).

    The prefix keeps the two synthetic tools unique when a client merges several servers' tools by name.
    The server's first instruction sentence becomes the search tool's topic.
    """
    topic = (mcp.instructions or prefix).split(". ")[0].rstrip(".") + "."
    mcp.add_transform(
        DescribedBM25SearchTransform(
            topic=topic, search_tool_name=f"{prefix}_search_tools", call_tool_name=f"{prefix}_call_tool"
        )
    )


def serve(mcp: FastMCP, transport: str, host: str, port: int) -> None:
    if transport == "stdio":
        mcp.run(transport="stdio")
    else:
        mcp.run(transport="streamable-http", host=host, port=port)
