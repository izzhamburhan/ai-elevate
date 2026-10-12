"""Subscriber analytics (Zhilabs-backed in the real system), mobile dashboard
advisory, ML next-best-action advisory and Ookla site speed tests."""

import datetime as dt
from collections import Counter
from typing import Annotated, Literal

from pydantic import Field

from netops_mcp import db
from netops_mcp.errors import NotFoundError, ValidationError
from netops_mcp.tools.common import (
    DateStr, Page, PageSize, check_msisdn, day_bounds, imsi_for, parse_date, rsrp_category, window,
)

SPEED_THRESHOLD = {"4G": 2.5, "4G_TM": 2.5, "4G_MOCN MAXIS": 2.5, "5G": 100, "5G_DNB": 100, "2G": 0.1}
RSRP_ORDER = ["Very Bad", "Bad", "Moderate", "Good", "Very Good"]
DEFAULT_IMSI = "502153000002017"
DEFAULT_MSISDN = "601110002356"


def _sub_window(start_date, end_date, default_days=1):
    s, e = window(start_date, end_date, default_days, end_offset=1)
    if s < db.ref_date() - dt.timedelta(days=31):
        raise ValidationError("Subscriber data covers the last 30 days only")
    return s, e


def _sms_cat(n):
    return "High" if n >= 1000 else "Medium" if n >= 300 else "Low"


def _drop_cat(n):
    return "Excellent" if n == 0 else "Low" if n <= 2 else "Medium" if n <= 5 else "High"


def _mos_cat(v):
    return None if v is None else "Bad" if v < 2 else "Moderate" if v < 3 else "Good"


# ---------------------------------------------------------------------------
def get_subscriber_profile(
    section: Literal["customer", "device", "network"],
    msisdn: Annotated[str | None, Field(description="MSISDN, e.g. 601110002356")] = None,
    imsi: Annotated[str | None, Field(description="15-digit IMSI, e.g. 502153000002017")] = None,
    start_date: DateStr = None,
    end_date: DateStr = None,
) -> dict:
    """Get subscriber detail by section using msisdn or imsi. customer: identity, plan, segment, line status.
    device: brand, model, type, OS, VoLTE and tethering capability. network: max download/upload speed (Mbps),
    data volume (GB), dominant connection type and usage ratio per layer (MOCN, DR, TDD, FDD, 5G NR) over the window
    (default yesterday; up to the last 30 days)."""
    sec = section.lower()
    imsi, msisdn = imsi_for(msisdn, imsi)
    crm = db.query_one("SELECT * FROM zl_crm WHERE imsi = ?", [imsi])
    if sec == "customer":
        return {"section": sec, "customer_info": crm}
    if sec == "device":
        d = db.query_one("SELECT * FROM zl_device WHERE imsi = ? ORDER BY date DESC LIMIT 1", [imsi]) or {}
        na = lambda v: "NA" if v in (None, "Unknown") else v  # noqa: E731
        return {"section": sec,
                "customer_info": {"imsi": imsi, "msisdn": msisdn, "line_status": crm["subscriber_status"]},
                "device_info": {"device_brand": na(d.get("device_brand")), "device_model": na(d.get("device_model")),
                                "device_type": na(d.get("device_type")), "device_os": na(d.get("device_os")),
                                "imei": d.get("imei")},
                "volte_tethering_info": {"volte": bool(d.get("volte")), "tethering": bool(d.get("tethering"))}}
    if sec != "network":
        raise ValidationError("'section' must be customer, device or network")
    s, e = _sub_window(start_date, end_date)
    a, b = day_bounds(s, e)
    agg = db.query_one("""SELECT max(peak_dl_mbps) AS dl, max(peak_ul_mbps) AS ul, sum(bytes_dl) AS bdl,
            sum(bytes_ul) AS bul FROM zl_session WHERE imsi = ? AND ts BETWEEN ? AND ?""", [imsi, a, b])
    by_tech = db.query("""SELECT cell_technology, rat, mnc, cell_frequency,
            sum(epoch(ts_end) - epoch(ts)) AS secs, sum(bytes_dl + bytes_ul) AS bytes
        FROM zl_session WHERE imsi = ? AND ts BETWEEN ? AND ? GROUP BY ALL""", [imsi, a, b])
    total = sum(r["bytes"] for r in by_tech) or 0
    dominant = max(by_tech, key=lambda r: r["secs"])["cell_technology"] if by_tech else None

    def ratio(pred):
        return round(sum(r["bytes"] for r in by_tech if pred(r)) / total, 5) if total else 0.0

    return {
        "section": sec, "start_date": s.isoformat(), "end_date": e.isoformat(),
        "speed_info": {"max_download_speed": agg["dl"], "max_upload_speed": agg["ul"], "unit": "Mbps"},
        "application_volume": {"total_download_volume": round((agg["bdl"] or 0) / 1e9, 5),
                               "total_upload_volume": round((agg["bul"] or 0) / 1e9, 5),
                               "total_volume": round(((agg["bdl"] or 0) + (agg["bul"] or 0)) / 1e9, 5), "unit": "GB"},
        "internet_connection_info": {"internet_connection": dominant},
        "usage_ratio_info": {
            "MOCN_usage_ratio": ratio(lambda r: r["mnc"] == 19 and r["rat"] == "EUTRAN"),
            "DR_usage_ratio": ratio(lambda r: r["mnc"] == 19 and r["rat"] in ("GERAN", "UTRAN")),
            "TDD_usage_ratio": ratio(lambda r: r["mnc"] == 153 and "TDD" in (r["cell_frequency"] or "")),
            "FDD_usage_ratio": ratio(lambda r: r["mnc"] == 153 and "FDD" in (r["cell_frequency"] or "")),
            "usage_5G_NR_ratio": ratio(lambda r: r["rat"] == "NR"),
            "usage_5G_L700_ratio": 0.0,
        },
    }


def get_subscriber_activity(
    type: Literal["signal_strength", "speedtest", "app_usage", "voice_sms"],
    imsi: Annotated[str, Field(description="15-digit IMSI, e.g. 502153000002017")],
    start_date: DateStr = None,
    end_date: DateStr = None,
    page: Page = 1,
    page_size: PageSize = 100,
) -> dict:
    """Get subscriber history by type over a date range (default last 7 days, up to 30). signal_strength: RSRP
    samples with coordinates and category, plus mode/average category and latest 5 sites. speedtest: tests with
    Mbps and Good/Bad classification. app_usage: GB per app. voice_sms: SMS, call attempts/drops and MOS by DR/VoLTE,
    with individual calls as items. Paginated; returns total."""
    t = type.lower()
    imsi, msisdn = imsi_for(imsi=imsi)
    s, e = _sub_window(start_date, end_date, 7)
    a, b = day_bounds(s, e)
    head = {"type": t, "imsi": imsi, "start_date": s.isoformat(), "end_date": e.isoformat()}
    if t == "signal_strength":
        rows = db.query("SELECT ts AS timestamp, site_id, latitude, longitude, rsrp, sinr FROM zl_geoloc "
                        "WHERE imsi = ? AND ts BETWEEN ? AND ? ORDER BY ts", [imsi, a, b])
        for r in rows:
            r["rsrp_category"] = rsrp_category(r["rsrp"])
        summary = {"mode_signal_strength": None, "average_rsrp": None, "latest_5_sites": []}
        if rows:
            counts = Counter(r["rsrp_category"] for r in rows)
            top = max(counts.values())
            mode = next(c for c in RSRP_ORDER if counts.get(c) == top)
            latest_mode = next(r["rsrp"] for r in reversed(rows) if r["rsrp_category"] == mode)
            avg = round(sum(r["rsrp"] for r in rows) / len(rows), 2)
            seen, latest = set(), []
            for r in reversed(rows):
                if r["site_id"] not in seen:
                    seen.add(r["site_id"])
                    latest.append({"site_id": r["site_id"], "rsrp": r["rsrp"], "rsrp_category": r["rsrp_category"]})
                if len(latest) == 5:
                    break
            summary = {"mode_signal_strength": {"rsrp_category": mode, "rsrp": latest_mode},
                       "average_rsrp": {"average_rsrp_value": avg, "average_rsrp_category": rsrp_category(avg)},
                       "latest_5_sites": latest}
        return {**head, "unit": "dBm", **summary, **db.paginate_list(rows, page, page_size)}
    if t == "speedtest":
        rows = db.query("""SELECT ts AS timestamp, round(dl_bps / 1048576.0, 4) AS speed_test_peak_throughput_downlink,
                round(ul_bps / 1048576.0, 4) AS speed_test_peak_throughput_uplink, cell_technology,
                host AS speed_test_host, site_id
            FROM zl_speedtest WHERE imsi = ? AND ts BETWEEN ? AND ? ORDER BY ts DESC""", [imsi, a, b])
        for r in rows:
            thr = SPEED_THRESHOLD.get(r["cell_technology"], 2.5)
            r["classification"] = "Good" if r["speed_test_peak_throughput_downlink"] >= thr else "Bad"
        return {**head, "unit": "Mbps", **db.paginate_list(rows, page, page_size)}
    if t == "app_usage":
        rows = db.query("""SELECT app_name, round(sum(bytes) / 1e9, 4) AS total_app_volume FROM zl_app_usage
            WHERE imsi = ? AND date BETWEEN ? AND ? GROUP BY app_name ORDER BY total_app_volume DESC""", [imsi, s, e])
        return {**head, "unit": "GB", **db.paginate_list(rows, page, page_size)}
    if t == "voice_sms":
        sms = db.scalar("SELECT sum(sms_mo + sms_mt) FROM zl_sms WHERE imsi = ? AND date BETWEEN ? AND ?",
                        [imsi, s, e]) or 0
        calls = db.query("""SELECT ts AS timestamp, call_type, call_id, mos, attempts, answered, drops FROM zl_volte
            WHERE msisdn = ? AND ts BETWEEN ? AND ? ORDER BY ts""", [msisdn, a, b])
        info = {}
        for ct in ("DR", "VoLTE"):
            sub = [c for c in calls if c["call_type"] == ct]
            drops = sum(c["drops"] for c in sub)
            info[f"{ct}_call_drops"] = {"category": _drop_cat(drops), "value": drops}
            info[f"{ct}_call_attempts"] = sum(c["attempts"] for c in sub)
            info[f"{ct}_answered_calls"] = sum(c["answered"] for c in sub)

        def mos(ct):
            sub = [c for c in calls if c["call_type"] == ct and c["mos"] is not None]
            if not sub:
                return {"category": None, "value": None}
            counts = Counter(_mos_cat(c["mos"]) for c in sub)
            mode = counts.most_common(1)[0][0]
            return {"category": mode, "value": next(c["mos"] for c in reversed(sub) if _mos_cat(c["mos"]) == mode)}

        return {**head, "sms_info": {"category": _sms_cat(sms), "value": sms}, "call_attempts_drops_info": info,
                "VOLTE_mos_info": mos("VoLTE"), "DR_mos_info": mos("DR"), **db.paginate_list(calls, page, page_size)}
    raise ValidationError("'type' must be signal_strength, speedtest, app_usage or voice_sms")


# ---------------------------------------------------------------------------
def _site_flags(site_ids: list[str]) -> dict[str, dict]:
    """Outage / congestion / maintenance status for a set of sites (as of the ref date)."""
    if not site_ids:
        return {}
    ph = ",".join("?" * len(site_ids))
    now = dt.datetime.combine(db.ref_date(), dt.time(12))
    ntt = {r["site_id"]: r for r in db.query(f"""
        SELECT split_part(network_element_ne_id, ',', 1) AS site_id, fault_category, ntt_no FROM ntt_granite
        WHERE id IN (SELECT max(id) FROM ntt_granite GROUP BY ntt_no) AND status = 'Open'
          AND resp_unit = 'LTE 4G' AND fault_category IN ('Total Outage', 'Partial Outage')
          AND split_part(network_element_ne_id, ',', 1) IN ({ph})""", site_ids)}
    ntt5 = {r["hpd_ci"]: r for r in db.query(f"""
        SELECT hpd_ci, tm_incident_id FROM ntt_5g_ntt5g
        WHERE id IN (SELECT max(id) FROM ntt_5g_ntt5g GROUP BY tm_incident_id)
          AND incident_status IN ('Assigned', 'Pending', 'In Progress') AND hpd_ci IN ({ph})""", site_ids)}
    cong = {r["sid"]: r for r in db.query(f"""
        SELECT "Site ID" AS sid, max(Technology) AS technology FROM Webe_Congested_Cell
        WHERE Week = (SELECT max(Week) FROM Webe_Congested_Cell WHERE report_year = (SELECT max(report_year) FROM Webe_Congested_Cell))
          AND "Site ID" IN ({ph}) GROUP BY 1""", site_ids)}
    pm = {r["Hostname"]: r for r in db.query(f"""
        SELECT Hostname, Reason, "Sub Network" AS sub_network FROM Webe_Plan_Maintenance
        WHERE Status = 'WIMPLEMENTER' AND "NCA/CA" = 'CA' AND ? BETWEEN "Planned Start" AND "Planned End"
          AND Hostname IN ({ph})""", [now] + site_ids)}
    out = {}
    for sid in site_ids:
        n = ntt.get(sid) or ntt5.get(sid)
        out[sid] = {
            "ntt_status": "Active" if n else "No",
            "faulty_category": (ntt.get(sid) or {}).get("fault_category"),
            "ntt_number": (ntt.get(sid) or {}).get("ntt_no") or (ntt5.get(sid) or {}).get("tm_incident_id"),
            "congestion_status": "Yes" if sid in cong else "No",
            "maintenance_status": "Yes" if sid in pm else "No",
            "maintenance_reason": (pm.get(sid) or {}).get("Reason"),
        }
    return out


SITE_COORDS = """(SELECT Site_ID, Latitude, Longitude FROM Site4G UNION ALL SELECT Site_ID, Latitude, Longitude FROM Site5G
    UNION ALL SELECT Site_ID, Latitude, Longitude FROM SiteMOCN UNION ALL SELECT Site_ID, Latitude, Longitude FROM Site2G)"""


def get_visited_sites(
    imsi: Annotated[str, Field(description="15-digit IMSI, e.g. 502153000002017")],
    start_date: DateStr = None,
    end_date: DateStr = None,
    page: Page = 1,
    page_size: PageSize = 200,
) -> dict:
    """Get the sites a subscriber visited, one row per visit in time order: visit_start/visit_end, duration_min,
    site_id, bearer_cell, cluster, signal_type, cell_technology, site latitude/longitude, and site status flags
    (ntt_status, congestion_status, maintenance_status). Default window is the last 7 days (max 30). Also returns
    top_visited_sites ranked by online time. Paginated; returns total."""
    imsi, _ = imsi_for(imsi=imsi)
    s, e = _sub_window(start_date, end_date, 7)
    a, b = day_bounds(s, e)
    rows = db.query(f"""
        SELECT z.ts AS visit_start, z.ts_end AS visit_end,
               round((epoch(z.ts_end) - epoch(z.ts)) / 60.0, 1) AS duration_min, z.site_id, z.bearer_cell, z.cluster,
               z.signal_type, z.cell_technology, c.Latitude AS latitude, c.Longitude AS longitude
        FROM zl_session z LEFT JOIN {SITE_COORDS} c ON c.Site_ID = z.site_id
        WHERE z.imsi = ? AND z.ts BETWEEN ? AND ? ORDER BY z.ts""", [imsi, a, b])
    flags = _site_flags(sorted({r["site_id"] for r in rows}))
    for r in rows:
        r.update(flags.get(r["site_id"], {}))
    totals = {}
    for r in rows:
        t = totals.setdefault(r["site_id"], {"site_id": r["site_id"], "online_minutes": 0.0, "visits": 0,
                                             "latitude": r["latitude"], "longitude": r["longitude"],
                                             "cell_technology": r["cell_technology"]})
        t["online_minutes"] = round(t["online_minutes"] + r["duration_min"], 1)
        t["visits"] += 1
    top = sorted(totals.values(), key=lambda t: -t["online_minutes"])[:5]
    return {"imsi": imsi, "start_date": s.isoformat(), "end_date": e.isoformat(), "distinct_sites": len(totals),
            "top_visited_sites": top, **db.paginate_list(rows, page, page_size)}


# ---------------------------------------------------------------------------
def _speed_cat(v, low, mid):
    return None if v is None else "Low" if v <= low else "Medium" if v <= mid else "High"


def get_mobile_dashboard_advisory(imsi: Annotated[str, Field(description="15-digit IMSI")]) -> dict:
    """Get the mobile dashboard advisory for a subscriber: suspected root cause, prompt, action and summary, chosen
    from the advisory matrix using the last 6 days of line status, connection type, RSRP category, site outage/
    congestion/maintenance on visited sites, speed, volume, MOS, call drops and SMS. Returns the computed inputs and
    the match score."""
    imsi, msisdn = imsi_for(imsi=imsi)
    ref = db.ref_date()
    s, e = ref - dt.timedelta(days=6), ref - dt.timedelta(days=1)
    crm = db.query_one("SELECT subscriber_status FROM zl_crm WHERE imsi = ?", [imsi])
    net = get_subscriber_profile("network", imsi=imsi, start_date=s.isoformat(), end_date=e.isoformat())
    sig = get_subscriber_activity("signal_strength", imsi, s.isoformat(), e.isoformat(), 1, 1)
    voice = get_subscriber_activity("voice_sms", imsi, s.isoformat(), e.isoformat(), 1, 1)
    visits = get_visited_sites(imsi, s.isoformat(), e.isoformat(), 1, 1000)["items"]
    vol_mb = (net["application_volume"]["total_volume"] or 0) * 1000
    inputs = {
        "line_status": {"ACTIVE": "Active", "DEACTIVATE": "Deactivate", "BARRED": "Barred"}.get(
            crm["subscriber_status"], "Unknown"),
        "internet_connection_matrix": net["internet_connection_info"]["internet_connection"],
        "user_coverage_signal_strength_rsrp": (sig["mode_signal_strength"] or {}).get("rsrp_category"),
        "ntt_site_outage_status": any(v.get("ntt_status") == "Active" for v in visits),
        "site_congestion_status": any(v.get("congestion_status") == "Yes" for v in visits),
        "plan_maintenance": any(v.get("maintenance_status") == "Yes" for v in visits),
        "max_download_speed_megabits": _speed_cat(net["speed_info"]["max_download_speed"], 11.55, 18.05),
        "max_upload_speed_megabits": _speed_cat(net["speed_info"]["max_upload_speed"], 0.97, 3.82),
        "total_volume_megabytes": _speed_cat(vol_mb, 1778.5, 4776),
        "mos_score_dr": voice["DR_mos_info"]["category"],
        "mos_score_volte": voice["VOLTE_mos_info"]["category"],
        "call_drop_dr": voice["call_attempts_drops_info"]["DR_call_drops"]["category"],
        "call_drop_volte": voice["call_attempts_drops_info"]["VoLTE_call_drops"]["category"],
        "total_sms": voice["sms_info"]["category"],
    }
    if inputs["line_status"] == "Barred":
        inputs["internet_connection_matrix"] = inputs["internet_connection_matrix"] or "4G_TM"
    # Real system requires an exact matrix match (rarely hit with live data); here we take the closest row,
    # weighting the outage/congestion/maintenance and line-status columns more heavily.
    weights = {"line_status": 6, "ntt_site_outage_status": 5, "site_congestion_status": 4, "plan_maintenance": 4,
               "user_coverage_signal_strength_rsrp": 3, "internet_connection_matrix": 2, "mos_score_volte": 2,
               "call_drop_volte": 2}
    best, best_score = None, -1
    for row in db.query("SELECT * FROM nba_matrix ORDER BY class_num"):
        score = sum(weights.get(k, 1) for k, v in inputs.items()
                    if (row.get(k) == v) or (k == "user_coverage_signal_strength_rsrp" and v and row.get(k) and
                                             (row[k] in ("Very Bad", "Bad")) == (v in ("Very Bad", "Bad"))))
        if score > best_score:
            best, best_score = row, score
    if not best:
        raise NotFoundError("Nba Matrix not exist")
    adv = db.query_one("SELECT suspected_root_cause, prompt, action, summary FROM nba_advisory WHERE class_num = ?",
                       [best["class_num"]])
    if not adv:
        raise NotFoundError("Nba Advisory not exist")
    max_score = sum(weights.get(k, 1) for k in inputs)
    return {"imsi": imsi, "msisdn": msisdn, "window": {"start_date": s.isoformat(), "end_date": e.isoformat()},
            "advisory": adv, "class_num": best["class_num"], "match_score": round(best_score / max_score, 2),
            "inputs": inputs}


def get_dashboard_legends() -> dict:
    """Get the legends used by the mobile dashboard: speed-test Good thresholds per technology (Mbps) and RSRP
    category bands (dBm)."""
    return {
        "speedtest_legend": {"4G": 2.5, "4G_MOCN MAXIS": 2.5, "5G": 100, "4G_TM": 2.5, "5G_DNB": 100},
        "speedtest_unit": "Mbps",
        "rsrp_legend": {"very_good": {"min": -85, "max": None}, "good": {"min": -95, "max": -85},
                        "moderate": {"min": -105, "max": -95}, "bad": {"min": -115, "max": -105},
                        "very_bad": {"min": None, "max": -115}},
        "rsrp_unit": "dBm",
    }


# ---------------------------------------------------------------------------
ML_ORDER = [
    ("line_status", "line_status"), ("quota_usage", "quota_usage"), ("ntt_status", "ntt_status"),
    ("connection_type", "connection_type"), ("congestion_status", "congestion_status"),
    ("plan_maintenance_status", "plan_maintenance_status"), ("final_RSRP_status", "final_rsrp_status"),
    ("final_SINR_status", "final_sinr_status"), ("usage_volume", "usage_volume"),
    ("volte_total_short_calls_status", "volte_total_short_calls_range"),
    ("volte_total_call_attempt_status", "volte_total_call_attempt_range"),
    ("overall_KPI_status", "overall_kpistatus_for_all_provider"), ("latency_status", "latency_range"),
]
Feat = Annotated[str, Field(description="Lower-case category, e.g. yes/no, good/bad, low/medium/high")]


def get_nba_advisory(
    msisdn: str,
    line_status: Annotated[str, Field(description="active | barred | passive | suspended | terminated")] = "active",
    quota_usage: Annotated[str, Field(description="yes | no")] = "yes",
    ntt_status: Annotated[str, Field(description="active | no")] = "no",
    connection_type: Annotated[str, Field(description="tm4g | 4gmocn | 5g | 2g")] = "tm4g",
    congestion_status: Annotated[str, Field(description="yes | no")] = "no",
    plan_maintenance_status: Annotated[str, Field(description="yes | no")] = "no",
    final_RSRP_status: Annotated[str, Field(description="good | moderate | bad | not_related")] = "good",
    final_SINR_status: Annotated[str, Field(description="good | moderate | bad | not_related")] = "good",
    usage_volume: Annotated[str, Field(description="low | medium | high")] = "medium",
    volte_total_short_calls_status: Annotated[str, Field(description="low | medium | high")] = "low",
    volte_total_call_attempt_status: Annotated[str, Field(description="low | medium | high")] = "low",
    overall_KPI_status: Annotated[str, Field(description="good | bad")] = "good",
    latency_status: Annotated[str, Field(description="good | bad | not_related")] = "not_related",
) -> dict:
    """Get the ML next-best-action advisory for a subscriber from 13 categorical network/subscription features
    (k-nearest-neighbour vote, k=5, Hamming distance over the training set). Returns the predicted class, nearest
    distance and advisory rows (summary, prompt, customer action, THD action). Each call is logged to nba_ml_output."""
    msisdn = check_msisdn(msisdn)
    args = locals()
    f = {name: str(args[name]).strip().lower() for name, _ in ML_ORDER}
    if f["line_status"] in ("barred", "passive", "suspended"):
        f = {k: (v if k == "line_status" else "na") for k, v in f.items()}
    elif f["quota_usage"] == "no":
        f = {k: (v if k == "quota_usage" else "na") for k, v in f.items()}
    elif f["ntt_status"] == "active":
        f = {k: (v if k == "ntt_status" else "na") for k, v in f.items()}
    vec = [f[name] for name, _ in ML_ORDER]
    cols = ", ".join(col for _, col in ML_ORDER)
    training = db.raw(f"SELECT {cols}, cluster FROM ml_model_training ORDER BY id")
    scored = sorted(((sum(a != b for a, b in zip(vec, row[:-1])), row[-1]) for row in training), key=lambda t: t[0])
    k = scored[:5]
    votes = Counter(label for _, label in k)
    top = max(votes.values())
    prediction = next(label for _, label in k if votes[label] == top)
    distance = k[0][0]
    advisories = db.query("SELECT id, class_name, summary, prompt, action_cx, action_thd FROM ml_nba_advisory "
                          "WHERE class_name = ? ORDER BY id", [prediction])
    now = dt.datetime.now().replace(microsecond=0)
    for a in advisories:
        db.execute("INSERT INTO nba_ml_output VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                   [db.next_id("nba_ml_output"), a["id"], a["class_name"], a["summary"], a["prompt"], a["action_cx"],
                    a["action_thd"], distance, msisdn, now])
    return {"msisdn": msisdn, "predicted_class": prediction, "distance": distance, "features": f,
            "advisories": advisories}


# ---------------------------------------------------------------------------
def get_site_speedtest(
    site_id: Annotated[str, Field(description="4G or 5G site ID, e.g. CB0048 or DAKUL0012")],
    date: DateStr = None,
) -> dict:
    """Get Ookla speed-test results for a site (matched by eNodeB) on a date: download/upload Mbps, latency, RSRP,
    operator, technology (4G/5G) and Good/Bad download status (>2.5 Mbps 4G, >100 Mbps 5G), plus a daily summary.
    Omit `date` for the latest available date; the response includes `date` and `available_dates`."""
    site = db.query_one("""SELECT Site_ID, eNodeB_ID::BIGINT AS enb, '5G' AS tech FROM Site5G WHERE upper(Site_ID) = upper(?)
        UNION ALL SELECT Site_ID, eNodeB_ID, '4G' FROM Site4G WHERE upper(Site_ID) = upper(?)""", [site_id, site_id])
    if not site:
        raise NotFoundError(f"Site '{site_id}' not found in Site4G or Site5G")
    dates = [r["date_id"] for r in db.query(
        "SELECT DISTINCT date_id FROM ookla_mnpd_daily WHERE id_enodeb = ? ORDER BY date_id DESC", [site["enb"]])]
    available = [dt.datetime.strptime(str(d), "%Y%m%d").date().isoformat() for d in dates]
    if not available:
        return {"site_id": site["Site_ID"], "date": None, "available_dates": [], "summary": None, "data": []}
    chosen = parse_date(date, "date")
    chosen = chosen.isoformat() if chosen else available[0]
    rows = db.query("""SELECT id, date_id, sim_operator_raw, latitude, longitude,
            round(qos_download_throughput, 2) AS download_mbps, round(qos_upload_throughput, 2) AS upload_mbps,
            round(qos_latency, 1) AS latency_ms, round(rsrp_nerve, 1) AS rsrp, lte_bands, connection_type_start
        FROM ookla_mnpd_daily WHERE id_enodeb = ? AND date_id = ? ORDER BY id DESC""",
                    [site["enb"], int(chosen.replace("-", ""))])
    for r in rows:
        raw = (r["sim_operator_raw"] or "").lower()
        r["host"] = "ookla"
        r["technology"] = "5G" if "5g" in raw else "4G" if raw in ("unifi", "webe") else None
        r["status_download"] = "Good" if r["download_mbps"] > SPEED_THRESHOLD.get(r["technology"] or "4G", 2.5) else "Bad"
    summary = None
    if rows:
        summary = {"tests": len(rows),
                   "avg_download_mbps": round(sum(r["download_mbps"] for r in rows) / len(rows), 2),
                   "avg_upload_mbps": round(sum(r["upload_mbps"] for r in rows) / len(rows), 2),
                   "good_pct": round(sum(r["status_download"] == "Good" for r in rows) / len(rows) * 100, 1)}
    return {"site_id": site["Site_ID"], "date": chosen, "available_dates": available, "summary": summary, "data": rows}


TOOLS = [
    get_subscriber_profile, get_subscriber_activity, get_visited_sites, get_mobile_dashboard_advisory,
    get_dashboard_legends, get_nba_advisory, get_site_speedtest,
]
