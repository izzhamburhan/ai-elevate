"""Runtime settings, read from environment variables."""

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]

DB_PATH = Path(os.environ.get("NETOPS_DB_PATH", PROJECT_ROOT / "data" / "netops.duckdb"))
# Real Malaysian places from Overture Maps, written by `uv run python -m netops_mcp.seed.places`
PLACES_PATH = Path(os.environ.get("NETOPS_PLACES_PATH", PROJECT_ROOT / "data" / "places_my.parquet"))
# Real Malaysian state/district/mukim boundaries from geoBoundaries, written by `uv run python -m netops_mcp.seed.boundaries`
BOUNDARIES_PATH = Path(os.environ.get("NETOPS_BOUNDARIES_PATH", PROJECT_ROOT / "data" / "boundaries_my.parquet"))

# Pagination
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 1000

# HTTP transport (stdio is the default transport)
HTTP_HOST = os.environ.get("NETOPS_MCP_HOST", "127.0.0.1")
HTTP_PORT = int(os.environ.get("NETOPS_MCP_PORT", "8000"))  # matches frontend MCP_SERVER_URLS example
# Base URL map clients use to fetch /geojson/<tool> links (set from host/port when serving HTTP; None on stdio)
PUBLIC_URL = os.environ.get("NETOPS_PUBLIC_URL")

# Seed
SEED = int(os.environ.get("NETOPS_SEED", "42"))
