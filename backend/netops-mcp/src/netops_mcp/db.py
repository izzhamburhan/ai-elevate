"""DuckDB access. One process-wide connection; every call takes its own cursor
under a lock so sync tools are safe whether FastMCP runs them on the event loop
or in a worker thread."""

import datetime as dt
import threading
from decimal import Decimal
from typing import Any

import duckdb

from netops_mcp import config
from netops_mcp.errors import UpstreamError

_lock = threading.RLock()
_con: duckdb.DuckDBPyConnection | None = None


def connection() -> duckdb.DuckDBPyConnection:
    global _con
    if _con is None:
        if not config.DB_PATH.exists():
            raise UpstreamError(
                f"Database not found at {config.DB_PATH}. Run `uv run netops-mcp-seed` first."
            )
        _con = duckdb.connect(str(config.DB_PATH))
    return _con


def _clean(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return None
    return value


def query(sql: str, params: list | tuple | dict | None = None) -> list[dict]:
    """Run a SELECT and return rows as dicts."""
    with _lock:
        cur = connection().cursor()
        try:
            cur.execute(sql, params or [])
            cols = [d[0] for d in cur.description]
            return [{c: _clean(v) for c, v in zip(cols, row)} for row in cur.fetchall()]
        finally:
            cur.close()


def query_one(sql: str, params: list | tuple | dict | None = None) -> dict | None:
    rows = query(sql, params)
    return rows[0] if rows else None


def scalar(sql: str, params: list | tuple | dict | None = None) -> Any:
    with _lock:
        cur = connection().cursor()
        try:
            row = cur.execute(sql, params or []).fetchone()
            return _clean(row[0]) if row else None
        finally:
            cur.close()


def execute(sql: str, params: list | tuple | dict | None = None) -> None:
    with _lock:
        cur = connection().cursor()
        try:
            cur.execute(sql, params or [])
        finally:
            cur.close()


def raw(sql: str, params: list | tuple | None = None) -> list[tuple]:
    """Return raw tuples (keeps BLOBs intact)."""
    with _lock:
        cur = connection().cursor()
        try:
            return cur.execute(sql, params or []).fetchall()
        finally:
            cur.close()


def next_id(table: str, column: str = "id") -> int:
    return int(scalar(f"SELECT COALESCE(MAX({column}), 0) + 1 FROM {table}"))


def ref_date() -> dt.date:
    """The 'today' the synthetic data was generated around. Tools treat it as
    the current date so defaults like 'last 30 days' always land on data."""
    value = scalar("SELECT value FROM _meta WHERE key = 'ref_date'")
    return dt.date.fromisoformat(value) if value else dt.date.today()


def paginate(
    sql: str,
    params: list | None,
    page: int,
    page_size: int,
    order_by: str | None = None,
) -> dict:
    """Wrap a SELECT with a total count and LIMIT/OFFSET."""
    page = max(1, int(page or 1))
    page_size = max(1, min(int(page_size or config.DEFAULT_PAGE_SIZE), config.MAX_PAGE_SIZE))
    params = list(params or [])
    total = int(scalar(f"SELECT COUNT(*) FROM ({sql}) _q", params))
    order = f" ORDER BY {order_by}" if order_by else ""
    items = query(
        f"SELECT * FROM ({sql}) _q{order} LIMIT ? OFFSET ?",
        params + [page_size, (page - 1) * page_size],
    )
    return page_envelope(items, total, page, page_size)


def paginate_list(items: list, page: int, page_size: int) -> dict:
    """Paginate an already-materialised Python list."""
    page = max(1, int(page or 1))
    page_size = max(1, min(int(page_size or config.DEFAULT_PAGE_SIZE), config.MAX_PAGE_SIZE))
    start = (page - 1) * page_size
    return page_envelope(items[start : start + page_size], len(items), page, page_size)


def page_envelope(items: list, total: int, page: int, page_size: int) -> dict:
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if total else 0,
        "items": items,
    }
