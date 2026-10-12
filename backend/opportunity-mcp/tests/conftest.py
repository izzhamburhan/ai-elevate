"""Fake NetOps -> intel.duckdb -> ml.duckdb -> SME seed, once per test session (no trained models needed)."""

from __future__ import annotations

from pathlib import Path

import pytest
from mlpredict_mcp import data
from netintel_mcp import seed
from netintel_mcp.testing import build_fake_netops
from opportunity_mcp import sme_seed


@pytest.fixture(scope="session")
def built(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    root = tmp_path_factory.mktemp("opportunity")
    netops, intel, ml, sme = root / "netops.duckdb", root / "intel.duckdb", root / "ml.duckdb", root / "sme_demand.csv"
    build_fake_netops(netops)
    seed.build(netops, intel)
    data.build(intel, ml)
    sme_seed.write(sme_seed.build_rows(intel), sme)
    return {"intel": intel, "ml": ml, "sme": sme}
