"""Turn graph signals into ranked, explainable opportunity hypotheses.

Three hypothesis families are scored for every area from its graph neighbourhood:
- sme_fibre:   unmet SME broadband demand where fibre is already serviceable  -> targeted business-fibre campaign
- sme_fwa:     unmet SME demand where fibre is NOT serviceable but radio capacity is spare -> fixed-wireless offer
- event_surge: upcoming crowd events and evening footfall -> event connectivity + pop-up sales (capacity permitting)
Scores are transparent weighted percentiles. Commercial potential is an assumption-labelled range, never revenue.
"""

from __future__ import annotations

from statistics import mean
from typing import Any

from opportunity_mcp.graph import OpportunityGraph

# Stated commercial assumptions (illustrative, not TM pricing or measured take-up)
ASSUMPTIONS = {
    "sme_fibre": {"take_up_pct": (3, 6), "arpu_rm_month": (150, 300), "basis": "SMEs in fibre-serviceable premises not yet on TM business broadband"},
    "sme_fwa": {"take_up_pct": (4, 8), "arpu_rm_month": (100, 200), "basis": "mobile-only SMEs in premises without fibre serviceability"},
    "event_surge": {"arpu_rm_month": (60, 100), "basis": "upcoming event attendance x historical synthetic pop-up booth sign-up rate"},
}
TITLES = {"sme_fibre": "SME business-fibre upsell", "sme_fwa": "Fixed-wireless for fibre-unserved SMEs", "event_surge": "Event-driven connectivity and pop-up sales"}
CONGESTED_PRB = 80.0
LIMITATIONS = [
    "All network, SME, footfall, booth and rain values are synthetic hackathon data with realistic Malaysian locations.",
    "Scores are rule-based rankings of correlated signals; they do not establish causation or guarantee demand.",
    "Commercial potential is an indicative range from stated take-up and ARPU assumptions, not verified revenue or ROI.",
    "Network feasibility uses the last 7 days of synthetic busy-hour KPIs; field survey and capacity planning are required.",
]


def _percentile(values: dict[str, float]) -> dict[str, float]:
    ordered = sorted(values, key=lambda key: (values[key], key))
    return {key: index / max(1, len(ordered) - 1) for index, key in enumerate(ordered)}


def area_signals(og: OpportunityGraph) -> dict[str, dict[str, Any]]:
    """Aggregate each area's graph neighbourhood into named signals."""
    out = {}
    for area in og.nodes("area"):
        attrs = og.graph.nodes[area]
        sites = [og.graph.nodes[s] for s in og.neighbours(area, "site")]
        hubs = {hub for s in og.neighbours(area, "site") for hub in og.neighbours(s, "hub")}
        shared_hub_sites = max((og.graph.degree(hub) for hub in hubs), default=0)
        events = [og.graph.nodes[e] for e in og.neighbours(area, "event")]
        sme = og.graph.nodes[og.neighbours(area, "sme")[0]]
        prb = [s["busy_prb_p95"] for s in sites if s["busy_prb_p95"] is not None]
        rsrp = [s["rsrp_dbm"] for s in sites if s["rsrp_dbm"] is not None]
        out[attrs["area_id"]] = {
            "area_id": attrs["area_id"], "name": attrs["name"], "cluster": attrs["cluster"], "state": sites[0]["state"] if sites else None,
            "lat": attrs["lat"], "lng": attrs["lng"], "site_ids": [s["site_id"] for s in sites],
            "sites": len(sites), "fibre_backhaul_sites": sum(s["backhaul"] == "Fiber" for s in sites),
            "busy_prb_p95_mean": mean(prb) if prb else None, "congested_sites": sum(p >= CONGESTED_PRB for p in prb),
            "availability_pct": mean(s["availability_pct"] for s in sites if s["availability_pct"] is not None),
            "outages_30d": sum(s["outages_30d"] for s in sites), "complaints_30d": sum(s["complaints_30d"] for s in sites),
            "rsrp_dbm_mean": mean(rsrp) if rsrp else None, "kpi_coverage": mean(min(1.0, s["kpi_hours"] / 168) for s in sites) if sites else 0.0,
            "max_sites_per_backhaul_hub": shared_hub_sites,
            "upcoming_events": [{"event_id": e["event_id"], "name": e["name"], "kind": e["event_kind"], "start_utc": e["start_utc"],
                                 "attendance": e["attendance"], "lat": e["lat"], "lng": e["lng"]} for e in events],
            "upcoming_attendance": sum(e["attendance"] or 0 for e in events),
            "evening_footfall_mean": attrs["evening_footfall_mean"], "booth_signups_per_1k": attrs["booth_signups_per_1k"],
            "heavy_rain_days_30d": attrs["heavy_rain_days_30d"],
            **{key: sme[key] for key in ("sme_count", "fibre_serviceable_pct", "tm_business_penetration_pct", "mobile_only_sme_pct",
                                         "broadband_enquiries_90d", "dominant_sector")},
        }
    return out


def _score(signals: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    unmet = {a: s["sme_count"] * (1 - s["tm_business_penetration_pct"] / 100) for a, s in signals.items()}
    p_unmet, p_enq = _percentile(unmet), _percentile({a: s["broadband_enquiries_90d"] for a, s in signals.items()})
    p_serv = _percentile({a: s["fibre_serviceable_pct"] for a, s in signals.items()})
    p_spare = _percentile({a: 100 - (s["busy_prb_p95_mean"] or 100) for a, s in signals.items()})
    p_att = _percentile({a: s["upcoming_attendance"] for a, s in signals.items()})
    p_foot = _percentile({a: s["evening_footfall_mean"] or 0 for a, s in signals.items()})
    candidates = []
    for area_id, s in signals.items():
        reliability = max(0.0, 1 - 0.08 * s["outages_30d"] - 0.02 * s["complaints_30d"])
        demand_sme = 0.5 * p_unmet[area_id] + 0.5 * p_enq[area_id]
        components = {
            "sme_fibre": {"demand": demand_sme, "feasibility": 0.7 * p_serv[area_id] + 0.3 * reliability},
            "sme_fwa": {"demand": demand_sme * (0.5 + s["mobile_only_sme_pct"] / 100),
                        "feasibility": (1 - p_serv[area_id]) * 0.4 + p_spare[area_id] * 0.4 + reliability * 0.2},
        }
        if s["upcoming_events"]:
            components["event_surge"] = {"demand": 0.6 * p_att[area_id] + 0.4 * p_foot[area_id],
                                         "feasibility": 0.6 * p_spare[area_id] + 0.4 * reliability}
        for kind, part in components.items():
            score = 0.55 * part["demand"] + 0.45 * part["feasibility"]
            candidates.append({"kind": kind, "area_id": area_id, "score": round(score, 4),
                               "demand_score": round(part["demand"], 3), "feasibility_score": round(part["feasibility"], 3)})
    return sorted(candidates, key=lambda c: (-c["score"], c["kind"], c["area_id"]))


def _potential(kind: str, s: dict[str, Any]) -> dict[str, Any]:
    a = ASSUMPTIONS[kind]
    if kind == "event_surge":
        rate = (s["booth_signups_per_1k"] or 0) / 1000
        sign_ups = s["upcoming_attendance"] * rate
        low, high = sign_ups * a["arpu_rm_month"][0], sign_ups * a["arpu_rm_month"][1]
        basis = {"addressable": round(s["upcoming_attendance"]), "unit": "event attendees (synthetic)",
                 "historical_signups_per_1k_footfall": round(s["booth_signups_per_1k"] or 0, 3)}
    else:
        share = s["fibre_serviceable_pct"] / 100 if kind == "sme_fibre" else (1 - s["fibre_serviceable_pct"] / 100) * s["mobile_only_sme_pct"] / 100 * 2
        addressable = s["sme_count"] * (1 - s["tm_business_penetration_pct"] / 100) * min(1.0, share)
        low = addressable * a["take_up_pct"][0] / 100 * a["arpu_rm_month"][0]
        high = addressable * a["take_up_pct"][1] / 100 * a["arpu_rm_month"][1]
        basis = {"addressable": round(addressable), "unit": "SMEs (synthetic)", "take_up_pct_assumed": list(a["take_up_pct"])}
    return {"indicative_monthly_recurring_rm": [round(low, -2), round(high, -2)], "arpu_rm_month_assumed": list(a["arpu_rm_month"]),
            "assumption_basis": a["basis"], **basis,
            "label": "Indicative range from stated synthetic assumptions. Not verified revenue, forecast or causal ROI."}


def _why(kind: str, s: dict[str, Any]) -> list[str]:
    prb = f"{s['busy_prb_p95_mean']:.0f}%" if s["busy_prb_p95_mean"] is not None else "n/a"
    if kind == "event_surge":
        biggest = max(s["upcoming_events"], key=lambda e: e["attendance"] or 0)
        return [f"{len(s['upcoming_events'])} upcoming event(s) in 30 days, {s['upcoming_attendance']:,} expected attendees; largest: {biggest['name']} ({biggest['attendance']:,}).",
                f"Evening footfall averages {s['evening_footfall_mean']:,.0f} visitors/hour (synthetic ML dataset).",
                f"Busy-hour PRB p95 averages {prb} across {s['sites']} sites; {s['congested_sites']} site(s) at or above {CONGESTED_PRB:.0f}%."]
    unmet = s["sme_count"] * (1 - s["tm_business_penetration_pct"] / 100)
    lines = [f"{s['sme_count']:,} SMEs (synthetic), {s['tm_business_penetration_pct']:.0f}% on TM business broadband: ~{unmet:,.0f} not yet served.",
             f"{s['broadband_enquiries_90d']} business-broadband enquiries in 90 days; {s['mobile_only_sme_pct']:.0f}% of SMEs are mobile-only."]
    if kind == "sme_fibre":
        lines.append(f"{s['fibre_serviceable_pct']:.0f}% of SME premises fibre-serviceable; {s['fibre_backhaul_sites']}/{s['sites']} sites on fibre backhaul.")
    else:
        lines.append(f"Only {s['fibre_serviceable_pct']:.0f}% fibre-serviceable, while busy-hour PRB p95 averages {prb} (spare radio capacity).")
    return lines


def _action(kind: str, s: dict[str, Any]) -> str:
    if kind == "sme_fibre":
        return (f"Run a targeted business-fibre campaign in {s['cluster']} for {s['dominant_sector'].lower()} SMEs in fibre-serviceable "
                "premises, prioritising recent enquiries; validate serviceability per premise before quoting.")
    if kind == "sme_fwa":
        return (f"Offer a fixed-wireless business plan to mobile-only SMEs in {s['cluster']} where fibre is not serviceable, on sites with "
                "spare busy-hour capacity; schedule fibre build review for dense pockets.")
    action = f"Prepare an event connectivity package and pop-up sales booth in {s['cluster']} for the upcoming events"
    return action + (", and plan temporary capacity (e.g. cell-on-wheels) because some sites are already congested." if s["congested_sites"]
                     else "; current busy-hour load leaves headroom, so no temporary capacity is indicated yet.")


def _risks(kind: str, s: dict[str, Any]) -> list[str]:
    risks = []
    if s["congested_sites"]:
        risks.append(f"{s['congested_sites']} site(s) congested at busy hour (PRB p95 >= {CONGESTED_PRB:.0f}%).")
    if s["outages_30d"]:
        risks.append(f"{s['outages_30d']} synthetic outage ticket(s) in the last 30 days.")
    if s["complaints_30d"] >= 3:
        risks.append(f"{s['complaints_30d']} customer complaints in the last 30 days may affect conversion.")
    if s["max_sites_per_backhaul_hub"] >= 4:
        risks.append(f"A backhaul hub carries {s['max_sites_per_backhaul_hub'] - 1} sites: shared single point of failure.")
    if kind == "event_surge" and s["heavy_rain_days_30d"] >= 4:
        risks.append(f"{s['heavy_rain_days_30d']} heavy-rain days (>=20 mm) in the last 30 days: outdoor booth weather risk.")
    if kind == "sme_fwa" and s["rsrp_dbm_mean"] is not None and s["rsrp_dbm_mean"] < -105:
        risks.append(f"Weak measured signal (mean RSRP {s['rsrp_dbm_mean']:.0f} dBm) limits fixed-wireless quality.")
    return risks or ["No network risk flags in the synthetic 7/30-day windows."]


def _validation(kind: str, s: dict[str, Any], sites: list[str]) -> list[str]:
    checks = [f"Network feasibility: busy-hour KPIs, cell availability and recent NTT tickets for sites {', '.join(sites)}."]
    if kind == "event_surge":
        checks.append("Event dates and attendance against the organiser; capacity plan for the busiest event.")
    else:
        checks.append("Premise-level fibre serviceability and SME contact consent before outreach.")
    return checks


def discover(og: OpportunityGraph, top_k: int = 3) -> dict[str, Any]:
    signals = area_signals(og)
    candidates = _score(signals)
    chosen, used_areas, used_kinds = [], set(), set()
    # one opportunity per area, and the first pass prefers different hypothesis families for a broader portfolio
    for pass_distinct_kinds in (True, False):
        for candidate in candidates:
            if len(chosen) == top_k:
                break
            if candidate["area_id"] in used_areas or (pass_distinct_kinds and candidate["kind"] in used_kinds):
                continue
            chosen.append(candidate)
            used_areas.add(candidate["area_id"])
            used_kinds.add(candidate["kind"])
    chosen.sort(key=lambda c: (-c["score"], c["kind"]))
    opportunities, features = [], []
    next_best = candidates[len(chosen)]["score"] if len(candidates) > len(chosen) else 0.0
    for rank, c in enumerate(chosen, start=1):
        s = signals[c["area_id"]]
        site_nodes = sorted(og.neighbours(f"area:{c['area_id']}", "site"),
                            key=lambda n: (-(og.graph.nodes[n]["peak_users"] or 0), n))[:3]
        sites = [og.graph.nodes[n] for n in site_nodes]
        events = sorted(s["upcoming_events"], key=lambda e: (-(e["attendance"] or 0), e["event_id"]))[:3]
        confidence = 0.45 + 0.15 * min(1.0, s["kpi_coverage"]) + 0.1 * (s["sites"] >= 5) + min(0.15, 2 * (c["score"] - next_best))
        confidence = round(min(0.85, confidence), 2)
        opportunity_id = f"OPP-{c['kind'].upper().replace('_', '-')}-{c['area_id'].removeprefix('AREA-')}"
        opportunities.append({
            "rank": rank, "opportunity_id": opportunity_id, "kind": c["kind"], "title": f"{TITLES[c['kind']]} — {s['cluster']}",
            "where": {"area_id": s["area_id"], "area": s["name"], "cluster": s["cluster"], "state": s["state"], "lat": s["lat"], "lng": s["lng"],
                      "supporting_site_ids": [x["site_id"] for x in sites]},
            "why": _why(c["kind"], s), "what_tm_should_do": _action(c["kind"], s),
            "hypothesis": f"If TM acts on {TITLES[c['kind']].lower()} in {s['cluster']}, the demand signals above indicate measurable uptake; the existing network can support it.",
            "scores": {"overall": c["score"], "demand": c["demand_score"], "feasibility": c["feasibility_score"]},
            "demand_signals": {k: (round(s[k]) if isinstance(s[k], float) else s[k]) for k in ("sme_count", "broadband_enquiries_90d", "tm_business_penetration_pct", "mobile_only_sme_pct",
                                                 "upcoming_attendance", "evening_footfall_mean")},
            "network_feasibility": {k: (round(s[k], 2) if isinstance(s[k], float) else s[k]) for k in
                                    ("sites", "busy_prb_p95_mean", "congested_sites", "availability_pct", "outages_30d", "complaints_30d",
                                     "fibre_serviceable_pct", "fibre_backhaul_sites", "max_sites_per_backhaul_hub")},
            "commercial_potential": _potential(c["kind"], s), "confidence": confidence,
            "confidence_label": "Medium-high" if confidence >= 0.75 else "Medium" if confidence >= 0.6 else "Low",
            "risks": _risks(c["kind"], s), "validation_checks": _validation(c["kind"], s, [x["site_id"] for x in sites]),
            "upcoming_events": [{k: e[k] for k in ("event_id", "name", "start_utc", "attendance")} for e in events],
            "synthetic": True,
        })
        features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [s["lng"], s["lat"]]},
                         "properties": {"id": opportunity_id, "kind": "opportunity", "rank": rank, "title": TITLES[c["kind"]],
                                        "area": s["name"], "score": c["score"], "confidence": confidence, "synthetic": True}})
        for site in sites:
            features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [site["lng"], site["lat"]]},
                             "properties": {"id": site["site_id"], "site_id": site["site_id"], "kind": "supporting_site", "rank": rank,
                                            "opportunity_id": opportunity_id, "busy_prb_p95": round(site["busy_prb_p95"] or 0, 1),
                                            "backhaul": site["backhaul"], "synthetic": True}})
        for event in events:
            features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [event["lng"], event["lat"]]},
                             "properties": {"id": event["event_id"], "kind": "upcoming_event", "rank": rank, "opportunity_id": opportunity_id,
                                            "name": event["name"], "attendance": event["attendance"], "synthetic": True}})
    summary = "; ".join(f"#{o['rank']} {o['title']} (score {o['scores']['overall']:.2f}, confidence {o['confidence_label'].lower()})" for o in opportunities)
    return {"summary": f"Graph of {og.summary()['nodes']} nodes ranked {len(candidates)} area hypotheses: {summary}.",
            "opportunities": opportunities, "candidates_considered": len(candidates),
            "geojson": {"type": "FeatureCollection", "features": features}}
