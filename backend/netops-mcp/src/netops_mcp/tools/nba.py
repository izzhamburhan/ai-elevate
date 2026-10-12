"""NBA collector tools: per-subscriber, per-day views computed from the
upstream session / profile / KPI tables (nba-collector)."""

import datetime as dt
import re
from typing import Annotated, Literal

from pydantic import Field

from netops_mcp import db, geo
from netops_mcp.errors import NotFoundError, ValidationError
from netops_mcp.tools.common import DateStr, Page, PageSize, check_msisdn, parse_date

Msisdn = Annotated[str, Field(description="MSISDN, e.g. 601110002356")]
QueryDate = Annotated[str | None, Field(description="YYYY-MM-DD; omit for the latest available date")]

TECH = {"LTE": "TM4G", "4G_M": "4GMOCN", "4G_M_DR": "4GMOCN", "DNB": "5G", "DR_2G": "2G", "DR_3G": "2G"}
MORPH = {"U": "Urban", "S": "Sub Urban", "R": "Rural", "DU": "Dense Urban",
         "Urban": "Urban", "Sub Urban": "Sub Urban", "Rural": "Rural", "Dense Urban": "Dense Urban"}
THRESHOLDS = {
    "TM4G": {"cell_availability": (">", 99.5), "active_user": (">", 10), "dl_throughput": (">", 7.7),
             "prb": (">", 8.9), "call_setup_success_rate": (">", 98), "volte_setup_success_rate": (">", 98),
             "volte_drop_rate": ("<", 1)},
    "Maxis 4GMOCN": {"data_setup": (">", 98), "voice_setup": (">", 98), "voice_call_csfb": (">", 95),
                     "data_drop": ("<", 1), "voice_drop": ("<", 1), "intra_handover": (">", 95),
                     "inter_handover": (">", 95)},
    "DNB 5G": {"cell_availability_lte": (">", 99.5), "cell_availability_5g": (">", 99.5),
               "volte_redirection_rate_lte": (">", 95), "data_session_rate_5g": (">", 99.5),
               "erab_drop_rate_lte": ("<", 1), "data_session_abnormal_5g": ("<", 1),
               "intra_freq_ho_rate_lte": (">", 95), "inter_freq_ho_rate_lte": (">", 95),
               "inter_freq_offload_ho_rate_lte": (">", 95), "intra_sgnb_pscell_change_rate_5g": (">", 95),
               "inter_sgnb_pscell_change_rate_5g": (">", 95), "latency": ("<", 15)},
}
PROVIDER = {"TM4G": "TM4G", "4GMOCN": "Maxis 4GMOCN", "5G": "DNB 5G"}


# ---------------------------------------------------------------------------
# Core lookups
# ---------------------------------------------------------------------------
def _dates(msisdn: str) -> list[str]:
    return [r["d"] for r in db.query("""SELECT DISTINCT start_time AS d FROM (
            SELECT start_time FROM ime_lte_daily WHERE msisdn = ?
            UNION ALL SELECT start_time FROM IMEDRDailyUsage WHERE msisdn = ?) ORDER BY d DESC""", [msisdn, msisdn])]


def _resolve(msisdn: str, query_date: str | None) -> tuple[str, dt.date, list[str]]:
    msisdn = check_msisdn(msisdn)
    available = _dates(msisdn)
    if not available:
        raise NotFoundError(f"No NBA data for MSISDN {msisdn}")
    d = parse_date(query_date, "query_date") or dt.date.fromisoformat(available[0])
    if d.isoformat() not in available:
        raise NotFoundError(f"No NBA data for {msisdn} on {d}. Available: {available[-1]} to {available[0]}")
    return msisdn, d, available


def _sessions(msisdn: str, d: dt.date) -> list[dict]:
    """One row per (site, cell) for the day with site attributes."""
    rows = db.query("""
        SELECT l.enodeb_id AS ENODEB_ID, l.msisdn AS MSISDN, l.duration AS secs, l.start_time AS START_TIME,
               l.imsi AS IMSI, l.imei, l.eci AS ECI, l.cell AS CELL_ID, l.data_mode AS DATA_MODE,
               l.total_usage_bytes AS TOTAL_USAGE_BYTES,
               COALESCE(s4.Site_ID, m.SITE_ID, s5.Site_ID) AS SITE_ID,
               COALESCE(s4.Latitude, m.Latitude, s5.Latitude) AS Latitude,
               COALESCE(s4.Longitude, m.Longitude, s5.Longitude) AS Longitude,
               s4.RFP_Morphology, COALESCE(s4.Cluster_ID, s5.Cluster_ID, sm.Cluster) AS Cluster_ID,
               COALESCE(s4.Cluster_Name, s5.District, sm.Cluster) AS Cluster_Name,
               COALESCE(c4.Cell_Name, cm.Cell_Name, s5.Site_ID || '_N78_' || l.cell) AS Cell_Name
        FROM ime_lte_daily l
        LEFT JOIN Site4G s4 ON l.data_mode = 'LTE' AND s4.eNodeB_ID = TRY_CAST(l.enodeb_id AS BIGINT)
        LEFT JOIN Cell4G c4 ON l.data_mode = 'LTE' AND c4.ECI = TRY_CAST(l.eci AS DOUBLE)
        LEFT JOIN Site4GMOCN m ON l.data_mode LIKE '4G_M%' AND m.ENODEB_ID = TRY_CAST(l.enodeb_id AS BIGINT)
        LEFT JOIN SiteMOCN sm ON sm.Site_ID = m.SITE_ID
        LEFT JOIN CellMOCN cm ON l.data_mode LIKE '4G_M%' AND cm.ECI = TRY_CAST(l.eci AS INTEGER)
        LEFT JOIN Site5G s5 ON l.data_mode = 'DNB' AND s5.eNodeB_ID = TRY_CAST(l.enodeb_id AS DOUBLE)
        WHERE l.msisdn = ? AND l.start_time = ?
        UNION ALL
        SELECT NULL, d.msisdn, d.duration, d.start_time, d.imsi, NULL, NULL, d.cell, d.data_mode, d.total_usage_bytes,
               d.site_id, s.Latitude, s.Longitude, NULL, 'NA', 'NA', d.cell
        FROM IMEDRDailyUsage d LEFT JOIN Site2G s ON s.Site_ID = d.site_id
        WHERE d.msisdn = ? AND d.start_time = ?""", [msisdn, d.isoformat(), msisdn, d.isoformat()])
    for r in rows:
        r["Technology"] = TECH.get(r["DATA_MODE"], "NA")
    return rows


def _visited(rows: list[dict]) -> list[dict]:
    """Aggregate sessions per site, ranked by online time."""
    sites: dict = {}
    for r in rows:
        s = sites.get(r["SITE_ID"])
        if not s:
            s = sites[r["SITE_ID"]] = {**r, "secs": 0, "TOTAL_USAGE_BYTES": 0, "_best": -1}
        s["secs"] += r["secs"]
        s["TOTAL_USAGE_BYTES"] += r["TOTAL_USAGE_BYTES"]
        if r["secs"] > s["_best"]:
            s.update({k: r[k] for k in ("ENODEB_ID", "ECI", "CELL_ID", "Cell_Name", "DATA_MODE", "Technology")})
            s["_best"] = r["secs"]
    out = []
    for s in sorted(sites.values(), key=lambda s: -s["secs"]):
        b = s["TOTAL_USAGE_BYTES"]
        s.pop("_best")
        s.pop("imei", None)
        s["DURATION"] = round(s.pop("secs") / 60, 2)
        s.update(TOTAL_USAGE_KB=round(b / 1024, 2), TOTAL_USAGE_MB=round(b / 1024 ** 2, 2),
                 TOTAL_USAGE_GB=round(b / 1024 ** 3, 6), RFP_Morphology=MORPH.get(s["RFP_Morphology"], s["RFP_Morphology"]))
        out.append(s)
    return out


def _vol_category(gb: float) -> str:
    return "Low" if gb <= 0.065 else "Medium" if gb <= 1.418 else "High"


def _usage(rows: list[dict]) -> dict:
    total = sum(r["TOTAL_USAGE_BYTES"] for r in rows)
    by: dict = {}
    dur: dict = {}
    for r in rows:
        by[r["Technology"]] = by.get(r["Technology"], 0) + r["TOTAL_USAGE_BYTES"]
        dur[r["Technology"]] = dur.get(r["Technology"], 0) + r["secs"]
    order = ["TM4G", "2G", "4GMOCN", "5G"]
    return {
        "connection_type": max(dur, key=dur.get) if dur else "NA",
        "total_volume_bytes": total, "total_volume_kb": round(total / 1024, 2),
        "total_volume_mb": round(total / 1024 ** 2, 2), "total_volume_gb": round(total / 1024 ** 3, 2),
        "total_volume_category": _vol_category(total / 1024 ** 3),
        "usage_by_generation": [{"data_mode": k, "volume_byte": by.get(k, 0),
                                 "ratio": round(by.get(k, 0) / total, 4) if total else 0.0} for k in order],
    }


def _cat(value, op, limit):
    if value is None:
        return "unknown"
    return "good" if (value > limit if op == ">" else value < limit) else "bad"


def _rf(enb, d: dt.date) -> dict:
    """BIN-based RF quality for a TM 4G eNodeB on a day (majority vote per grid)."""
    rows = db.query("SELECT Grid_ID, avg_rsrp, avg_rsrq, sinr, cqi FROM BinKPI WHERE enodeb_id = ? AND DateID = ?",
                    [int(enb), int(d.strftime("%Y%m%d"))]) if enb else []
    if not rows:
        return {"overall_rf_quality": "NA", "rsrp": "NA", "rsrp_value": None, "rsrq": "NA", "rsrq_value": None,
                "sinr": "NA", "sinr_value": None, "cqi": "NA", "cqi_value": None}
    rules = {"rsrp": ("avg_rsrp", -95, -110), "rsrq": ("avg_rsrq", -10, -20), "sinr": ("sinr", 5, 3), "cqi": ("cqi", 10, 6)}
    out = {}
    for k, (col, good, mod) in rules.items():
        vals = [r[col] for r in rows if r[col] is not None]
        avg = round(sum(vals) / len(vals), 2)
        ok = sum(1 for v in vals if v >= mod)
        out[k] = "Good" if avg >= good and ok > len(vals) - ok else "Moderate" if ok > len(vals) - ok else "Bad"
        out[f"{k}_value"] = avg
    out["overall_rf_quality"] = "Bad" if "Bad" in (out["rsrp"], out["rsrq"], out["sinr"], out["cqi"]) else "Good"
    return out


def _site_status(site_id: str, technology: str, d: dt.date) -> dict:
    end = dt.datetime.combine(d, dt.time(23, 59, 59))
    out = {"ntt4g": None, "ntt5g": None, "congestion": None, "plan_maintenance": None}
    if technology == "TM4G":
        n = db.query_one("""SELECT ntt_no, fault_category, ettr FROM ntt_granite
            WHERE id IN (SELECT max(id) FROM ntt_granite GROUP BY ntt_no) AND resp_unit = 'LTE 4G'
              AND fault_category IN ('Total Outage', 'Partial Outage') AND network_element_ne_id ILIKE ?
              AND created_date <= ? AND (status = 'Open' OR ettr >= ?)
            ORDER BY created_date DESC LIMIT 1""", [f"%{site_id}%", end, dt.datetime.combine(d, dt.time())])
        out["ntt4g"] = {"ntt4g_no": n["ntt_no"] if n else None, "ntt4g_fault_category": n["fault_category"] if n else None,
                        "ntt4g_ettr": n["ettr"] if n else None, "ntt4g_site_status": "Active" if n else "No"}
        y, w, _ = d.isocalendar()
        c = db.query_one("""SELECT Remark FROM Webe_Congested_Cell WHERE "Site ID" = ? AND network = '4G'
            AND (report_year * 100 + Week) <= ? ORDER BY report_year DESC, Week DESC LIMIT 1""", [site_id, y * 100 + w])
        out["congestion"] = {"congestion_remark": c["Remark"] if c else None,
                             "congestion_site_status": "Yes" if c else "No"}
        p = db.query_one("""SELECT Reason, "Sub Network" AS sub FROM Webe_Plan_Maintenance WHERE Hostname = ?
            AND "NCA/CA" = 'CA' AND Status IN ('WIMPLEMENTER', 'CLOSE')
            AND ? BETWEEN "Planned Start"::DATE AND "Planned End"::DATE LIMIT 1""", [site_id, d])
        out["plan_maintenance"] = {"plan_maintenance_reason": p["Reason"] if p else None,
                                   "plan_maintenance_sub_network": p["sub"] if p else None,
                                   "plan_maintenance_site_status": "Yes" if p else "No"}
    elif technology == "5G":
        n = db.query_one("""SELECT tm_incident_id, incident_status, hpd_ci FROM ntt_5g_ntt5g
            WHERE id IN (SELECT max(id) FROM ntt_5g_ntt5g GROUP BY tm_incident_id) AND hpd_ci = ?
              AND event_start_time <= ? AND (incident_status IN ('Assigned', 'Pending', 'In Progress')
                                            OR event_end_time >= ?)
            ORDER BY event_start_time DESC LIMIT 1""", [site_id, end, dt.datetime.combine(d, dt.time())])
        out["ntt5g"] = {"ntt5g_tm_incident_id": n["tm_incident_id"] if n else None,
                        "ntt5g_incident_status": n["incident_status"] if n else None,
                        "ntt5g_hpd_ci": n["hpd_ci"] if n else None, "ntt5g_site_status": "Active" if n else "No"}
    return out


def _kpi(site_id: str, technology: str, d: dt.date) -> dict:
    provider = PROVIDER.get(technology)
    if not provider:
        return {"network_kpi": "NA", "provider": None, "reason": f"No KPI source for technology {technology}"}
    row = db.query_one("SELECT * FROM network_kpi WHERE site_id = ? AND kpi_date = ? AND provider = ?",
                       [site_id, d, provider])
    if not row:
        return {"network_kpi": "NA", "provider": provider, "reason": "No KPI data for site on date"}
    th = THRESHOLDS[provider]
    values = {k: round(row[k], 2) if row[k] is not None else None for k in th}
    status = {k: _cat(values[k], *th[k]) for k in th}
    twamp_val = twamp_cat = "not_related"
    if provider == "DNB 5G":
        twamp_val, twamp_cat = values.pop("latency"), status.pop("latency")
    item_status = "bad" if "bad" in status.values() else "good"
    return {"network_kpi": item_status, "provider": provider,
            "categorized_items": [{"site_id": site_id, "data_mode": technology, "date": d.isoformat(),
                                   "metrics_status": status, "metrics_value": values,
                                   "metrics_threshold": {k: f"{op} {lim}" for k, (op, lim) in th.items() if k in values},
                                   "status": item_status}],
            "TWAMP_val": twamp_val, "TWAMP_cat": twamp_cat}


def _head(msisdn, d, available):
    return {"msisdn": msisdn, "query_date": d.isoformat(), "available_dates": available}


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------
DEVICE_RULES = [(("iphone", "galaxy", "redmi", "oppo", "vivo", "pixel", "reno", "nova", "honor", "realme"), "Smartphone"),
                (("ipad", "tab"), "Tablet"), (("watch",), "Smartwatch / Wearable"), (("nokia", "3310"), "Feature Phone")]


def get_nba_subscriber_profile(
    section: Literal["customer_profile", "morphology", "device", "usage_ratio", "subs_related", "voice_call"],
    msisdn: Msisdn,
    query_date: QueryDate = None,
) -> dict:
    """Get NBA subscriber data for one day by section: customer_profile (name, plan, line/account status, prepaid
    validity, active CTTs, mobility), morphology (top site and its RFP morphology), device (phone type/model),
    usage_ratio (connection type, volume, usage per TM4G/2G/4GMOCN/5G), subs_related (quota passes and remaining
    data/SMS/voice) or voice_call (VoLTE short calls, duration, attempts with Low/Medium/High status). Omit
    `query_date` for the latest; the response includes `query_date` and `available_dates`."""
    sec = section.lower()
    msisdn, d, available = _resolve(msisdn, query_date)
    head = _head(msisdn, d, available)
    rows = _sessions(msisdn, d)
    sites = _visited(rows)
    if sec == "customer_profile":
        p = db.query_one("SELECT * FROM subs_profile_daily WHERE msisdn = ?", [msisdn]) or {}
        passes = db.query("SELECT * FROM pass_quota_daily WHERE msisdn = ? AND eff_date <= ? AND exp_date >= ?",
                          [msisdn, d.isoformat(), d.isoformat()])
        if p.get("pay_type_description") == "PREPAID":
            validity = "Yes" if any(x["remaining_bal"] > 0 for x in passes) else "Expired"
        else:
            validity = "NA"
        cases = db.query("""SELECT case_id::BIGINT AS case_id, case_status AS status, case_sub_area AS issue,
                case_category AS category, case_created_on AS created_on, case_modified_on AS last_updated,
                severity, priority, case_channel AS channel, sla_time || ' ' || sla_unit AS sla
            FROM case_view_daily WHERE msisdn = ? AND case_created_on BETWEEN ? AND ?
            ORDER BY case_created_on DESC""",
                         [msisdn, dt.datetime.combine(d - dt.timedelta(days=30), dt.time()),
                          dt.datetime.combine(d, dt.time(23, 59, 59))])
        mobile = [s["SITE_ID"] for s in sites if s["DURATION"] > 5]
        imei = next((r["imei"] for r in rows if r.get("imei")), None)
        return {**head, "section": sec, "customer_name": p.get("customer_name"), "plan_subscribe": p.get("offer_name"),
                "address": p.get("address"), "mobile_type": p.get("pay_type_description"),
                "prepaid_validity": validity, "line_status": p.get("line_status"), "imsi": p.get("imsi"),
                "imei": imei or "NA", "account_status": p.get("account_status"),
                "active_ctt": "Yes" if any(c["status"] not in ("Closed", "Cancelled", "Resolved") for c in cases) else "No",
                "ctt_count": len(cases), "ctt_info": cases,
                "mobility": "Yes" if len(mobile) >= 5 else "No", "mobility_site_count": len(mobile),
                "mobility_sites": mobile}
    if sec == "morphology":
        top = sites[0] if sites else None
        return {**head, "section": sec, "site_id": top["SITE_ID"] if top else None,
                "online_time": top["DURATION"] if top else None,
                "rfp_morphology": (top["RFP_Morphology"] or "Unknown") if top else "Unknown"}
    if sec == "device":
        c = db.query_one("""SELECT case_id, phone_type, phone_model, created_time FROM case_thd_daily
            WHERE replace(service_number, ',', '') = ? ORDER BY created_time DESC LIMIT 1""", [msisdn])
        if not c:
            return {**head, "section": sec, "case_id": None, "device_type": "NA", "phone_type": "NA", "phone_model": "NA"}
        model = (c["phone_model"] or "").lower()
        dtype = next((t for keys, t in DEVICE_RULES if any(k in model for k in keys)), c["phone_model"])
        return {**head, "section": sec, "case_id": c["case_id"], "case_created_on": c["created_time"],
                "device_type": dtype, "phone_type": c["phone_type"], "phone_model": c["phone_model"]}
    if sec == "usage_ratio":
        return {**head, "section": sec, **_usage(rows)}
    if sec == "subs_related":
        passes = db.query("""SELECT * FROM pass_quota_daily WHERE msisdn = ? AND eff_date <= ? AND exp_date >= ?
                             ORDER BY pass_name""", [msisdn, d.isoformat(), d.isoformat()])
        totals = {"Data": [0.0, 0.0], "SMS": [0.0, 0.0], "Voice": [0.0, 0.0]}
        info = []
        for x in passes:
            name = x["pass_acct_item_type_name"].lower()
            kind = "SMS" if re.search(r"sms|text", name) else "Voice" if re.search(r"voice|call|minute|talk|svp", name) else "Data"
            totals[kind][0] += x["gross_bal"]
            totals[kind][1] += x["remaining_bal"]
            fmt = _fmt_data if kind == "Data" else _fmt_voice if kind == "Voice" else (lambda v: f"{int(v)} sms")
            info.append({"Name": x["pass_name"], "Type": kind, "Current_Subscription": x["pass_acct_item_type_name"],
                         "Default_Quota": fmt(x["gross_bal"]), "Quota_Used": fmt(x["consume_bal"]),
                         "Remaining_Quota": fmt(x["remaining_bal"]), "Effective_Date": x["eff_date"],
                         "Expiry_Date": x["exp_date"]})
        use = _usage(rows)
        return {**head, "section": sec,
                "quota_usage": "Yes" if totals["Data"][1] > 0 else "No",
                "total_quota_data": _fmt_data(totals["Data"][0]), "remaining_quota_data": _fmt_data(totals["Data"][1]),
                "total_quota_sms": f"{int(totals['SMS'][0])} sms", "remaining_quota_sms": f"{int(totals['SMS'][1])} sms",
                "total_quota_voice": _fmt_voice(totals["Voice"][0]),
                "remaining_quota_voice": _fmt_voice(totals["Voice"][1]), "quota_info": info,
                "total_volume": {"bytes": use["total_volume_bytes"], "kb": use["total_volume_kb"],
                                 "mb": use["total_volume_mb"], "gb": use["total_volume_gb"],
                                 "category": use["total_volume_category"]}}
    if sec == "voice_call":
        sc = db.query_one("SELECT total_sc_count FROM short_voice_cdr_daily WHERE msisdn = ? AND call_date = ?",
                          [msisdn, d.isoformat()])
        vc = db.query_one("SELECT avg_duration_sec, total_call_count FROM voice_cdr_daily WHERE msisdn = ? "
                          "AND call_date = ?", [msisdn, d.isoformat()])
        short = int(sc["total_sc_count"]) if sc else 0
        minutes = round(vc["avg_duration_sec"] / 60, 2) if vc else 0.0
        attempts = vc["total_call_count"] if vc else 0
        return {**head, "section": sec, "volte_total_short_calls": short,
                "volte_total_short_calls_status": "Low" if short <= 1 else "Medium" if short <= 6 else "High",
                "volte_call_duration": minutes, "volte_call_duration_status": "Low" if minutes <= 5 else "High",
                "volte_total_call_attempt": attempts,
                "volte_total_call_attempt_status": "Low" if attempts <= 4 else "Medium" if attempts <= 9 else "High"}
    raise ValidationError("'section' must be customer_profile, morphology, device, usage_ratio, subs_related or voice_call")


def _fmt_data(b):
    return f"{b / 1e9:.2f} GB" if b >= 1e9 else f"{b / 1e6:.2f} MB"


def _fmt_voice(sec):
    return f"{sec / 3600:.2f} hours" if sec >= 3600 else f"{sec / 60:.0f} mins"


def get_nba_network_kpi(msisdn: Msisdn, query_date: QueryDate = None) -> dict:
    """Get network KPI of the subscriber's top site (highest online time) for a day, categorised good/bad against
    the provider thresholds (TM4G, Maxis 4GMOCN or DNB 5G), with overall network_kpi and TWAMP latency for 5G. Omit
    `query_date` for the latest; the response includes `query_date` and `available_dates`."""
    msisdn, d, available = _resolve(msisdn, query_date)
    sites = _visited(_sessions(msisdn, d))
    top = sites[0]
    return {**_head(msisdn, d, available), "site_id": top["SITE_ID"], "data_mode": top["DATA_MODE"],
            **_kpi(top["SITE_ID"], top["Technology"], d)}


def get_nba_rf_quality(msisdn: Msisdn, query_date: QueryDate = None) -> dict:
    """Get the subscriber's RF quality for a day from BIN KPIs around the top site (TM 4G only): RSRP, RSRQ, SINR
    and CQI averages with Good/Moderate/Bad categories and an overall_rf_quality; not_related for MOCN/5G/2G. Omit
    `query_date` for the latest; the response includes `query_date` and `available_dates`."""
    msisdn, d, available = _resolve(msisdn, query_date)
    top = _visited(_sessions(msisdn, d))[0]
    y, w, _ = d.isocalendar()
    head = {**_head(msisdn, d, available), "site_id": top["SITE_ID"], "enodeb_id": top["ENODEB_ID"], "week": w,
            "year": y, "latitude": top["Latitude"], "longitude": top["Longitude"], "online_time": top["DURATION"],
            "data_mode": top["DATA_MODE"]}
    if top["DATA_MODE"] != "LTE":
        return {**head, "overall_rf_quality": "not_related", "reason": "Top site is not TM 4G", "data": []}
    rf = _rf(top["ENODEB_ID"], d)
    return {**head, "overall_rf_quality": rf.pop("overall_rf_quality"), "data": [rf]}


def get_nba_nearest_site(msisdn: Msisdn, query_date: QueryDate = None) -> dict:
    """Get the nearest TM 4G, Maxis MOCN and DNB 5G sites (within 5 km) to the subscriber's top site for a day, with
    distance, coordinates, KPI status and (TM 4G) RSRP/SINR categories, plus the top site itself. Omit `query_date`
    for the latest; the response includes `query_date` and `available_dates`."""
    msisdn, d, available = _resolve(msisdn, query_date)
    top = _visited(_sessions(msisdn, d))[0]
    lat, lng = top["Latitude"], top["Longitude"]
    nearest = {}
    for key, table, tech, enb_col in (("TM_4G", "Site4G", "TM4G", "eNodeB_ID"), ("4G_MOCN", "SiteMOCN", "4GMOCN", None),
                                      ("5G_DNB", "Site5G", "5G", "eNodeB_ID")):
        min_lat, max_lat, min_lng, max_lng = geo.bbox_around(lat, lng, 5)
        row = db.query_one(f"""SELECT Site_ID AS site_id, Latitude AS latitude, Longitude AS longitude,
                {enb_col or 'NULL'} AS enb, round(haversine_km(?, ?, Latitude, Longitude), 3) AS distance_km
            FROM {table} WHERE Site_ID <> ? AND Latitude BETWEEN ? AND ? AND Longitude BETWEEN ? AND ?
              AND haversine_km(?, ?, Latitude, Longitude) <= 5 ORDER BY distance_km LIMIT 1""",
                           [lat, lng, top["SITE_ID"], min_lat, max_lat, min_lng, max_lng, lat, lng])
        if not row:
            nearest[key] = {"status": "No"}
            continue
        entry = {"status": "Yes", **{k: v for k, v in row.items() if k != "enb"},
                 "kpi_summary": _kpi(row["site_id"], tech, d)["network_kpi"]}
        if key == "TM_4G":
            rf = _rf(row["enb"], d)
            entry.update(rsrp_cat=rf["rsrp"], rsrp_val=rf["rsrp_value"], sinr_cat=rf["sinr"], sinr_val=rf["sinr_value"])
        nearest[key] = entry
    return {**_head(msisdn, d, available), "site_id": top["SITE_ID"], "highest_online_time_site": [top],
            "nearest_sites": nearest}


def _site_lists(sites: list[dict], d: dt.date) -> dict:
    ntt4g, ntt5g, cong, pm = [], [], [], []
    for s in sites:
        st = _site_status(s["SITE_ID"], s["Technology"], d)
        base = {"site_id": s["SITE_ID"], "online_time": s["DURATION"]}
        if st["ntt4g"] and st["ntt4g"]["ntt4g_site_status"] == "Active":
            ntt4g.append({**base, **st["ntt4g"]})
        if st["ntt5g"] and st["ntt5g"]["ntt5g_site_status"] == "Active":
            ntt5g.append({**base, **st["ntt5g"]})
        if st["congestion"] and st["congestion"]["congestion_site_status"] == "Yes":
            cong.append({**base, **st["congestion"]})
        if st["plan_maintenance"] and st["plan_maintenance"]["plan_maintenance_site_status"] == "Yes":
            pm.append({**base, **st["plan_maintenance"]})
    any_tm = any(s["Technology"] == "TM4G" for s in sites)
    return {"ntt_status": "Active" if ntt4g or ntt5g else "No",
            "ntt4g_status": "Active" if ntt4g else "No", "ntt4g": ntt4g,
            "ntt5g_status": "Active" if ntt5g else "No", "ntt5g": ntt5g,
            "congestion_status": "Yes" if cong else ("No" if any_tm else "NA"), "congestion": cong,
            "plan_maintenance_status": "Yes" if pm else ("No" if any_tm else "NA"), "plan_maintenance": pm}


def get_nba_site_related(msisdn: Msisdn, query_date: QueryDate = None) -> dict:
    """Get site-related NBA status for the subscriber's top 5 sites by online time on a day: active 4G NTT (number,
    fault, ETTR), active 5G incidents, congestion and planned maintenance, with overall Active/Yes/No flags. Omit
    `query_date` for the latest; the response includes `query_date` and `available_dates`."""
    msisdn, d, available = _resolve(msisdn, query_date)
    sites = _visited(_sessions(msisdn, d))[:5]
    return {**_head(msisdn, d, available),
            "top5_sites": [{"site_id": s["SITE_ID"], "online_time": s["DURATION"], "technology": s["Technology"]}
                           for s in sites], **_site_lists(sites, d)}


def get_nba_network_connection(msisdn: Msisdn, query_date: QueryDate = None) -> dict:
    """Get the subscriber's network connection for a day: connection type, signal strength (RSRP/SINR of the top
    site and RF quality of the top 5 sites), and NTT / congestion / planned-maintenance status of visited sites.
    Omit `query_date` for the latest; the response includes `query_date` and `available_dates`."""
    msisdn, d, available = _resolve(msisdn, query_date)
    rows = _sessions(msisdn, d)
    sites = _visited(rows)[:5]
    top5 = []
    for s in sites:
        rf = _rf(s["ENODEB_ID"], d) if s["DATA_MODE"] == "LTE" else {
            "overall_rf_quality": "not_related", "rsrp": "not_related", "rsrp_value": None, "sinr": "not_related",
            "sinr_value": None, "rsrq": "not_related", "rsrq_value": None, "cqi": "not_related", "cqi_value": None}
        top5.append({"site_id": s["SITE_ID"], "online_time": s["DURATION"], "data_mode": s["DATA_MODE"],
                     "latitude": s["Latitude"], "longitude": s["Longitude"], "rsrp_val": rf["rsrp_value"],
                     "rsrp_cat": rf["rsrp"], "sinr_val": rf["sinr_value"], "sinr_cat": rf["sinr"],
                     "rsrq_val": rf["rsrq_value"], "rsrq_cat": rf["rsrq"], "cqi_val": rf["cqi_value"],
                     "cqi_cat": rf["cqi"], "overall_rf_quality": rf["overall_rf_quality"]})
    first = top5[0] if top5 else {}
    return {**_head(msisdn, d, available), "connection_type": _usage(rows)["connection_type"],
            "signal_strength": {"rsrp_val": first.get("rsrp_val"), "rsrp_cat": first.get("rsrp_cat"),
                                "sinr_val": first.get("sinr_val"), "sinr_cat": first.get("sinr_cat"),
                                "overall_rf_quality": first.get("overall_rf_quality"), "top5_sites": top5},
            **_site_lists(sites, d)}


def get_nba_visited_sites(
    msisdn: Msisdn,
    query_date: QueryDate = None,
    rank_by_online_time: Annotated[bool, Field(description="True: longest online time first; False: first-seen order")] = True,
    page: Page = 1,
    page_size: PageSize = 50,
) -> dict:
    """Get the sites a subscriber used on a day with eNodeB, ECI, cell, data mode/technology, online time (minutes),
    usage volume, site coordinates, morphology and cluster. Ranked by online time (default) or first-seen order.
    Omit `query_date` for the latest; the response includes `query_date` and `available_dates`. Paginated."""
    msisdn, d, available = _resolve(msisdn, query_date)
    sites = _visited(_sessions(msisdn, d))
    if not rank_by_online_time:
        imsi = sites[0]["IMSI"] if sites else None
        first = {r["site_id"]: r["t"] for r in db.query(
            "SELECT site_id, min(ts) AS t FROM zl_session WHERE imsi = ? AND ts::DATE = ? GROUP BY site_id", [imsi, d])}
        sites.sort(key=lambda s: first.get(s["SITE_ID"]) or dt.datetime.max)
        for s in sites:
            s["FIRST_SEEN"] = first.get(s["SITE_ID"])
    return {**_head(msisdn, d, available), "total_sites": len(sites), **db.paginate_list(sites, page, page_size)}


def get_nba_historical_days(msisdn: Msisdn, query_date: QueryDate = None) -> dict:
    """Get a 7-day history (the 7 days before query_date) for the subscriber: per day the top site, SINR and RSRP/RSRQ
    (TM 4G only), NTT, planned maintenance and congestion status, internet connection, total volume and usage ratio
    per technology. Omit `query_date` for the latest; the response includes `query_date` and `available_dates`."""
    msisdn = check_msisdn(msisdn)
    available = _dates(msisdn)
    if not available:
        raise NotFoundError(f"No NBA data for MSISDN {msisdn}")
    qd = parse_date(query_date, "query_date") or dt.date.fromisoformat(available[0]) + dt.timedelta(days=1)
    days = [qd - dt.timedelta(days=k) for k in range(7, 0, -1)]
    out = []
    for d in days:
        rows = _sessions(msisdn, d)
        if not rows:
            out.append({"date": d.strftime("%d/%m/%Y"), "date_iso": d.isoformat(), "site_id": "NA", "ntt": "NA",
                        "plan_maintenance": "NA", "site_congestion": "NA", "signal_strength": "NA",
                        "internet_connection": "NA"})
            continue
        sites = _visited(rows)
        top = sites[0]
        use = _usage(rows)
        lists = _site_lists(sites[:5], d)
        rf = _rf(top["ENODEB_ID"], d) if top["DATA_MODE"] == "LTE" else None
        out.append({
            "date": d.strftime("%d/%m/%Y"), "date_iso": d.isoformat(), "site_id": top["SITE_ID"],
            "enodeb_id": top["ENODEB_ID"],
            "sinr": {"sinr_val": rf["sinr_value"], "sinr_cat": rf["sinr"]} if rf else "not-related",
            "ntt": lists["ntt_status"], "plan_maintenance": lists["plan_maintenance_status"],
            "site_congestion": lists["congestion_status"],
            "signal_strength": {"rsrp_val": rf["rsrp_value"], "rsrp_cat": rf["rsrp"], "rsrq_val": rf["rsrq_value"],
                                "rsrq_cat": rf["rsrq"], "overall_rf_quality": rf["overall_rf_quality"]} if rf else "not-related",
            "internet_connection": use["connection_type"],
            "total_volume": {"bytes": use["total_volume_bytes"], "kb": use["total_volume_kb"],
                             "mb": use["total_volume_mb"], "gb": use["total_volume_gb"],
                             "category": use["total_volume_category"]},
            "usage_ratio": use["usage_by_generation"],
        })
    return {"msisdn": msisdn, "query_date": qd.isoformat(), "available_dates": available,
            "start_date": days[0].strftime("%d/%m/%Y"), "end_date": days[-1].strftime("%d/%m/%Y"),
            "total_days": 7, "data": out}


def verify_nba_api_data() -> dict:
    """Verify the NBA data sources: row counts and latest date per upstream table, number of subscribers with session
    data, and a few sample MSISDNs to try. Returns success=false if any required table is empty."""
    checks = []
    for table, date_col in (("ime_lte_daily", "start_time"), ("IMEDRDailyUsage", "start_time"),
                            ("subs_profile_daily", None), ("pass_quota_daily", "updated_date"),
                            ("case_view_daily", "case_created_on"), ("case_thd_daily", "created_time"),
                            ("voice_cdr_daily", "call_date"), ("short_voice_cdr_daily", "call_date"),
                            ("network_kpi", "kpi_date"), ("BinKPI", "DateID"), ("ml_model_training", None),
                            ("ml_nba_advisory", None)):
        n = db.scalar(f"SELECT COUNT(*) FROM {table}")
        latest = db.scalar(f"SELECT max({date_col})::VARCHAR FROM {table}") if date_col else None
        checks.append({"table": table, "rows": n, "latest": latest, "ok": n > 0})
    samples = [r["msisdn"] for r in db.query(
        "SELECT msisdn, count(*) AS n FROM ime_lte_daily GROUP BY msisdn ORDER BY n DESC, msisdn LIMIT 5")]
    subs = db.scalar("SELECT COUNT(DISTINCT msisdn) FROM ime_lte_daily")
    ok = all(c["ok"] for c in checks)
    return {"success": ok, "record_count": sum(c["rows"] for c in checks), "subscribers_with_sessions": subs,
            "sample_msisdns": samples, "checks": checks,
            "message": "All NBA sources have data" if ok else "Some NBA sources are empty"}


TOOLS = [
    get_nba_subscriber_profile, get_nba_network_kpi, get_nba_rf_quality, get_nba_nearest_site, get_nba_site_related,
    get_nba_network_connection, get_nba_visited_sites, get_nba_historical_days, verify_nba_api_data,
]
