"""Deterministic network-feasibility verdicts for Order 4 opportunities.

The verdict is computed from the Engineer's actual NetOps results in the investigation ledger, never from agent
prose. The Business Hypothesis agent receives it to explain, and its report is checked against it afterwards.
"""

from __future__ import annotations

import math
import re
from typing import Any

AVAILABILITY_TARGET_PCT = 99.5
AVAILABILITY_BLOCKING_PCT = 95.0
PRB_CONGESTED_PCT = 80.0
LABELS = {"supported": "supported", "at_risk": "supported with risk", "blocked": "blocked until repaired", "not_validated": "not validated"}
RULES = (f"blocked until repaired: any supporting site availability < {AVAILABILITY_BLOCKING_PCT}% or an open NTT ticket; "
         f"supported with risk: availability < {AVAILABILITY_TARGET_PCT}%, PRB >= {PRB_CONGESTED_PCT}% or a resolved NTT ticket in the window; "
         "not validated: a supporting site lacks KPI data or a valid NTT check (get_ntt_tickets takes one site_id, or a radius); "
         "supported: otherwise.")


def _km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def _number(value: Any) -> float | None:
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def _ntt_covers(call: dict[str, Any], site_id: str, lat: float | None, lng: float | None) -> bool:
    """Only an exact single site_id or a radius around the site checks it; a comma list matches nothing in NetOps."""
    args = call.get("arguments") or {}
    if args.get("site_id"):
        return str(args["site_id"]).strip() == site_id
    centre_lat, centre_lng = _number(args.get("current_lat")), _number(args.get("current_long"))
    if centre_lat is None or centre_lng is None or lat is None or lng is None:
        return False
    return _km(centre_lat, centre_lng, lat, lng) <= (_number(args.get("radius")) or 2.0)


def classify(discovery: dict[str, Any], engineer_calls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One verdict per discovered opportunity from successful get_ran_kpi / get_ntt_tickets ledger calls."""
    payload = discovery.get("data", discovery)
    opportunities = payload.get("opportunities", [])
    coords = {f["properties"].get("site_id"): f["geometry"]["coordinates"] for f in payload.get("geojson", {}).get("features", [])
              if f.get("properties", {}).get("kind") == "supporting_site"}
    ok = [c for c in engineer_calls if c.get("ok") and isinstance(c.get("data"), dict)]
    kpi: dict[str, dict[str, Any]] = {}
    for call in (c for c in ok if c.get("tool") == "get_ran_kpi"):
        for row in call["data"].get("series", []):
            if isinstance(row, dict) and row.get("site_id"):
                kpi[row["site_id"]] = row
    ntt_calls = [c for c in ok if c.get("tool") == "get_ntt_tickets"]
    tickets = [item for c in ntt_calls for item in c["data"].get("items", []) if isinstance(item, dict)]
    verdicts = []
    for opportunity in opportunities:
        sites, reasons, level = [], [], "supported"
        order = ["supported", "at_risk", "blocked"]
        for site_id in opportunity["where"]["supporting_site_ids"]:
            lng, lat = coords.get(site_id, (None, None))
            row = kpi.get(site_id, {})
            availability, prb = _number(row.get("cell_availability")), _number(row.get("dl_prb_utilization"))
            checked = any(_ntt_covers(c, site_id, lat, lng) for c in ntt_calls)
            own = [t for t in tickets if t.get("site_id") == site_id]
            open_tickets = [t["ntt_num"] for t in own if str(t.get("ntt_status", "")).lower() == "open"]
            closed_tickets = [t["ntt_num"] for t in own if str(t.get("ntt_status", "")).lower() != "open"]
            flags = []
            if availability is None or prb is None:
                flags.append("no KPI data")
            if not checked:
                flags.append("no valid NTT check")
            if availability is not None and availability < AVAILABILITY_BLOCKING_PCT:
                flags.append(f"availability {availability:.2f}% < {AVAILABILITY_BLOCKING_PCT}%")
                level = "blocked"
            elif availability is not None and availability < AVAILABILITY_TARGET_PCT:
                flags.append(f"availability {availability:.2f}% < {AVAILABILITY_TARGET_PCT}%")
                level = max(level, "at_risk", key=order.index)
            if prb is not None and prb >= PRB_CONGESTED_PCT:
                flags.append(f"PRB {prb:.1f}% >= {PRB_CONGESTED_PCT}%")
                level = max(level, "at_risk", key=order.index)
            if open_tickets:
                flags.append("open NTT " + ", ".join(open_tickets))
                level = "blocked"
            elif closed_tickets:
                flags.append("resolved NTT " + ", ".join(closed_tickets))
                level = max(level, "at_risk", key=order.index)
            reasons += [f"{site_id}: {flag}" for flag in flags]
            sites.append({"site_id": site_id, "availability_pct": availability, "prb_pct": prb, "ntt_checked": checked,
                          "open_ntt": open_tickets, "resolved_ntt": closed_tickets, "flags": flags})
        if any("no KPI data" in s["flags"] or "no valid NTT check" in s["flags"] for s in sites):
            level = "not_validated"
        verdicts.append({"opportunity_id": opportunity["opportunity_id"], "rank": opportunity["rank"], "verdict": level,
                         "label": LABELS[level], "reasons": reasons or ["all supporting sites within thresholds"], "sites": sites})
    return verdicts


def from_tasks(tasks: list[dict[str, Any]], hypothesis_task_id: str) -> list[dict[str, Any]] | None:
    """Verdicts for a hypothesis task: its own latest discovery plus the calls of the Engineer tasks it started."""
    parent = next((t for t in tasks if t["task_id"] == hypothesis_task_id), None)
    discoveries = [c for c in (parent or {}).get("tool_calls", []) if c.get("ok") and c.get("tool") == "opportunity_discover"]
    if not discoveries:
        return None
    engineer_calls = [c for t in tasks if t["agent_id"] == "engineer" for c in t.get("tool_calls", [])]
    return classify(discoveries[-1]["data"], engineer_calls)


def contradictions(report: str, verdicts: list[dict[str, Any]]) -> list[str]:
    """Opportunity sections whose stated feasibility verdict differs from the computed one."""
    sections = re.split(r"(?=#+\s*(?:Rank\s*)?#?\s*\d\b)", report or "")
    found = []
    for verdict in verdicts:
        section = next((s for s in sections if re.match(rf"#+\s*(?:Rank\s*)?#?\s*{verdict['rank']}\b", s.strip())), "")
        line = next((ln for ln in section.splitlines() if "feasibility" in ln.lower()), "").lower()
        if not line:
            continue
        stated = next((key for key, label in sorted(LABELS.items(), key=lambda kv: -len(kv[1])) if label in line), None)
        if stated and stated != verdict["verdict"]:
            found.append(f"#{verdict['rank']} report says '{LABELS[stated]}', computed '{verdict['label']}'")
    return found
