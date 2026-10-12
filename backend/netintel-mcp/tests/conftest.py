"""A small fake netops.duckdb with just the tables and shapes the generator reads, and the intel.duckdb built from it."""

from __future__ import annotations

from pathlib import Path

import pytest
from netintel_mcp import seed
from netintel_mcp.testing import build_fake_netops


@pytest.fixture(scope="session")
def netops_db(tmp_path_factory: pytest.TempPathFactory) -> Path:
    path = tmp_path_factory.mktemp("netops") / "netops.duckdb"
    build_fake_netops(path)
    return path


@pytest.fixture(scope="session")
def intel_db(netops_db: Path, tmp_path_factory: pytest.TempPathFactory) -> Path:
    out = tmp_path_factory.mktemp("intel") / "intel.duckdb"
    seed.build(netops_db, out)
    return out


@pytest.fixture(autouse=True)
def _use_intel(intel_db: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NETINTEL_DB", str(intel_db))
    # never reach a real Weather ML from tests
    monkeypatch.setenv("WEATHER_ML_HTTP_URL", "http://127.0.0.1:9")