"""Order 7 commercial applications over the existing synthetic data.

A. Revenue Leak Hunter: recurring faults (avoidable field visits) and complaint-driven revenue exposure per area.
B. Business Opportunity of Absence: demand with a verified serviceability gap, a capacity constraint or missing evidence.
C. Connectivity as a Product: conditional event-connectivity packages for an upcoming synthetic event.

Every figure is computed by these functions from intel.duckdb, ml.duckdb, the Order 4 graph and the stated assumptions;
ranges come from the assumption bounds (no randomness), so identical inputs give identical outputs. Nothing here is
TM revenue, cost or customer data; "exposure" and "indicative" values are not lost revenue, prices or quotes.
"""

from __future__ import annotations

from collections import Counter
from datetime import timedelta
from pathlib import Path
from typing import Any

import duckdb

from opportunity_mcp.graph import OpportunityGraph, _rows
from opportunity_mcp.rank import _km, _potential, area_signals, discover

WINDOW_DAYS = 60

# ---- A. Revenue Leak Hunter assumptions (illustrative, not TM cost data) ----
LEAK = {
    "field_visit_rm": (900, 1_200, 2_000),        # one dispatch to a site (low, mid, high)
    "preventive_fix_rm": (4_000, 6_000, 9_000),   # one-off fix per recurring-fault site
    "churn_after_complaint": (0.05, 0.08, 0.12),  # share of complaining customers who may leave
    "arpu_rm_month": (60, 80, 100),
    "exposure_months": 12,
    "complaint_causes": ("Outage", "Congestion", "Coverage", "Indoor coverage"),
    "repeat_alarm_codes": ("VSWR_HIGH", "MW_LINK_DEGRADED"),
    "underused_prb_p95": 35.0,
}
MITIGATION = {
    "S1_LINK_LOST": "Add backhaul redundancy or replace the transport link on the repeat-outage sites.",
    "VSWR_HIGH": "Replace antenna feeders/connectors on sites with repeat VSWR alarms.",
    "MW_LINK_DEGRADED": "Realign or upgrade the microwave link; check rain fade margin.",
    "CELL_UNAVAILABLE": "Root-cause the repeat cell outages (power, hardware) before the next dispatch.",
    "Indoor coverage": "Assess an indoor small-cell or repeater for the complaint cluster.",
    "Congestion": "Plan a capacity add (carrier, sector split) for the congested cells.",
    "Coverage": "Run a coverage optimisation (tilt, power) for the complaint area.",
    "Outage": "Prioritise preventive maintenance on the repeat-outage sites.",
}

# ---- B. Opportunity of Absence thresholds ----
ABSENCE = {
    "verified_gap_fibre_serviceable_below_pct": 60.0,
    "capacity_prb_p95_at_least": 70.0,
    "capacity_congested_sites_at_least": 2,
    "measurements_needed": 10,
    "weak_rsrp_dbm": -105.0,
}

# ---- C. Event connectivity assumptions (event-specific, NOT the Order 6 SME economics) ----
EVENT = {
    "on_network_share": 0.30,          # attendees on the TM mobile network (synthetic share)
    "peak_concurrency": 0.50,
    "peak_mbps_per_user": 0.30,
    "site_capacity_mbps": 450,         # one 3-sector site at 100% PRB
    "nearby_km": 2.0,                  # sites considered to serve the venue
    "media_site_km": 1.0,
    "margin": 0.35,                    # cost-plus margin for indicative pricing
}
PACKAGES = {
    "capacity_boost": {"name": "Event-day capacity boost", "unit": "event",
                       "items": [("Cell-on-wheels deploy and recover", 15_000), ("Cell-on-wheels event-day operation", 4_000),
                                 ("Temporary backhaul tether", 3_000), ("Field engineer (2 x 1 day)", 1_600)],
                       "adds_mbps": 1_000, "description": "Temporary cell-on-wheels near the venue to add mobile capacity for attendees."},
    "vendor_connectivity": {"name": "Vendor and ticketing connectivity", "unit": "event", "vendors": 40, "mbps_per_vendor": 20,
                            "items": [("Fixed-wireless kits, 40 x RM 120", 4_800), ("POS data SIMs, 40 x RM 25", 1_000),
                                      ("Setup and on-site support", 2_400)],
                            "description": "Fixed-wireless routers and POS SIMs for 40 vendor and ticketing points."},
    "media_uplink": {"name": "Media uplink (best effort, no SLA)", "unit": "event", "uplink_mbps": 200,
                     "items": [("Reserved uplink engineering", 6_000), ("On-site media engineer", 2_000), ("Temporary fibre or microwave hop", 7_500)],
                     "description": "A 200 Mbps uplink for broadcast crews from a fibre-backhauled site next to the venue."},
}


def _rm(value: float) -> int:
    return int(round(value, -2))


def _point(lng: float, lat: float, **properties: Any) -> dict[str, Any]:
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lng, lat]}, "properties": {**properties, "synthetic": True}}


# ------------------------------------------------------------------ A
def revenue_leaks(og: OpportunityGraph, top_k: int = 3, intel_db: Path | None = None, ml_db: Path | None = None) -> dict[str, Any]:
    intel_db, ml_db = intel_db or og.intel_db, ml_db or og.ml_db
    start = og.data_end_utc - timedelta(days=WINDOW_DAYS)
    intel = duckdb.connect(str(intel_db), read_only=True)
    outages = _rows(intel, "SELECT ntt_no, site_id, start_utc, fault_category FROM outage WHERE start_utc > ?", start)
    alarms = _rows(intel, "SELECT site_id, code, raised_utc FROM alarm WHERE raised_utc > ?", start)
    complaints = _rows(intel, "SELECT complaint_id, site_id, netops_root_cause FROM complaint WHERE created_utc > ?", start)
    intel.close()
    ml = duckdb.connect(str(ml_db), read_only=True)
    booths = _rows(ml, "SELECT area_id, signups, footfall_during, network_availability_pct FROM booth_outcome WHERE network_availability_pct IS NOT NULL")
    ml.close()
    site_area = {og.graph.nodes[s]["site_id"]: og.graph.nodes[og.neighbours(s, "area")[0]]["area_id"] for s in og.nodes("site")}
    signals = area_signals(og)
    per_site_outages = Counter(o["site_id"] for o in outages)
    per_site_repeat_alarms = Counter(a["site_id"] for a in alarms if a["code"] in LEAK["repeat_alarm_codes"])
    alarm_codes = {}
    for a in alarms:
        alarm_codes.setdefault(a["site_id"], Counter())[a["code"]] += 1

    areas: dict[str, dict[str, Any]] = {}
    for site_id in sorted(set(per_site_outages) | set(per_site_repeat_alarms)):
        outage_n, alarm_n = per_site_outages[site_id], per_site_repeat_alarms[site_id]
        # first occurrence is an unavoidable fault; repeats are the avoidable share (outages and alarms never overlap)
        avoidable = (outage_n - 1 if outage_n >= 2 else 0) + (alarm_n - 1 if alarm_n >= 3 else 0)
        if not avoidable:
            continue
        entry = areas.setdefault(site_area[site_id], {"sites": [], "avoidable_visits": 0, "repeat_sites": 0})
        entry["sites"].append({"site_id": site_id, "outages_60d": outage_n, "repeat_equipment_alarms_60d": alarm_n, "avoidable_visits": avoidable,
                               "top_alarm": (alarm_codes.get(site_id) or Counter({"": 0})).most_common(1)[0][0] or None})
        entry["avoidable_visits"] += avoidable
        entry["repeat_sites"] += 1

    candidates = []
    for area_id, entry in areas.items():
        s = signals[area_id]
        site_ids = {x["site_id"] for x in entry["sites"]}
        # each complaint counted once, only at an affected site and only for network-related causes
        linked = {c["complaint_id"]: c for c in complaints if c["site_id"] in site_ids and c["netops_root_cause"] in LEAK["complaint_causes"]}
        causes = Counter(c["netops_root_cause"] for c in linked.values())
        visits = entry["avoidable_visits"]
        opex = [visits * LEAK["field_visit_rm"][i] for i in range(3)]
        fix = [entry["repeat_sites"] * LEAK["preventive_fix_rm"][i] for i in range(3)]
        exposure = [len(linked) * LEAK["churn_after_complaint"][i] * LEAK["arpu_rm_month"][i] * LEAK["exposure_months"] for i in range(3)]
        area_booths = [b for b in booths if b["area_id"] == area_id]
        degraded = [b for b in area_booths if b["network_availability_pct"] < 99]
        rate = lambda rows: round(1000 * sum(r["signups"] for r in rows) / max(1, sum(r["footfall_during"] for r in rows)), 3)  # noqa: E731
        area_sites = [og.graph.nodes[n] for n in og.neighbours(f"area:{area_id}", "site")]
        underused = sorted(n["site_id"] for n in area_sites if n["busy_prb_p95"] is not None and n["busy_prb_p95"] < LEAK["underused_prb_p95"])
        dominant_alarm = Counter(x["top_alarm"] for x in entry["sites"] if x["top_alarm"]).most_common(1)
        actions = [MITIGATION[dominant_alarm[0][0]]] if dominant_alarm and dominant_alarm[0][0] in MITIGATION else [MITIGATION["Outage"]]
        if causes:
            actions.append(MITIGATION[causes.most_common(1)[0][0]])
        candidates.append({
            "area_id": area_id, "area": s["name"], "cluster": s["cluster"], "state": s["state"], "lat": s["lat"], "lng": s["lng"],
            "affected_sites": sorted(entry["sites"], key=lambda x: (-x["avoidable_visits"], x["site_id"])),
            "evidence": {"outages_60d": sum(x["outages_60d"] for x in entry["sites"]), "repeat_equipment_alarms_60d": sum(x["repeat_equipment_alarms_60d"] for x in entry["sites"]),
                         "avoidable_field_visits": visits, "network_complaints_60d_unique": len(linked), "complaint_causes": dict(causes),
                         "underused_sites_prb_p95_below_35pct": underused,
                         "booths_during_degraded_network": len(degraded),
                         "booth_signups_per_1k_degraded_vs_normal": [rate(degraded), rate([b for b in area_booths if b["network_availability_pct"] >= 99])] if degraded else None},
            "avoidable_opex_rm": {"low": _rm(opex[0]), "mid": _rm(opex[1]), "high": _rm(opex[2])},
            "preventive_fix_cost_rm": {"low": _rm(fix[0]), "mid": _rm(fix[1]), "high": _rm(fix[2])},
            "revenue_exposure_rm": {"low": _rm(exposure[0]), "mid": _rm(exposure[1]), "high": _rm(exposure[2])},
            "total_exposure_mid_rm": _rm(opex[1] + exposure[1]),
            # run-rate if the 60-day fault pattern simply continued (an extrapolation, labelled as such)
            "annualised_avoidable_opex_mid_rm": _rm(opex[1] * 365 / WINDOW_DAYS),
            "fix_payback_days_mid": round(fix[1] / (opex[1] / WINDOW_DAYS)) if opex[1] else None,
            "mitigation": actions,
        })
    candidates.sort(key=lambda c: (-c["total_exposure_mid_rm"], c["area_id"]))
    chosen = candidates[:top_k]
    features = []
    for rank, c in enumerate(chosen, start=1):
        c["rank"] = rank
        c["recommendation"] = (f"Fix the {len(c['affected_sites'])} repeat-fault site(s) in {c['cluster']}: about RM {c['preventive_fix_cost_rm']['mid']:,} once "
                               f"against RM {c['avoidable_opex_rm']['mid']:,} of repeat field visits in 60 days (about RM {c['annualised_avoidable_opex_mid_rm']:,} a year "
                               f"if the pattern continues; payback about {c['fix_payback_days_mid']} days), plus RM {c['revenue_exposure_rm']['mid']:,} of 12-month "
                               "revenue exposure from network complaints (mid assumptions).")
        c["next_action"] = c["mitigation"][0]
        features.append(_point(c["lng"], c["lat"], id=c["area_id"], kind="leak_area", rank=rank, area=c["area"]))
        for site in c["affected_sites"]:
            node = og.graph.nodes[f"site:{site['site_id']}"]
            features.append(_point(node["lng"], node["lat"], id=site["site_id"], site_id=site["site_id"], kind="leak_site", rank=rank,
                                   outages_60d=site["outages_60d"], avoidable_visits=site["avoidable_visits"]))
    return {
        "application": "revenue_leak_hunter", "title": "Revenue Leak Hunter",
        "summary": f"{len(candidates)} areas have repeat faults in the last {WINDOW_DAYS} days; top {len(chosen)} by mid-assumption avoidable cost plus exposure.",
        "headline": chosen[0]["recommendation"] if chosen else "No repeat-fault areas found in the window.",
        "results": chosen, "geojson": {"type": "FeatureCollection", "features": features},
        "method": ["Avoidable field visits = (outages - 1) for sites with 2+ outages + (repeat VSWR/microwave alarms - 1) for sites with 3+; equipment alarms are not outages, so nothing is counted twice.",
                   "Revenue exposure = unique network-cause complaints at those sites x churn share x ARPU x 12 months; each complaint counted once.",
                   "Underused capacity and booth conversion are shown as evidence only, with no RM value."],
        "assumptions": {k: v for k, v in LEAK.items()}, "window_days": WINDOW_DAYS,
        "caveats": ["Exposure is revenue at risk under assumptions, not lost revenue; costs are illustrative, not TM data.",
                    "Booth conversion under degraded network rests on very few synthetic booths and is a correlation, not a cause."],
    }


# ------------------------------------------------------------------ B
def absence_gaps(og: OpportunityGraph, intel_db: Path | None = None, predictive: dict[str, Any] | None = None) -> dict[str, Any]:
    intel_db = intel_db or og.intel_db
    intel = duckdb.connect(str(intel_db), read_only=True)
    grid = _rows(intel, """SELECT s.cluster, count(*) AS measurements, avg((g.rsrp_dbm < ?)::int) AS weak_share, avg(g.rsrp_dbm) AS rsrp_mean
                            FROM grid_quality g JOIN cell c ON c.cell_name = g.top_cell JOIN site s ON s.site_id = c.site_id GROUP BY 1""",
                 ABSENCE["weak_rsrp_dbm"])
    intel.close()
    measured = {g["cluster"]: g for g in grid}
    signals = area_signals(og)
    demand = {a: s["sme_count"] * (1 - s["tm_business_penetration_pct"] / 100) * (1 + s["broadband_enquiries_90d"] / 500) for a, s in signals.items()}
    order = sorted(demand, key=lambda a: (demand[a], a))
    demand_pct = {a: i / (len(order) - 1) for i, a in enumerate(order)}
    rows = []
    for area_id, s in signals.items():
        m = measured.get(s["cluster"])
        evidence = {
            "fibre_serviceable_pct": s["fibre_serviceable_pct"], "busy_prb_p95_mean": round(s["busy_prb_p95_mean"], 1) if s["busy_prb_p95_mean"] else None,
            "congested_sites": s["congested_sites"], "signal_measurements": m["measurements"] if m else 0,
            "weak_signal_share_pct": round(100 * m["weak_share"], 1) if m else None, "rsrp_mean_dbm": round(m["rsrp_mean"], 1) if m else None,
        }
        classes = []
        if (m is None or m["measurements"] < ABSENCE["measurements_needed"]):
            classes.append("insufficient_information")
        if s["fibre_serviceable_pct"] < ABSENCE["verified_gap_fibre_serviceable_below_pct"] and m and m["measurements"] >= ABSENCE["measurements_needed"]:
            classes.append("verified_gap")
        if (s["busy_prb_p95_mean"] or 0) >= ABSENCE["capacity_prb_p95_at_least"] or s["congested_sites"] >= ABSENCE["capacity_congested_sites_at_least"]:
            classes.append("capacity_constraint")
        if classes:
            rows.append({"area_id": area_id, "signals": s, "evidence": evidence, "classes": classes, "demand_percentile": round(demand_pct[area_id], 3)})
    labels = {"verified_gap": "Verified serviceability gap", "capacity_constraint": "Known capacity constraint", "insufficient_information": "Missing or insufficient information"}
    actions = {"verified_gap": "Commission a fibre-extension feasibility study and offer fixed wireless to the unserved SMEs meanwhile.",
               "capacity_constraint": "Run a capacity-expansion study (carriers, sector splits) before selling more in this area.",
               "insufficient_information": "Survey first (drive test and serviceability check); do not invest or market until coverage is verified."}
    chosen = []
    for cls in ("verified_gap", "capacity_constraint", "insufficient_information"):
        pool = sorted((r for r in rows if r["classes"][0 if cls != "insufficient_information" else 0] == cls or cls in r["classes"]),
                      key=lambda r: (-r["demand_percentile"], r["area_id"]))
        pick = next((r for r in pool if r["area_id"] not in {c["area_id"] for c in chosen}), None)
        if pick:
            chosen.append({**pick, "primary_class": cls})
    results, features = [], []
    for rank, r in enumerate(chosen, start=1):
        s, cls = r["signals"], r["primary_class"]
        kind = "sme_fwa" if cls != "capacity_constraint" else "sme_fibre"
        # the exact Order 4 commercial-potential calculation, not a re-implementation
        potential = _potential(kind, s)
        low, high = potential["indicative_monthly_recurring_rm"]
        unserved = s["sme_count"] * (1 - s["tm_business_penetration_pct"] / 100)
        why = [f"{s['sme_count']:,} SMEs (synthetic), ~{unserved:,.0f} not on TM business broadband; {s['broadband_enquiries_90d']} enquiries in 90 days.",
               f"Evening footfall {s['evening_footfall_mean']:,.0f}/hour; demand percentile {r['demand_percentile']:.0%} of {len(demand_pct)} areas (synthetic)."]
        constraint = {"verified_gap": f"Only {s['fibre_serviceable_pct']:.0f}% of SME premises are fibre-serviceable (synthetic serviceability records, {r['evidence']['signal_measurements']} signal measurements).",
                      "capacity_constraint": f"Busy-hour PRB p95 averages {r['evidence']['busy_prb_p95_mean']}% with {s['congested_sites']} congested site(s) (synthetic KPIs).",
                      "insufficient_information": f"No measured signal data for {s['cluster']} ({r['evidence']['signal_measurements']} measurements): coverage is unverified, not absent."}[cls]
        results.append({"rank": rank, "area_id": r["area_id"], "area": s["name"], "cluster": s["cluster"], "state": s["state"], "lat": s["lat"], "lng": s["lng"],
                        "classification": cls, "classification_label": labels[cls], "all_classes": r["classes"], "why_it_matters": why,
                        "technical_constraint": constraint, "evidence": r["evidence"], "recommended_action": actions[cls],
                        "indicative_opportunity_rm_month": {"low": _rm(low), "high": _rm(high), "addressable_smes": potential["addressable"],
                                                            "basis": f"Order 4 {kind} assumptions: take-up {potential['take_up_pct_assumed'][0]}-{potential['take_up_pct_assumed'][1]}%, ARPU RM {potential['arpu_rm_month_assumed'][0]}-{potential['arpu_rm_month_assumed'][1]}",
                                                            "condition": "only after the survey or upgrade confirms serviceability" if cls != "verified_gap" else "fixed-wireless offer where radio serviceability is confirmed"},
                        "predictive_context": (predictive or {}).get(r["area_id"])})
        features.append(_point(s["lng"], s["lat"], id=r["area_id"], kind=f"absence_{cls}", rank=rank, area=s["name"], classification=labels[cls]))
    return {
        "application": "opportunity_of_absence", "title": "Business Opportunity of Absence",
        "summary": f"{len(rows)} areas show demand alongside a serviceability gap, a capacity constraint or missing evidence; the strongest demand case of each kind is shown.",
        "headline": "; ".join(f"{x['cluster']}: {x['classification_label'].lower()}" for x in results),
        "results": results, "geojson": {"type": "FeatureCollection", "features": features},
        "classification_rules": {"verified_gap": f"fibre-serviceable < {ABSENCE['verified_gap_fibre_serviceable_below_pct']:.0f}% and at least {ABSENCE['measurements_needed']} signal measurements",
                                 "capacity_constraint": f"busy-hour PRB p95 mean >= {ABSENCE['capacity_prb_p95_at_least']:.0f}% or >= {ABSENCE['capacity_congested_sites_at_least']} congested sites",
                                 "insufficient_information": f"fewer than {ABSENCE['measurements_needed']} signal measurements; missing data is never treated as no coverage"},
        "predictive_service": (predictive or {}).get("_status", {"available": False, "note": "Order 5 predictive service not queried; graph-derived evidence used."}),
        "caveats": ["Serviceability, signal and demand values are synthetic; a verified gap here means verified in the synthetic records.",
                    "Indicative opportunity reuses the Order 4 SME assumptions; it is not a forecast or verified revenue."],
    }


# ------------------------------------------------------------------ C
def event_packages(og: OpportunityGraph, event_id: str | None = None) -> dict[str, Any]:
    events = [og.graph.nodes[e] for e in og.nodes("event")]
    if not events:
        raise ValueError("No upcoming synthetic events in the graph window.")
    if not event_id:
        # default: the largest upcoming event of the Order 4 event-connectivity opportunity (Melaka in the current data)
        surge = next((o for o in discover(og, 3)["opportunities"] if o["kind"] == "event_surge" and o["upcoming_events"]), None)
        event_id = surge["upcoming_events"][0]["event_id"] if surge else max(events, key=lambda e: (e["attendance"] or 0, e["event_id"]))["event_id"]
    event = next((e for e in events if e["event_id"] == event_id), None)
    if event is None:
        raise ValueError(f"Unknown or past event '{event_id}'. Upcoming: {', '.join(sorted(e['event_id'] for e in events))}.")
    nearby = []
    for node in og.nodes("site"):
        site = og.graph.nodes[node]
        distance = _km(event["lat"], event["lng"], site["lat"], site["lng"])
        if distance <= EVENT["nearby_km"]:
            nearby.append({"site_id": site["site_id"], "distance_km": round(distance, 2), "backhaul": site["backhaul"],
                           "busy_prb_p95": round(site["busy_prb_p95"], 1) if site["busy_prb_p95"] is not None else None,
                           "availability_pct": round(site["availability_pct"], 2) if site["availability_pct"] is not None else None,
                           "outages_30d": site["outages_30d"], "lat": site["lat"], "lng": site["lng"]})
    nearby.sort(key=lambda s: (s["distance_km"], s["site_id"]))
    attendance = event["attendance"] or 0
    demand_mbps = attendance * EVENT["on_network_share"] * EVENT["peak_concurrency"] * EVENT["peak_mbps_per_user"]
    headroom_mbps = sum(EVENT["site_capacity_mbps"] * (1 - (s["busy_prb_p95"] or 100) / 100) for s in nearby)
    min_availability = min((s["availability_pct"] for s in nearby if s["availability_pct"] is not None), default=None)
    fibre_nearby = [s for s in nearby if s["backhaul"] == "Fiber"]
    tether_sites = [s for s in fibre_nearby if (s["availability_pct"] or 0) >= 99.0 and s["outages_30d"] == 0]
    media_candidates = [s for s in fibre_nearby if s["distance_km"] <= EVENT["media_site_km"]]
    media_quiet = [s for s in media_candidates if (s["busy_prb_p95"] or 100) < 60]
    media_sites = [s for s in media_quiet if s["outages_30d"] == 0]
    readiness = {"nearby_sites": len(nearby), "headroom_mbps": round(headroom_mbps), "attendee_peak_demand_mbps": round(demand_mbps),
                 "demand_covered_pct": round(100 * headroom_mbps / demand_mbps) if demand_mbps else None,
                 "min_availability_pct": min_availability, "fibre_backhauled_sites": len(fibre_nearby)}

    def price(items: list[tuple[str, int]]) -> dict[str, Any]:
        cost = sum(v for _, v in items)
        return {"cost_items_rm": [{"item": k, "rm": v} for k, v in items], "cost_rm": cost, "indicative_price_rm": _rm(cost * (1 + EVENT["margin"])),
                "indicative_margin_rm": _rm(cost * (1 + EVENT["margin"])) - cost}

    packages = []
    cb = PACKAGES["capacity_boost"]
    cb_checks = [("A fibre-backhauled site within 2 km to tether the cell-on-wheels", bool(fibre_nearby)),
                 ("That tether site is at or above 99.0% availability with no outage in 30 days (7-day synthetic KPIs)", bool(tether_sites))]
    packages.append({"package_id": "capacity_boost", "name": cb["name"], "description": cb["description"], **price(cb["items"]),
                     "checks": [{"condition": c, "met": ok} for c, ok in cb_checks],
                     "status": "feasible" if all(ok for _, ok in cb_checks) else "infeasible",
                     "tether_site": tether_sites[0]["site_id"] if tether_sites else None,
                     "effect": f"Adds about {cb['adds_mbps']:,} Mbps; with it, capacity covers about {round(100 * (headroom_mbps + cb['adds_mbps']) / demand_mbps) if demand_mbps else 0}% of the attendee peak estimate."})
    vc = PACKAGES["vendor_connectivity"]
    vendor_mbps = vc["vendors"] * vc["mbps_per_vendor"]
    spare_after_attendees = headroom_mbps - demand_mbps
    vc_ok_alone = spare_after_attendees >= vendor_mbps
    vc_ok_with_boost = spare_after_attendees + cb["adds_mbps"] >= vendor_mbps and packages[0]["status"] == "feasible"
    packages.append({"package_id": "vendor_connectivity", "name": vc["name"], "description": vc["description"], **price(vc["items"]),
                     "checks": [{"condition": f"{vendor_mbps} Mbps for vendors left after the attendee peak estimate", "met": vc_ok_alone},
                                {"condition": "Feasible when bundled with the capacity boost", "met": vc_ok_with_boost}],
                     "status": "feasible" if vc_ok_alone else "conditional" if vc_ok_with_boost else "infeasible",
                     "effect": "Sell only together with the capacity boost." if not vc_ok_alone and vc_ok_with_boost else "Fits within existing headroom." if vc_ok_alone else "Not enough capacity even with the boost."})
    mu = PACKAGES["media_uplink"]
    best_prb = min((s["busy_prb_p95"] for s in media_candidates if s["busy_prb_p95"] is not None), default=None)
    mu_checks = [(f"A fibre-backhauled site within {EVENT['media_site_km']} km of the venue", bool(media_candidates)),
                 ("One of those sites has busy-hour PRB p95 below 60%" + (f" (best: {best_prb}%)" if best_prb is not None else ""), bool(media_quiet)),
                 *([("That quiet site had no outage in 30 days", bool(media_sites))] if media_quiet else [])]  # only evaluated when a quiet site exists
    packages.append({"package_id": "media_uplink", "name": mu["name"], "description": mu["description"], **price(mu["items"]),
                     "checks": [{"condition": c, "met": ok} for c, ok in mu_checks],
                     "status": "feasible" if media_sites else "infeasible",
                     "effect": f"Uses {media_sites[0]['site_id']}." if media_sites else "Rejected: no site meets all conditions; a temporary fibre survey would be needed first."})
    sellable = [p for p in packages if p["status"] in ("feasible", "conditional")]
    offer = {"packages": [p["name"] for p in sellable], "indicative_total_rm": sum(p["indicative_price_rm"] for p in sellable),
             "cost_total_rm": sum(p["cost_rm"] for p in sellable), "indicative_margin_total_rm": sum(p["indicative_margin_rm"] for p in sellable)}
    local_start = (__import__("datetime").datetime.fromisoformat(event["start_utc"].removesuffix("Z")) + timedelta(hours=8)).strftime("%d %b %Y, %H:%M")
    proposal = (f"DRAFT (synthetic, indicative, not a quote). To the organiser of {event['name']} ({local_start} MYT, about {attendance:,} expected attendees): "
                + " ".join(f"{p['name']}: indicative RM {p['indicative_price_rm']:,}{' (with the capacity boost)' if p['status'] == 'conditional' else ''}." for p in sellable)
                + (f" Indicative total for the offered bundle: RM {offer['indicative_total_rm']:,}." if len(sellable) > 1 else "")
                + (" We cannot offer: " + ", ".join(p["name"] for p in packages if p["status"] == "infeasible") + ", because the network conditions are not met." if any(p["status"] == "infeasible" for p in packages) else "")
                + " All services are best effort with no service guarantee; final scope and price follow a site survey.")
    features = [_point(event["lng"], event["lat"], id=event["event_id"], kind="event_venue", name=event["name"], attendance=attendance)]
    features += [_point(s["lng"], s["lat"], id=s["site_id"], site_id=s["site_id"], kind="event_site", busy_prb_p95=s["busy_prb_p95"], backhaul=s["backhaul"]) for s in nearby]
    return {
        "application": "connectivity_as_a_product", "title": "Connectivity as a Product",
        "event": {"event_id": event["event_id"], "name": event["name"], "kind": event["event_kind"], "start_myt": local_start, "attendance": attendance,
                  "area_id": event["area_id"], "lat": event["lat"], "lng": event["lng"]},
        "summary": f"{len(sellable)} of {len(packages)} packages can be offered for {event['name']}; {len(packages) - len(sellable)} rejected on network conditions.",
        "headline": f"Offer {', '.join(p['name'] for p in sellable)} to the organiser" + (f"; reject {', '.join(p['name'] for p in packages if p['status'] == 'infeasible')}." if len(sellable) < len(packages) else "."),
        "offer": offer, "readiness": readiness, "nearby_sites": [{k: v for k, v in s.items() if k not in ("lat", "lng")} for s in nearby], "packages": packages, "proposal": proposal,
        "geojson": {"type": "FeatureCollection", "features": features},
        "assumptions": EVENT, "economics_note": "Event packages use event-specific cost items and cost-plus pricing, not the Order 6 SME acquisition model.",
        "caveats": ["Attendance, network data and costs are synthetic; prices are indicative cost-plus estimates, not quotes.",
                    "No service level or capacity guarantee is offered; feasibility uses 7-day synthetic KPIs."],
    }
