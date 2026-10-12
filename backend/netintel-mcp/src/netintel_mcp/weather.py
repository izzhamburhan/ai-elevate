"""Client for the local Weather ML service (weather-ml-mcp, Chronos-2 Small).

Only its read-only HTTP endpoint is used: POST /api/predict-sites with NetOps site IDs. When the service is not
running, callers get `available: False` and no weather values; nothing is estimated in its place.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

MAX_SITES = 25  # the service's limit per request
HORIZONS = (6, 12, 24)


def base_url() -> str:
    return os.environ.get("WEATHER_ML_HTTP_URL", "http://127.0.0.1:8002").rstrip("/")


def predict_sites(site_ids: list[str], horizon_hours: int, timeout: float = 60.0) -> dict[str, Any]:
    """{available, mode, sites: {site_id: summary}, warnings, disclaimer}. Summaries are Weather ML's own fields."""
    if horizon_hours not in HORIZONS:
        raise ValueError(f"horizon_hours must be one of {HORIZONS}")
    out: dict[str, Any] = {"available": False, "mode": None, "sites": {}, "warnings": [], "disclaimer": None, "service": base_url()}
    for start in range(0, len(site_ids), MAX_SITES):
        batch = site_ids[start : start + MAX_SITES]
        try:
            reply = httpx.post(f"{base_url()}/api/predict-sites", json={"site_ids": batch, "horizon_hours": horizon_hours}, timeout=timeout)
            body = reply.json()
        except (httpx.HTTPError, ValueError) as exc:
            out["warnings"].append(f"Weather ML not reachable at {base_url()} ({type(exc).__name__}); no weather values were used.")
            return out
        if not body.get("ok"):
            error = body.get("error") or body
            out["warnings"].append(f"Weather ML refused the request: {error}")
            return out
        out["available"] = True
        out["mode"] = body.get("mode")
        out["disclaimer"] = body.get("disclaimer")
        out["warnings"].extend(body.get("warnings") or [])
        for entry in body.get("sites") or []:
            site = entry.get("site") or {}
            sid = site.get("site_id")
            if sid and entry.get("weather_exposure"):
                out["sites"][sid] = entry["weather_exposure"]
            elif sid:
                out["warnings"].append(f"{sid}: {entry.get('error') or 'no forecast'}")
    return out