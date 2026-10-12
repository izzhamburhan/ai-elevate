"""Fake NetOps -> intel.duckdb -> ml.duckdb -> trained models, once per test session (small network, trains in seconds)."""

from __future__ import annotations

from pathlib import Path

import pytest
from mlpredict_mcp import data, train
from netintel_mcp import seed
from netintel_mcp.testing import build_fake_netops


@pytest.fixture(scope="session")
def built(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    root = tmp_path_factory.mktemp("ml")
    netops, intel, ml, models = root / "netops.duckdb", root / "intel.duckdb", root / "ml.duckdb", root / "models"
    build_fake_netops(netops)
    seed.build(netops, intel)
    data.build(intel, ml)
    train.train_all(intel, ml, models)
    return {"netops": netops, "intel": intel, "ml": ml, "models": models}


@pytest.fixture(autouse=True)
def _paths(built: dict[str, Path], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NETINTEL_DB", str(built["intel"]))
    monkeypatch.setenv("MLPREDICT_DB", str(built["ml"]))
    monkeypatch.setenv("MLPREDICT_MODELS", str(built["models"]))