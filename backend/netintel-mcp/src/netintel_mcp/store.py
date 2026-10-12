"""Read-only access to intel.duckdb, time helpers and the shared output contract (envelope, GeoJSON, severity)."""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import duckdb
from menara_core.envelope import Envelope, Evidence

from netintel_mcp.seed import MYT, bearing_deg, haversine_km, offset

SOURCE = "netintel-mcp"
SEVERITIES = ("LOW", "MEDIUM", "HIGH", "CRITICAL")


def db_path() -> Path:
    return Path(os.environ.get("NETINTEL_DB", Path(__file__).resolve().parents[3] / "data" / "intel.duckdb"))


class NotSeededError(RuntimeError):
    pass


@contextmanager
def connect(path: Path | None = None) -> Iterator[duckdb.DuckDBPyConnection]:
    target = path or db_path()
    if not target.exists():
        raise NotSeededError(f"intel.duckdb not found at {target}. Build it with: uv run python -m netintel_mcp.seed")
    con = duckdb.connect(str(target), read_only=True)
    try:
        yield con
    finally:
        con.close()


def meta(con: duckdb.DuckDBPyConnection) -> dict[str, str]:
    return dict(con.execute("SELECT key, value FROM meta").fetchall())


def data_end_utc(con: duckdb.DuckDBPyConnection) -> datetime:
    return con.execute("SELECT max(ts_utc) FROM kpi_hourly").fetchone()[0] + timedelta(hours=1)


# ---------------------------------------------------------------- time

def iso_utc(ts: datetime | None) -> str | None:
    return None if ts is None else ts.replace(tzinfo=UTC).isoformat().replace("+00:00", "Z")


def iso_myt(ts: datetime | None) -> str | None:
    return None if ts is None else (ts + MYT).isoformat() + "+08:00"


def times(ts: datetime | None) -> dict[str, str | None]:
    return {"utc": iso_utc(ts), "myt": iso_myt(ts)}


def parse_local(value: str) -> datetime:
    """An ISO time with an offset, or a naive Malaysia local time, as naive UTC."""
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed - MYT
    return parsed.astimezone(UTC).replace(tzinfo=None)


# ---------------------------------------------------------------- output contract

def severity_for(score: float) -> str:
    """0..1 score to the shared four-level scale."""
    if score >= 0.85:
        return "CRITICAL"
    if score >= 0.6:
        return "HIGH"
    if score >= 0.35:
        return "MEDIUM"
    return "LOW"


def point(lat: float, lng: float, **props: Any) -> dict[str, Any]:
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lng, 6), round(lat, 6)]}, "properties": _props(props)}


def sector(lat: float, lng: float, azimuth: float, km: float = 0.4, **props: Any) -> dict[str, Any]:
    """A cell's main direction as a short line from its site."""
    end = offset(lat, lng, azimuth, km)
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": [[round(lng, 6), round(lat, 6)], [end[1], end[0]]]},
        "properties": _props(props),
    }


def _props(props: dict[str, Any]) -> dict[str, Any]:
    base = {"id": None, "kind": None, "severity": None, "score": None, "label": None, "unit": None}
    return {**base, **props}


def collection(features: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "FeatureCollection", "features": features}


class Evidence_:
    """Collects one evidence entry per data source an answer used."""

    def __init__(self, stamp: str) -> None:
        self.stamp = stamp
        self.items: list[Evidence] = []

    def add(self, tool: str, ref: str | None = None, confidence: float = 1.0, source: str = SOURCE) -> None:
        self.items.append(Evidence(source=source, tool=tool, call_id=uuid.uuid4().hex[:12], ref=ref, confidence=confidence, as_of=self.stamp))


def envelope(con: duckdb.DuckDBPyConnection, tool: str, data: dict[str, Any], evidence: Evidence_, warnings: list[str]) -> dict[str, Any]:
    info = meta(con)
    data["provenance"] = {
        "dataset": "intel.duckdb (hourly synthetic extension of NetOps)",
        "generator_version": info.get("generator_version"),
        "seed": info.get("seed"),
        "netops_ref_date": info.get("netops_ref_date"),
        "window_days_local": info.get("window_days_local"),
        "synthetic": True,
        "method": "rule-based analysis over stored data; no model and no LLM produced these numbers",
    }
    end = data_end_utc(con)
    data["data_freshness"] = {"data_end": times(end), "live": False,
                              "note": "Historical synthetic window. Treat 'now' as the end of the window, not the wall clock."}
    evidence.add(tool)
    return Envelope[dict[str, Any]](synthetic=True, as_of=iso_utc(end) or "", data=data, evidence=evidence.items,
                                    warnings=warnings).model_dump(mode="json")


__all__ = [
    "MYT", "SEVERITIES", "SOURCE", "Evidence_", "NotSeededError", "bearing_deg", "collection", "connect", "data_end_utc",
    "envelope", "haversine_km", "iso_myt", "iso_utc", "meta", "parse_local", "point", "sector", "severity_for", "times",
]