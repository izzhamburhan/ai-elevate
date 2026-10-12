"""The five network-intelligence analyses. Every number comes from intel.duckdb (or Weather ML); rules, not models.

Each function returns the shared envelope (see store.envelope) whose `data` always has: summary, geojson,
provenance, data_freshness, limitations, plus its own fields documented in docs/AI_NETWORK_INTELLIGENCE.md.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Any

import duckdb

from netintel_mcp import weather
from netintel_mcp.store import (
    MYT,
    Evidence_,
    bearing_deg,
    collection,
    connect,
    data_end_utc,
    envelope,
    haversine_km,
    iso_utc,
    parse_local,
    point,
    sector,
    severity_for,
    times,
)

CONGESTED_PRB = 85.0
MAX_SITES = 300


class InputError(ValueError):
    pass


# ---------------------------------------------------------------- shared helpers

def _site_rows(con: duckdb.DuckDBPyConnection) -> dict[str, dict[str, Any]]:
    cols = [d[0] for d in con.execute("SELECT * FROM site LIMIT 0").description]
    return {r[0]: dict(zip(cols, r, strict=True)) for r in con.execute("SELECT * FROM site ORDER BY site_id").fetchall()}


def _select_sites(con, *, site_ids=None, cluster=None, lat=None, lng=None, radius_km=None) -> list[dict[str, Any]]:
    """Sites by ids, cluster name, or circle. At least one selector is required."""
    sites = _site_rows(con)
    if site_ids:
        unknown = [s for s in site_ids if s not in sites]
        if unknown:
            raise InputError(f"Unknown site ids: {', '.join(unknown[:5])}. Use NetOps Site_ID values such as CB5348.")
        return [sites[s] for s in site_ids]
    if cluster:
        chosen = [s for s in sites.values() if str(s["cluster"]).lower() == cluster.strip().lower()]
        if not chosen:
            names = sorted({str(s["cluster"]) for s in sites.values()})
            raise InputError(f"Unknown cluster {cluster!r}. Known clusters: {', '.join(names)}")
        return chosen
    if lat is not None and lng is not None:
        radius = radius_km or 3.0
        chosen = [s for s in sites.values() if haversine_km(lat, lng, s["lat"], s["lng"]) <= radius]
        if not chosen:
            raise InputError(f"No site within {radius} km of ({lat}, {lng}).")
        return chosen
    raise InputError("Give site_ids, a cluster name, or lat/lng with radius_km.")


def _cells(con, site_ids: list[str]) -> list[dict[str, Any]]:
    rows = con.execute(
        "SELECT cell_name, site_id, sector, azimuth, band, lat, lng FROM cell WHERE site_id IN (SELECT unnest(?::VARCHAR[])) "
        "ORDER BY cell_name",
        [site_ids],
    ).fetchall()
    return [dict(zip(("cell_name", "site_id", "sector", "azimuth", "band", "lat", "lng"), r, strict=True)) for r in rows]


def _records(con, table: str, site_ids: list[str], start: datetime, end: datetime, start_col: str, end_col: str | None):
    """Rows of `table` for these sites overlapping [start, end)."""
    cols = [d[0] for d in con.execute(f"SELECT * FROM {table} LIMIT 0").description]
    end_expr = f"coalesce({end_col}, {start_col})" if end_col else start_col
    rows = con.execute(
        f"SELECT * FROM {table} WHERE site_id IN (SELECT unnest(?::VARCHAR[])) AND {start_col} < ? AND {end_expr} >= ? "
        f"ORDER BY {start_col}",
        [site_ids, end, start],
    ).fetchall()
    return [dict(zip(cols, r, strict=True)) for r in rows]


def _plain(row: dict[str, Any]) -> dict[str, Any]:
    """A record with its timestamps in UTC and Malaysia time."""
    out = {}
    for k, v in row.items():
        if isinstance(v, datetime):
            out[k.removesuffix("_utc")] = times(v)
        elif isinstance(v, float) and math.isnan(v):
            out[k] = None
        else:
            out[k] = v
    return out


def _r(value: float | None, digits: int = 1) -> float | None:
    return None if value is None or (isinstance(value, float) and math.isnan(value)) else round(float(value), digits)


def _window(con, days: int) -> tuple[datetime, datetime]:
    if not 1 <= days <= 28:
        raise InputError("days must be between 1 and 28")
    end = data_end_utc(con)
    return end - timedelta(days=days), end


def _hour_filter(hour_from: int, hour_to: int) -> str:
    """SQL condition on the Malaysia-time hour of ts_utc, inclusive, wrapping past midnight."""
    expr = "hour(ts_utc + INTERVAL 8 HOUR)"
    if hour_from <= hour_to:
        return f"{expr} BETWEEN {int(hour_from)} AND {int(hour_to)}"
    return f"({expr} >= {int(hour_from)} OR {expr} <= {int(hour_to)})"


LIMITATIONS = [
    "All network data is synthetic (NetOps seed plus the hourly extension); it demonstrates the method, not real network state.",
    "Causes are ranked by rules over the stored evidence. They are plausible explanations, not proven root causes.",
]


# ---------------------------------------------------------------- 1. complaint investigation

def investigate_customer_complaint(
    complaint_id: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    hour_from: int | None = None,
    hour_to: int | None = None,
    days: int = 28,
    description: str | None = None,
) -> dict[str, Any]:
    with connect() as con:
        ev = Evidence_(iso_utc(data_end_utc(con)) or "")
        warnings: list[str] = []
        complaint: dict[str, Any] = {}
        if complaint_id:
            row = con.execute("SELECT * FROM complaint WHERE complaint_id = ?", [complaint_id]).fetchone()
            if row is None:
                raise InputError(f"Complaint {complaint_id} not found. Recent ones: "
                                 + ", ".join(r[0] for r in con.execute("SELECT complaint_id FROM complaint ORDER BY created_utc DESC LIMIT 5").fetchall()))
            cols = [d[0] for d in con.execute("SELECT * FROM complaint LIMIT 0").description]
            complaint = dict(zip(cols, row, strict=True))
            lat, lng = complaint["lat"], complaint["lng"]
            if hour_from is None:
                local = complaint["created_utc"] + MYT
                hour_from, hour_to = (local.hour - 1) % 24, (local.hour + 1) % 24
            ev.add("complaint", complaint_id)
        if lat is None or lng is None:
            raise InputError("Give complaint_id, or the customer's lat and lng.")
        if hour_from is None:
            hour_from, hour_to = 0, 23
            warnings.append("No reported hours given: compared the whole day. Pass hour_from/hour_to (Malaysia time) for a sharper answer.")
        hour_to = hour_from if hour_to is None else hour_to
        start, end = _window(con, days)

        sites = _site_rows(con)
        near = sorted(((haversine_km(lat, lng, s["lat"], s["lng"]), s) for s in sites.values()), key=lambda x: (x[0], x[1]["site_id"]))
        if near[0][0] > 5:
            warnings.append(f"The nearest site is {near[0][0]:.1f} km away; this location may be outside the modelled network.")
        dist, serving_site = near[0]
        to_customer = bearing_deg(serving_site["lat"], serving_site["lng"], lat, lng)
        cells = _cells(con, [serving_site["site_id"]])
        serving = min(cells, key=lambda c: (abs((c["azimuth"] - to_customer + 180) % 360 - 180), c["cell_name"]))
        nearby = [(d, s) for d, s in near[1:7] if d <= 2.5]

        hours_sql = _hour_filter(hour_from, hour_to)
        stats_sql = (
            "SELECT count(*), avg(prb_dl_pct), avg(dl_throughput_mbps), avg(active_users), avg(latency_ms), avg(packet_loss_pct), "
            "avg(sinr_db), avg(availability_pct), count(DISTINCT CASE WHEN prb_dl_pct >= 85 THEN date_trunc('day', ts_utc + INTERVAL 8 HOUR) END) "
            "FROM kpi_hourly WHERE cell_name = ? AND ts_utc >= ? AND ts_utc < ? AND {cond}"
        )
        keys = ("samples", "prb_dl_pct", "dl_throughput_mbps", "active_users", "latency_ms", "packet_loss_pct", "sinr_db", "availability_pct", "days_above_85")

        def stats(cond: str) -> dict[str, Any]:
            row = con.execute(stats_sql.format(cond=cond), [serving["cell_name"], start, end]).fetchone()
            return {k: (_r(v, 2) if k != "samples" and k != "days_above_85" else v) for k, v in zip(keys, row, strict=True)}

        reported, other = stats(hours_sql), stats(f"NOT ({hours_sql})")
        ev.add("kpi_hourly", serving["cell_name"])
        profile = con.execute(
            "SELECT hour(ts_utc + INTERVAL 8 HOUR) h, avg(prb_dl_pct), avg(dl_throughput_mbps) FROM kpi_hourly "
            "WHERE cell_name = ? AND ts_utc >= ? AND ts_utc < ? GROUP BY 1 ORDER BY 1",
            [serving["cell_name"], start, end],
        ).fetchall()
        busy_hour = max(profile, key=lambda r: r[1])[0] if profile else None

        grid = con.execute(
            "SELECT grid_id, lat, lng, rsrp_dbm, rsrq_db, sinr_db, cqi FROM grid_quality ORDER BY (lat - ?)^2 + ((lng - ?) * cos(radians(?)))^2 LIMIT 1",
            [lat, lng, lat],
        ).fetchone()
        signal = None
        if grid:
            gdist = haversine_km(lat, lng, grid[1], grid[2])
            if gdist <= 0.6:
                rsrp = grid[3]
                rating = "good" if rsrp >= -95 else "fair" if rsrp >= -105 else "poor" if rsrp >= -115 else "very poor"
                signal = {"grid_id": grid[0], "distance_km": _r(gdist, 2), "rsrp_dbm": _r(rsrp), "rsrq_db": _r(grid[4]), "sinr_db": _r(grid[5]),
                          "cqi": _r(grid[6]), "rating": rating, "source": "NetOps BinKPI, averaged over the window"}
                ev.add("grid_quality", str(grid[0]))
        if signal is None:
            warnings.append("No measured signal grid within 600 m of the customer: coverage could not be checked from data.")

        site_ids = [serving_site["site_id"], *[s["site_id"] for _, s in nearby]]
        outages = _records(con, "outage", site_ids, start, end, "start_utc", "end_utc")
        maint = _records(con, "maintenance", site_ids, start, end, "start_utc", "end_utc")
        alarms = _records(con, "alarm", site_ids, start, end, "raised_utc", "cleared_utc")
        hub = con.execute("SELECT hub_site_id FROM transport_link WHERE site_id = ?", [serving_site["site_id"]]).fetchone()
        if hub:
            alarms += [a for a in _records(con, "alarm", [hub[0]], start, end, "raised_utc", "cleared_utc") if a["code"].startswith("MW_")]
        events = [e for e in con.execute("SELECT * FROM event WHERE start_utc < ? AND end_utc >= ?", [end, start]).fetchall()
                  if haversine_km(lat, lng, e[3], e[4]) <= 2.0]

        def in_hours(ts: datetime) -> bool:
            h = (ts + MYT).hour
            return hour_from <= h <= hour_to if hour_from <= hour_to else (h >= hour_from or h <= hour_to)

        serving_outages = [o for o in outages if o["site_id"] == serving_site["site_id"]]
        causes = []
        rep_prb, oth_prb = reported["prb_dl_pct"] or 0, other["prb_dl_pct"] or 0
        rep_thr, oth_thr = reported["dl_throughput_mbps"] or 0, other["dl_throughput_mbps"] or 0
        drop = 1 - rep_thr / oth_thr if oth_thr else 0
        score = max(0.0, min(1.0, (rep_prb - 70) / 20)) * (0.6 + 0.4 * min(1.0, max(0.0, drop) / 0.4))
        causes.append({
            "cause": "congestion",
            "score": round(score, 2),
            "evidence": [
                f"Serving cell {serving['cell_name']} averaged {rep_prb:.0f}% DL PRB in the reported hours vs {oth_prb:.0f}% otherwise.",
                f"User throughput {rep_thr:.1f} Mbps in the reported hours vs {oth_thr:.1f} Mbps otherwise ({drop:.0%} lower).",
                f"{reported['days_above_85']} of the last {days} days had hours at or above 85% PRB in the reported period.",
                f"Busiest hour of the cell: {busy_hour}:00 MYT." if busy_hour is not None else "No hourly profile.",
            ],
        })
        cov = 0.0
        cov_ev = []
        if signal:
            cov = 0.8 if signal["rsrp_dbm"] < -110 else 0.55 if signal["rsrp_dbm"] < -105 else 0.1
            cov_ev.append(f"Measured RSRP near the customer {signal['rsrp_dbm']} dBm ({signal['rating']}), RSRQ {signal['rsrq_db']} dB.")
        if dist > 2.0:
            cov = min(1.0, cov + 0.25)
            cov_ev.append(f"Customer is {dist:.1f} km from the nearest site.")
        causes.append({"cause": "coverage", "score": round(cov, 2), "evidence": cov_ev or ["No coverage weakness found in the data."],
                       "gaps": [] if signal else ["no measured signal grid near the customer"]})
        sinr = reported["sinr_db"]
        intf = 0.6 if sinr is not None and sinr < 3 and rep_prb < 80 else 0.15 if sinr is not None and sinr < 5 else 0.0
        causes.append({"cause": "interference", "score": intf,
                       "evidence": [f"Average SINR in the reported hours {sinr} dB."] if sinr is not None else []})
        hit = [o for o in serving_outages if in_hours(o["start_utc"]) or in_hours(o["end_utc"])]
        hit_m = [m for m in maint if m["site_id"] == serving_site["site_id"] and in_hours(m["start_utc"])]
        out_score = max([0.9 if o["fault_category"] == "Total Outage" else 0.7 if o["fault_category"] == "Partial Outage" else 0.55
                         for o in hit] + [0.45 for _ in hit_m] + [0.0])
        causes.append({"cause": "outage_or_maintenance", "score": out_score,
                       "evidence": [f"{o['ntt_no']} {o['fault_category']} {iso_utc(o['start_utc'])}" for o in hit]
                       + [f"{m['rfc_id']} {m['title']}" for m in hit_m] or ["No outage or maintenance on the serving site in the reported hours."]})
        transport_alarms = [a for a in alarms if a["code"] in ("MW_LINK_DEGRADED", "HIGH_PACKET_LOSS") and in_hours(a["raised_utc"])]
        loss = reported["packet_loss_pct"] or 0
        tr = 0.65 if transport_alarms and loss >= 1.5 else 0.35 if transport_alarms else 0.0
        causes.append({"cause": "transport", "score": tr,
                       "evidence": [f"{a['code']} on {a['site_id']} at {iso_utc(a['raised_utc'])}" for a in transport_alarms]
                       or ["No transport alarm on the serving site or its hub in the reported hours."]})
        ev_score = 0.7 if events else 0.0
        causes.append({"cause": "crowd_event", "score": ev_score,
                       "evidence": [f"{e[1]} ({e[7]} people, synthetic) within 2 km" for e in events] or ["No crowd event nearby."]})
        for c in causes:
            c["likelihood"] = "high" if c["score"] >= 0.7 else "medium" if c["score"] >= 0.4 else "low"
            c.setdefault("gaps", [])
        causes.sort(key=lambda c: -c["score"])
        top = causes[0]
        if top["score"] < 0.4:
            causes.insert(0, {"cause": "no_network_side_evidence", "score": 0.0, "likelihood": "low", "gaps": [],
                              "evidence": ["Network KPIs, signal and incident records do not explain the complaint; consider the device, "
                                           "indoor location or the customer's plan."]})

        recs = _complaint_recs(causes[0]["cause"], serving, nearby, con, start, end, hours_sql)
        sev = severity_for(top["score"])
        features = [
            point(lat, lng, id=complaint.get("complaint_id") or "customer", kind="complaint", label="Customer location", severity=sev),
            point(serving_site["lat"], serving_site["lng"], id=serving_site["site_id"], kind="site", severity=sev, score=round(top["score"], 2),
                  label=f"{serving_site['site_id']} (serving)", prb_reported_pct=rep_prb),
            sector(serving_site["lat"], serving_site["lng"], serving["azimuth"], id=serving["cell_name"], kind="sector", severity=sev,
                   label=f"{serving['cell_name']} {rep_prb:.0f}% PRB", unit="%"),
        ]
        for d, s in nearby:
            features.append(point(s["lat"], s["lng"], id=s["site_id"], kind="site", label=f"{s['site_id']} ({d:.1f} km)"))
        for e in events:
            features.append(point(e[3], e[4], id=e[0], kind="event", label=e[1]))

        summary = (
            f"Most likely cause: {causes[0]['cause'].replace('_', ' ')} ({causes[0]['likelihood']}). "
            f"The customer is served by {serving['cell_name']} ({dist:.2f} km away), which averaged {rep_prb:.0f}% PRB between "
            f"{hour_from:02d}:00 and {hour_to:02d}:59 MYT over the last {days} days against {oth_prb:.0f}% at other times."
        )
        data = {
            "summary": summary,
            "complaint": {
                "id": complaint.get("complaint_id"), "description": complaint.get("description") or description,
                "location": {"lat": lat, "lng": lng}, "created": times(complaint.get("created_utc")),
                "reported_hours_myt": [hour_from, hour_to], "source": complaint.get("source"),
            },
            "serving_cell": {**{k: serving[k] for k in ("cell_name", "site_id", "azimuth", "band")}, "distance_km": _r(dist, 2),
                             "bearing_to_customer_deg": _r(to_customer), "site_name": serving_site["name"], "cluster": serving_site["cluster"],
                             "backhaul": serving_site["backhaul"]},
            "nearby_sites": [{"site_id": s["site_id"], "distance_km": _r(d, 2), "backhaul": s["backhaul"]} for d, s in nearby],
            "kpi_comparison": {"reported_hours": reported, "other_hours": other,
                               "units": {"prb_dl_pct": "%", "dl_throughput_mbps": "Mbps", "latency_ms": "ms", "packet_loss_pct": "%",
                                         "sinr_db": "dB", "availability_pct": "%"}},
            "hourly_profile_myt": [{"hour": h, "prb_dl_pct": _r(p), "dl_throughput_mbps": _r(t)} for h, p, t in profile],
            "busy_hour_myt": busy_hour,
            "signal_quality": signal,
            "related_records": {"outages": [_plain(o) for o in outages], "maintenance": [_plain(m) for m in maint],
                                "alarms": [_plain(a) for a in alarms][:20],
                                "crowd_events": [{"event_id": e[0], "name": e[1], "start": times(e[5]), "end": times(e[6])} for e in events]},
            "causes": causes,
            "recommendations": recs,
            "time_window": {"start": times(start), "end": times(end)},
            "geojson": collection(features),
            "limitations": LIMITATIONS + ["The serving cell is estimated from geometry (nearest site, closest sector azimuth), not from the subscriber's records."],
        }
        return envelope(con, "investigate_customer_complaint", data, ev, warnings)


def _complaint_recs(cause: str, serving, nearby, con, start, end, hours_sql) -> list[dict[str, Any]]:
    if cause == "congestion":
        best = None
        for d, s in nearby:
            row = con.execute(
                f"SELECT avg(prb_dl_pct) FROM kpi_hourly WHERE site_id = ? AND ts_utc >= ? AND ts_utc < ? AND {hours_sql}", [s["site_id"], start, end]
            ).fetchone()
            if row[0] is not None and (best is None or row[0] < best[1]):
                best = (s["site_id"], row[0], d)
        recs = [{"priority": "P1", "owner": "RAN planning", "action": f"Add capacity on {serving['cell_name']}: a second carrier or a sector split.",
                 "rationale": "The cell is above 85% PRB in the hours the customer reports, and throughput falls with it."}]
        if best:
            recs.append({"priority": "P2", "owner": "RAN optimisation",
                         "action": f"Until then, shift load to {best[0]} ({best[2]:.1f} km, {best[1]:.0f}% PRB in the same hours) with handover/tilt tuning.",
                         "rationale": "A neighbour has headroom in the same hours."})
        return recs
    return {
        "coverage": [{"priority": "P2", "owner": "RF engineering", "action": "Drive test or indoor survey at the customer location; consider an indoor solution.",
                      "rationale": "Measured signal near the customer is weak."}],
        "interference": [{"priority": "P2", "owner": "RF engineering", "action": "Interference hunt on the serving cell (PCI/neighbour audit, external sources).",
                          "rationale": "SINR is low while load is moderate."}],
        "outage_or_maintenance": [{"priority": "P1", "owner": "NOC", "action": "Follow up the open trouble ticket / maintenance record and confirm restoration with the customer.",
                                   "rationale": "An outage or maintenance on the serving site overlaps the reported hours."}],
        "transport": [{"priority": "P1", "owner": "Transport", "action": "Check the microwave link and hub feeding the serving site.",
                       "rationale": "Transport alarms and packet loss overlap the reported hours."}],
        "crowd_event": [{"priority": "P2", "owner": "RAN planning", "action": "Plan temporary capacity (cell on wheels, extra carrier) for future events at this venue.",
                         "rationale": "A large crowd event overlaps the complaint."}],
    }.get(cause, [{"priority": "P3", "owner": "Customer care", "action": "Ask for a speed test, device model and indoor/outdoor location before escalating.",
                   "rationale": "No network-side evidence explains the complaint."}])


# ---------------------------------------------------------------- 2. congestion

def analyze_network_congestion(
    cluster: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    radius_km: float | None = None,
    site_ids: list[str] | None = None,
    days: int = 7,
    threshold_pct: float = CONGESTED_PRB,
    limit: int = 20,
) -> dict[str, Any]:
    with connect() as con:
        ev = Evidence_(iso_utc(data_end_utc(con)) or "")
        sites = _select_sites(con, site_ids=site_ids, cluster=cluster, lat=lat, lng=lng, radius_km=radius_km)[:MAX_SITES]
        ids = [s["site_id"] for s in sites]
        start, end = _window(con, days)
        prev_start = start - timedelta(days=days)
        rows = con.execute(
            """
            SELECT cell_name, any_value(site_id),
                   count(*) FILTER (WHERE prb_dl_pct >= ? AND ts_utc >= ?) AS hours,
                   count(DISTINCT date_trunc('day', ts_utc + INTERVAL 8 HOUR)) FILTER (WHERE prb_dl_pct >= ? AND ts_utc >= ?) AS days_hit,
                   count(*) FILTER (WHERE prb_dl_pct >= ? AND ts_utc < ?) AS prev_hours,
                   max(prb_dl_pct) FILTER (WHERE ts_utc >= ?), quantile_cont(prb_dl_pct, 0.95) FILTER (WHERE ts_utc >= ?),
                   avg(prb_dl_pct) FILTER (WHERE ts_utc >= ?),
                   avg(active_users) FILTER (WHERE prb_dl_pct >= ? AND ts_utc >= ?),
                   avg(dl_throughput_mbps) FILTER (WHERE prb_dl_pct >= ? AND ts_utc >= ?),
                   avg(dl_throughput_mbps) FILTER (WHERE prb_dl_pct < ? AND ts_utc >= ?)
            FROM kpi_hourly WHERE site_id IN (SELECT unnest(?::VARCHAR[])) AND ts_utc >= ? AND ts_utc < ?
            GROUP BY cell_name HAVING hours > 0 ORDER BY hours DESC, cell_name
            """,
            [threshold_pct, start, threshold_pct, start, threshold_pct, start, start, start, start, threshold_pct, start,
             threshold_pct, start, threshold_pct, start, ids, prev_start, end],
        ).fetchall()
        ev.add("kpi_hourly", f"{len(ids)} sites")
        busy = dict(con.execute(
            "SELECT cell_name, arg_max(h, p) FROM (SELECT cell_name, hour(ts_utc + INTERVAL 8 HOUR) h, avg(prb_dl_pct) p FROM kpi_hourly "
            "WHERE site_id IN (SELECT unnest(?::VARCHAR[])) AND ts_utc >= ? AND ts_utc < ? GROUP BY 1, 2) GROUP BY 1",
            [ids, start, end],
        ).fetchall())
        cells = {c["cell_name"]: c for c in _cells(con, ids)}
        site_index = {s["site_id"]: s for s in sites}
        findings = []
        for cell, site_id, hours, days_hit, prev, peak, p95, avg, users, thr_c, thr_o in rows:
            per_day = hours / days
            sev = "CRITICAL" if per_day >= 4 and (peak or 0) >= 95 else "HIGH" if per_day >= 2 else "MEDIUM" if per_day >= 0.75 else "LOW"
            trend = "rising" if hours > prev * 1.2 + 1 else "falling" if hours < prev * 0.8 - 1 else "steady"
            findings.append({
                "cell_name": cell, "site_id": site_id, "cluster": site_index[site_id]["cluster"], "severity": sev,
                "congested_hours": hours, "congested_hours_per_day": _r(per_day, 2), "days_with_congestion": days_hit,
                "previous_period_hours": prev, "trend": trend, "busy_hour_myt": busy.get(cell),
                "peak_prb_pct": _r(peak), "p95_prb_pct": _r(p95), "avg_prb_pct": _r(avg),
                "avg_active_users_when_congested": _r(users, 0), "throughput_when_congested_mbps": _r(thr_c),
                "throughput_otherwise_mbps": _r(thr_o), "recommendation": _congestion_action(sev),
            })
        order = {s: i for i, s in enumerate(("CRITICAL", "HIGH", "MEDIUM", "LOW"))}
        findings.sort(key=lambda f: (order[f["severity"]], -f["congested_hours"], f["cell_name"]))
        counts = {s: sum(1 for f in findings if f["severity"] == s) for s in order}
        shown = findings[: max(1, min(limit, 100))]
        events = [e for e in con.execute("SELECT event_id, name, lat, lng, start_utc, end_utc, attendance FROM event WHERE start_utc < ? AND end_utc >= ?",
                                         [end, start]).fetchall() if any(haversine_km(e[2], e[3], s["lat"], s["lng"]) <= 3 for s in sites)]
        features = []
        worst: dict[str, str] = {}
        for f in shown:
            c = cells[f["cell_name"]]
            features.append(sector(c["lat"], c["lng"], c["azimuth"], id=f["cell_name"], kind="sector", severity=f["severity"],
                                   score=_r(min(1.0, f["congested_hours_per_day"] / 6), 2), label=f"{f['cell_name']} {f['congested_hours']} h", unit="hours"))
            if order[f["severity"]] < order.get(worst.get(f["site_id"], "LOW"), 9) or f["site_id"] not in worst:
                worst[f["site_id"]] = f["severity"]
        for sid, sev in worst.items():
            s = site_index[sid]
            features.append(point(s["lat"], s["lng"], id=sid, kind="site", severity=sev, label=f"{sid} ({s['cluster']})"))
        for e in events:
            features.append(point(e[2], e[3], id=e[0], kind="event", label=f"{e[1]} ({e[6]} people)"))
        summary = (
            f"{len(findings)} of {len(cells)} cells reached {threshold_pct:.0f}% PRB in the last {days} days "
            f"({counts['CRITICAL']} critical, {counts['HIGH']} high, {counts['MEDIUM']} medium, {counts['LOW']} low)."
            + (f" Worst: {findings[0]['cell_name']}, {findings[0]['congested_hours']} congested hours, busy hour "
               f"{findings[0]['busy_hour_myt']}:00 MYT." if findings else "")
        )
        data = {
            "summary": summary, "threshold_prb_pct": threshold_pct, "time_window": {"start": times(start), "end": times(end)},
            "area": {"sites": len(sites), "cells": len(cells), "cluster": cluster, "site_ids": site_ids, "center": [lat, lng] if lat is not None else None,
                     "radius_km": radius_km},
            "severity_counts": counts, "cells": shown, "truncated": len(findings) > len(shown),
            "events_in_area": [{"event_id": e[0], "name": e[1], "start": times(e[4]), "end": times(e[5]), "attendance": e[6]} for e in events],
            "severity_rule": "per cell, congested hours per day: CRITICAL >= 4 (and peak >= 95%), HIGH >= 2, MEDIUM >= 0.75, LOW > 0",
            "geojson": collection(features),
            "limitations": LIMITATIONS + ["Active users during congestion is an average of hourly counts, an estimate of affected customers, not a census."],
        }
        return envelope(con, "analyze_network_congestion", data, ev, [])


def _congestion_action(severity: str) -> str:
    return {
        "CRITICAL": "Capacity expansion: add a carrier or split the sector; plan a new site if neighbours are also hot.",
        "HIGH": "Capacity expansion or load balancing to a neighbour with headroom; review tilt and handover margins.",
        "MEDIUM": "Parameter optimisation (load balancing, inter-frequency offload) and watch the trend.",
        "LOW": "Monitor.",
    }[severity]


# ---------------------------------------------------------------- 3. incident correlation

def _degraded_hours(con, ids: list[str], start: datetime, end: datetime) -> list[tuple[str, datetime, float, float, float, float]]:
    """Site-hours that look degraded for a reason other than load: availability < 95%, or loss >= 2% / latency >= 60 ms while no
    cell of the site is above 90% PRB (heavy load alone also raises loss and latency; that is congestion, not an incident)."""
    return con.execute(
        "SELECT site_id, ts_utc, min(availability_pct), max(packet_loss_pct), max(latency_ms), avg(dl_throughput_mbps) FROM kpi_hourly "
        "WHERE site_id IN (SELECT unnest(?::VARCHAR[])) AND ts_utc >= ? AND ts_utc < ? GROUP BY 1, 2 "
        "HAVING min(availability_pct) < 95 OR ((max(packet_loss_pct) >= 2 OR max(latency_ms) >= 60) AND max(prb_dl_pct) < 90) ORDER BY 2, 1",
        [ids, start, end],
    ).fetchall()


def correlate_network_incidents(
    site_ids: list[str] | None = None,
    cluster: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    radius_km: float | None = None,
    start: str | None = None,
    end: str | None = None,
    use_weather: bool = True,
) -> dict[str, Any]:
    with connect() as con:
        ev = Evidence_(iso_utc(data_end_utc(con)) or "")
        warnings: list[str] = []
        sites = _select_sites(con, site_ids=site_ids, cluster=cluster, lat=lat, lng=lng, radius_km=radius_km)[:MAX_SITES]
        ids = [s["site_id"] for s in sites]
        data_end = data_end_utc(con)
        if start and end:
            t0, t1 = parse_local(start), parse_local(end)
        else:
            # find the latest hour in the window where two or more of these sites were degraded together
            hours = _degraded_hours(con, ids, data_end - timedelta(days=28), data_end)
            by_hour: dict[datetime, set[str]] = {}
            for sid, ts, *_ in hours:
                by_hour.setdefault(ts, set()).add(sid)
            need = min(2, len(ids))
            joint = [ts for ts, s in by_hour.items() if len(s) >= need]
            if not joint:
                t1 = data_end
                t0 = t1 - timedelta(hours=24)
                warnings.append("No hour where these sites were degraded together; looked at the last 24 hours instead.")
            else:
                # the hour with the most sites degraded together (latest on ties), widened to its contiguous episode
                last = max(joint, key=lambda ts: (len(by_hour[ts]), ts))
                first = last
                while len(by_hour.get(first - timedelta(hours=1), ())) >= need:
                    first -= timedelta(hours=1)
                while len(by_hour.get(last + timedelta(hours=1), ())) >= need:
                    last += timedelta(hours=1)
                t0, t1 = first, last + timedelta(hours=1)
        if t1 <= t0:
            raise InputError("end must be after start")
        pad = timedelta(hours=2)
        degraded = _degraded_hours(con, ids, t0, t1)
        ev.add("kpi_hourly", f"{len(ids)} sites")
        per_site: dict[str, dict[str, Any]] = {sid: {"site_id": sid, "degraded_hours": 0, "max_packet_loss_pct": None, "max_latency_ms": None,
                                                    "min_availability_pct": None} for sid in ids}
        for sid, _ts, av, loss, latency, _thr in degraded:
            p = per_site[sid]
            p["degraded_hours"] += 1
            p["max_packet_loss_pct"] = _r(max(loss or 0, p["max_packet_loss_pct"] or 0), 2)
            p["max_latency_ms"] = _r(max(latency or 0, p["max_latency_ms"] or 0))
            p["min_availability_pct"] = _r(min(av, p["min_availability_pct"] if p["min_availability_pct"] is not None else 100), 1)
        affected = [sid for sid, p in per_site.items() if p["degraded_hours"]]
        outages = _records(con, "outage", ids, t0 - pad, t1 + pad, "start_utc", "end_utc")
        alarms = _records(con, "alarm", ids, t0 - pad, t1 + pad, "raised_utc", "cleared_utc")
        hubs = dict(con.execute("SELECT site_id, hub_site_id FROM transport_link WHERE site_id IN (SELECT unnest(?::VARCHAR[]))", [ids]).fetchall())
        all_sites = _site_rows(con)
        # maintenance on these sites, their transport hubs, or any site within 10 km
        near_ids = sorted({s for s in all_sites if any(haversine_km(all_sites[s]["lat"], all_sites[s]["lng"], x["lat"], x["lng"]) <= 10 for x in sites)}
                          | set(hubs.values()))
        maint = _records(con, "maintenance", near_ids, t0 - pad, t1 + pad, "start_utc", "end_utc")
        hub_alarms = _records(con, "alarm", sorted(set(hubs.values())), t0 - pad, t1 + pad, "raised_utc", "cleared_utc") if hubs else []
        ev.add("outage/maintenance/alarm", f"{t0:%Y-%m-%d %H}:00Z")

        hypotheses = []
        focus = affected or ids
        shared_hub = {hubs.get(s) for s in focus}
        if len(focus) >= 2 and len(shared_hub) == 1 and None not in shared_hub:
            hub = shared_hub.pop()
            hub_m = [m for m in maint if m["site_id"] == hub]
            support = [f"All {len(focus)} affected sites are fed by microwave from hub {hub}."]
            support += [f"{m['rfc_id']} '{m['title']}' on the hub {iso_utc(m['start_utc'])}..{iso_utc(m['end_utc'])}" for m in hub_m]
            support += [f"{a['code']} on hub {a['site_id']} at {iso_utc(a['raised_utc'])}" for a in hub_alarms]
            strength = "strong" if hub_m or hub_alarms else "moderate"
            hypotheses.append({"hypothesis": f"Shared transport: a problem on hub {hub} or its microwave links", "strength": strength,
                               "supporting": support, "contradicting": []})
        other_m = [m for m in maint if m["site_id"] not in set(hubs.values())]
        if other_m:
            hypotheses.append({"hypothesis": "Planned maintenance nearby", "strength": "moderate" if any(m["site_id"] in focus for m in other_m) else "weak",
                               "supporting": [f"{m['rfc_id']} on {m['site_id']}: {m['title']}" for m in other_m[:5]], "contradicting": []})
        exch = {all_sites[s]["exchange"] for s in focus}
        if len(focus) >= 2 and len(exch) == 1:
            hypotheses.append({"hypothesis": f"Common TM exchange {next(iter(exch))}", "strength": "weak",
                               "supporting": ["All affected sites use the same exchange."], "contradicting": []})
        codes: dict[str, set[str]] = {}
        for a in alarms:
            codes.setdefault(a["code"], set()).add(a["site_id"])
        common = {c: s for c, s in codes.items() if len(s) >= 2}
        if common:
            hypotheses.append({"hypothesis": "Same alarm on several sites", "strength": "moderate",
                               "supporting": [f"{c} on {', '.join(sorted(s))}" for c, s in common.items()], "contradicting": []})
        spread = max((haversine_km(all_sites[a]["lat"], all_sites[a]["lng"], all_sites[b]["lat"], all_sites[b]["lng"])
                      for a in focus for b in focus), default=0.0)

        weather_block: dict[str, Any] = {"used": False}
        if use_weather:
            w = weather.predict_sites(focus[:25], 24)
            weather_block = {"used": w["available"], "mode": w["mode"], "service": w["service"], "warnings": w["warnings"]}
            if w["available"]:
                ev.add("weather_ml:predict_sites", source="weather-ml-mcp")
                overlapping = {}
                for sid, s in w["sites"].items():
                    fs, fe = parse_local(s["forecast_start"]), parse_local(s["forecast_end"])
                    if fs < t1 and fe >= t0:
                        overlapping[sid] = s
                weather_block["sites"] = {sid: {k: s.get(k) for k in ("exposure", "peak_rainfall_mm", "rainfall_mm", "forecast_start", "forecast_end",
                                                                     "mode", "model_id")} for sid, s in w["sites"].items()}
                if overlapping:
                    levels = {s["exposure"] for s in overlapping.values()}
                    peak = max(s["peak_rainfall_mm"] for s in overlapping.values())
                    strength = "moderate" if levels & {"elevated", "high"} else "unlikely"
                    hypotheses.append({"hypothesis": "Weather", "strength": strength,
                                       "supporting": [f"Weather ML ({w['mode']}) forecast peak {peak:.2f} mm/h, exposure {', '.join(sorted(levels))}."]
                                       if strength != "unlikely" else [],
                                       "contradicting": [f"Weather ML ({w['mode']}) forecast peak {peak:.2f} mm/h: {', '.join(sorted(levels))} exposure only."]
                                       if strength == "unlikely" else []})
                else:
                    weather_block["note"] = "Weather ML forecasts do not cover this time window, so weather was not assessed."
            else:
                warnings.extend(w["warnings"])
        if not hypotheses:
            hypotheses.append({"hypothesis": "Independent faults", "strength": "weak",
                               "supporting": ["No shared transport, maintenance, alarm or weather factor found."], "contradicting": []})
        rank = {"strong": 0, "moderate": 1, "weak": 2, "unlikely": 3}
        hypotheses.sort(key=lambda h: rank[h["strength"]])

        features = []
        for sid in ids:
            s = all_sites[sid]
            p = per_site[sid]
            sev = severity_for(min(1.0, p["degraded_hours"] / 4)) if p["degraded_hours"] else None
            features.append(point(s["lat"], s["lng"], id=sid, kind="site", severity=sev, label=f"{sid} {p['degraded_hours']} h degraded",
                                  score=_r(min(1.0, p["degraded_hours"] / 4), 2), unit="hours"))
            if sid in hubs:
                h = all_sites[hubs[sid]]
                features.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[s["lng"], s["lat"]], [h["lng"], h["lat"]]]},
                                 "properties": {"id": f"{sid}->{hubs[sid]}", "kind": "transport_link", "severity": None, "score": None,
                                                "label": f"microwave {sid} to hub {hubs[sid]}", "unit": None}})
        for hub in sorted(set(hubs.values())):
            h = all_sites[hub]
            features.append(point(h["lat"], h["lng"], id=hub, kind="hub", label=f"Hub {hub}"))
        summary = (
            f"{len(affected)} of {len(ids)} sites were degraded between {iso_utc(t0)} and {iso_utc(t1)} (UTC). "
            f"Leading explanation: {hypotheses[0]['hypothesis']} ({hypotheses[0]['strength']}). This is a correlation, not a proven cause."
        )
        data = {
            "summary": summary, "time_window": {"start": times(t0), "end": times(t1)}, "sites": list(per_site.values()),
            "affected_sites": affected, "max_distance_between_affected_km": _r(spread, 2),
            "shared_attributes": {"transport_hubs": hubs, "exchanges": sorted(str(e) for e in exch), "clusters": sorted({all_sites[s]["cluster"] for s in focus}),
                                  "backhaul": sorted({all_sites[s]["backhaul"] for s in focus})},
            "records": {"outages": [_plain(o) for o in outages], "maintenance": [_plain(m) for m in maint], "alarms": [_plain(a) for a in alarms + hub_alarms]},
            "weather": weather_block, "hypotheses": hypotheses, "geojson": collection(features),
            "limitations": LIMITATIONS + ["Correlation is not causation: a shared factor makes a cause plausible, it does not prove it.",
                                          "The transport topology (microwave site to nearest fibre hub) is a demo assumption, not a NetOps record."],
        }
        return envelope(con, "correlate_network_incidents", data, ev, warnings)


# ---------------------------------------------------------------- 4. weather exposure

def _vulnerability(con, site: dict[str, Any], start: datetime, end: datetime) -> dict[str, Any]:
    factors, score = [], 0.0
    if site["backhaul"] == "Microwave":
        score += 0.3
        factors.append("microwave backhaul (rain fade)")
    outages = con.execute("SELECT count(*) FROM outage WHERE site_id = ? AND start_utc >= ? AND start_utc < ? AND fault_category <> 'No Impact'",
                          [site["site_id"], start, end]).fetchone()[0]
    if outages:
        score += min(0.4, 0.1 * outages)
        factors.append(f"{outages} outage/degradation tickets in the last 28 days")
    alarms = con.execute("SELECT count(*) FROM alarm WHERE site_id = ? AND raised_utc >= ? AND raised_utc < ?", [site["site_id"], start, end]).fetchone()[0]
    if alarms >= 3:
        score += 0.15
        factors.append(f"{alarms} alarms in the last 28 days")
    avail = con.execute("SELECT avg(availability_pct) FROM kpi_hourly WHERE site_id = ? AND ts_utc >= ?", [site["site_id"], start]).fetchone()[0]
    if avail is not None and avail < 99:
        score += 0.15
        factors.append(f"average availability {avail:.1f}%")
    return {"score": round(min(1.0, score), 2), "factors": factors or ["no known weakness"], "availability_pct": _r(avail, 2)}


def assess_weather_network_exposure(
    site_ids: list[str] | None = None,
    cluster: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    radius_km: float | None = None,
    horizon_hours: int = 24,
) -> dict[str, Any]:
    if horizon_hours not in weather.HORIZONS:
        raise InputError("horizon_hours must be 6, 12 or 24")
    with connect() as con:
        ev = Evidence_(iso_utc(data_end_utc(con)) or "")
        sites = _select_sites(con, site_ids=site_ids, cluster=cluster, lat=lat, lng=lng, radius_km=radius_km)
        warnings = []
        if len(sites) > weather.MAX_SITES:
            warnings.append(f"{len(sites)} sites selected; assessed the first {weather.MAX_SITES} (Weather ML's per-request limit).")
            sites = sites[: weather.MAX_SITES]
        end = data_end_utc(con)
        start = end - timedelta(days=28)
        w = weather.predict_sites([s["site_id"] for s in sites], horizon_hours)
        warnings.extend(w["warnings"])
        if w["available"]:
            ev.add("weather_ml:predict_sites", source="weather-ml-mcp")
        out, features = [], []
        for s in sites:
            vuln = _vulnerability(con, s, start, end)
            fw = w["sites"].get(s["site_id"])
            level = fw["exposure"] if fw else None
            if level is None:
                indicator = None
            elif level == "high":
                indicator = "HIGH" if vuln["score"] >= 0.3 else "MEDIUM"
            elif level == "elevated":
                indicator = "MEDIUM" if vuln["score"] >= 0.5 else "LOW"
            else:
                indicator = "LOW"
            out.append({
                "site_id": s["site_id"], "cluster": s["cluster"], "lat": s["lat"], "lng": s["lng"], "backhaul": s["backhaul"],
                "weather": {k: fw.get(k) for k in ("exposure", "peak_rainfall_mm", "rainfall_mm", "temperature_c", "forecast_start", "forecast_end",
                                                   "mode", "model_id", "weather_location_id", "units")} if fw else None,
                "vulnerability": vuln, "exposure_indicator": indicator,
            })
            features.append(point(s["lat"], s["lng"], id=s["site_id"], kind="site", severity=indicator, score=vuln["score"],
                                  label=f"{s['site_id']} {indicator or 'no forecast'}", unit=None, weather_exposure=level))
        ev.add("vulnerability", f"{len(sites)} sites")
        counts = {k: sum(1 for o in out if o["exposure_indicator"] == k) for k in ("HIGH", "MEDIUM", "LOW")}
        mode = w["mode"] or "unavailable"
        summary = (
            f"Weather ML ({mode}, {horizon_hours} h) and site vulnerability for {len(out)} sites: {counts['HIGH']} high, {counts['MEDIUM']} medium, "
            f"{counts['LOW']} low exposure." if w["available"] else
            f"Weather ML is not available, so only site vulnerability is reported for {len(out)} sites (no weather values were used)."
        )
        data = {
            "summary": summary, "horizon_hours": horizon_hours, "weather_mode": mode,
            "weather_note": "replay = forecast for a past window using only data before its cutoff; live = forecast from fresh inputs" if w["available"] else None,
            "weather_disclaimer": w["disclaimer"], "sites": out, "indicator_counts": counts,
            "indicator_rule": "Weather ML exposure (low/elevated/high, from peak hourly median rainfall) combined with a site vulnerability score: "
                              "high weather -> HIGH if vulnerability >= 0.3 else MEDIUM; elevated -> MEDIUM if vulnerability >= 0.5 else LOW; low -> LOW.",
            "geojson": collection(features),
            "limitations": LIMITATIONS + [
                "Chronos forecasts weather, not equipment failure. The indicator is an exposure heuristic, not a failure probability.",
                "Weather ML forecasts a few cached locations; each site uses the nearest one (coarse).",
            ],
        }
        return envelope(con, "assess_weather_network_exposure", data, ev, warnings)


# ---------------------------------------------------------------- 5. maintenance recommendations

def recommend_network_maintenance(
    cluster: str | None = None,
    site_ids: list[str] | None = None,
    lat: float | None = None,
    lng: float | None = None,
    radius_km: float | None = None,
    limit: int = 10,
    include_weather: bool = False,
) -> dict[str, Any]:
    with connect() as con:
        ev = Evidence_(iso_utc(data_end_utc(con)) or "")
        if cluster or site_ids or lat is not None:
            sites = _select_sites(con, site_ids=site_ids, cluster=cluster, lat=lat, lng=lng, radius_km=radius_km)
        else:
            sites = list(_site_rows(con).values())
        ids = [s["site_id"] for s in sites]
        site_index = {s["site_id"]: s for s in sites}
        end = data_end_utc(con)
        start = end - timedelta(days=28)
        recs: list[dict[str, Any]] = []

        week = end - timedelta(days=7)
        # one recommendation per site: its worst cell, when that cell is congested 4+ hours a day on average
        for site_id, cell, hours, busy in con.execute(
            "SELECT site_id, arg_max(cell_name, hours), max(hours), arg_max(busy, hours) FROM ("
            "  SELECT site_id, cell_name, count(*) FILTER (WHERE prb_dl_pct >= 85) AS hours, "
            "  arg_max(hour(ts_utc + INTERVAL 8 HOUR), prb_dl_pct) AS busy FROM kpi_hourly "
            "  WHERE site_id IN (SELECT unnest(?::VARCHAR[])) AND ts_utc >= ? GROUP BY 1, 2) "
            "GROUP BY 1 HAVING max(hours) >= 28 ORDER BY 3 DESC, 1",
            [ids, week],
        ).fetchall():
            recs.append(_rec("P1" if hours >= 56 else "P2", "chronic_congestion", site_id, cell,
                             "Investigate the consistently congested sector and plan capacity (carrier add or sector split).",
                             [f"{cell}: {hours} hours at or above 85% PRB in the last 7 days; peak load at {busy}:00 MYT."], "RAN-Capacity",
                             weight=hours / 168))
        for site_id, code, n, first, last in con.execute(
            "SELECT site_id, code, count(*), min(raised_utc), max(raised_utc) FROM alarm WHERE site_id IN (SELECT unnest(?::VARCHAR[])) "
            "AND raised_utc >= ? GROUP BY 1, 2 HAVING count(*) >= 3 ORDER BY 3 DESC",
            [ids, start],
        ).fetchall():
            if code == "VSWR_HIGH":
                action, cat, sub = "Inspect the antenna, feeder and connectors (unstable radio equipment).", "recurring_radio_alarm", "RAN-Antenna"
            elif code.startswith("MW_"):
                action, cat, sub = "Investigate the recurring microwave/backhaul degradation (alignment, rain fade margin, radio).", "recurring_backhaul", "TX-Microwave link"
            else:
                action, cat, sub = f"Review the recurring {code} alarms with the vendor.", "recurring_alarm", "RAN-eNodeB"
            recs.append(_rec("P2", cat, site_id, None, action, [f"{n} {code} alarms between {iso_utc(first)} and {iso_utc(last)}."], sub,
                             weight=min(1.0, n / 6)))
        for site_id, n in con.execute(
            "SELECT site_id, count(*) FROM outage WHERE site_id IN (SELECT unnest(?::VARCHAR[])) AND start_utc >= ? "
            "AND fault_category IN ('Total Outage', 'Partial Outage') GROUP BY 1 HAVING count(*) >= 2 ORDER BY 2 DESC",
            [ids, start],
        ).fetchall():
            recs.append(_rec("P1", "repeated_outage", site_id, None, "Root-cause review of repeated outages (power, transmission, hardware).",
                             [f"{n} total/partial outage tickets in the last 28 days."], "RAN-eNodeB", weight=min(1.0, n / 4)))
        for site_id, n in con.execute(
            "SELECT site_id, count(*) FROM complaint WHERE site_id IN (SELECT unnest(?::VARCHAR[])) AND created_utc >= ? "
            "AND category = 'Coverage' GROUP BY 1 HAVING count(*) >= 3 ORDER BY 2 DESC",
            [ids, start],
        ).fetchall():
            recs.append(_rec("P3", "coverage_complaints", site_id, None, "Coverage check (drive test / indoor survey) around the site.",
                             [f"{n} coverage complaints in the last 28 days."], "RF-Optimisation", weight=min(1.0, n / 6)))
        ev.add("kpi_hourly/alarm/outage/complaint", f"{len(ids)} sites")
        warnings: list[str] = []
        if include_weather:
            exposure = assess_weather_network_exposure(site_ids=sorted({r["site_id"] for r in recs})[:25] or ids[:25])
            warnings.extend(exposure["warnings"])
            for s in exposure["data"]["sites"]:
                if s["exposure_indicator"] in ("HIGH", "MEDIUM"):
                    recs.append(_rec("P2", "weather_preparation", s["site_id"], None,
                                     "Prepare for the forecast weather exposure: check backup power, drainage and microwave fade margin.",
                                     [f"Weather ML exposure {s['weather']['exposure']}, site vulnerability {s['vulnerability']['score']}."], "Field-Preventive",
                                     weight=s["vulnerability"]["score"]))
        order = {"P1": 0, "P2": 1, "P3": 2}
        recs.sort(key=lambda r: (order[r["priority"]], -r.pop("weight"), r["category"], r["site_id"]))
        # keep the list varied: at most half of it from one category
        cap = max(1, min(limit, 50))
        shown: list[dict[str, Any]] = []
        per_cat: dict[str, int] = {}
        for r in recs:
            if per_cat.get(r["category"], 0) < max(1, cap // 2):
                shown.append(r)
                per_cat[r["category"]] = per_cat.get(r["category"], 0) + 1
            if len(shown) == cap:
                break
        features = []
        sev = {"P1": "HIGH", "P2": "MEDIUM", "P3": "LOW"}
        all_sites = _site_rows(con)
        for r in shown:
            s = site_index.get(r["site_id"]) or all_sites[r["site_id"]]
            features.append(point(s["lat"], s["lng"], id=r["site_id"], kind="site", severity=sev[r["priority"]], label=f"{r['site_id']}: {r['category']}"))
        summary = f"{len(recs)} maintenance recommendations for {len(ids)} sites; showing {len(shown)}." + (
            f" Top: {shown[0]['site_id']} {shown[0]['category'].replace('_', ' ')} ({shown[0]['priority']})." if shown else "")
        data = {
            "summary": summary, "recommendations": shown, "total": len(recs), "truncated": len(recs) > len(shown),
            "time_window": {"start": times(start), "end": times(end)}, "geojson": collection(features),
            "approval_note": "Every draft ticket needs a human to approve it before it is created or dispatched; this tool creates nothing.",
            "limitations": LIMITATIONS,
        }
        return envelope(con, "recommend_network_maintenance", data, ev, warnings)


def _rec(priority: str, category: str, site_id: str, cell: str | None, action: str, evidence: list[str], sub_network: str,
         weight: float = 0.5) -> dict[str, Any]:
    return {
        "weight": weight,
        "priority": priority, "category": category, "site_id": site_id, "cell_name": cell, "action": action, "evidence": evidence,
        "draft_ticket": {"title": f"{action.split('(')[0].strip().rstrip('.')} - {cell or site_id}", "sub_network": sub_network,
                         "status": "DRAFT (not created)", "requires_human_approval": True},
    }
