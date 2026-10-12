"""RAN KPI tools over daily per-cell OSS KPIs (KPI_Huawei / KPI_ZTE for 4G,
KPI_DNB_5G for 5G). No RAN KPI API exists in the source systems; thresholds follow the
nba-collector network KPI rules where they overlap."""

import datetime as dt
from typing import Annotated, Literal

from pydantic import Field

from netops_mcp import db
from netops_mcp.errors import NotFoundError, ValidationError
from netops_mcp.tools.common import DateStr, Page, PageSize, csv_list, parse_date, pct_delta

# kpi -> (column, aggregation, direction, threshold, unit)
KPI_4G = {
    "cell_availability": ("Webe_Cell_Availability", "avg", "higher", 99.5, "%"),
    "call_setup_success_rate": ("Webe_Call_Setup_Success_Rate", "avg", "higher", 98.0, "%"),
    "rrc_setup_success_rate": ("Webe_RRC_Setup_Success_Rate_Service", "avg", "higher", 98.0, "%"),
    "erab_setup_success_rate": ("Webe_ERAB_Setup_Success_Rate", "avg", "higher", 98.0, "%"),
    "erab_drop_rate": ("Webe_ERAB_Drop_Rate", "avg", "lower", 1.0, "%"),
    "rrc_drop_rate": ("Webe_RRC_Drop_Rate", "avg", "lower", 1.0, "%"),
    "intra_freq_ho_success_rate": ("Webe_Intra_Frequency_Outgoing_Handover_Success_Rate", "avg", "higher", 97.0, "%"),
    "inter_freq_ho_success_rate": ("Webe_Inter_Frequency_Outgoing_Handover_Success_Rate", "avg", "higher", 95.0, "%"),
    "irat_ho_success_rate": ("Webe_IRAT_Outgoing_Handover_Success_Rate_Prep", "avg", "higher", 93.0, "%"),
    "csfb_success_rate": ("Webe_CSFB_Redirection_Success_Rate", "avg", "higher", 97.0, "%"),
    "srvcc_success_rate": ("Webe_SRVCC_Success_Rate_Prep", "avg", "higher", 95.0, "%"),
    "dl_user_throughput": ("Webe_Average_DL_User_Throughput_MB", "avg", "higher", 7.7, "Mbps"),
    "ul_user_throughput": ("Webe_Average_UL_User_Throughput_MB", "avg", "higher", 1.0, "Mbps"),
    "dl_traffic_volume": ("Webe_DL_Traffic_Volume_GB", "sum", None, None, "GB"),
    "ul_traffic_volume": ("Webe_UL_Traffic_Volume_GB", "sum", None, None, "GB"),
    "max_active_users": ("Webe_Maximum_Cell_DL_Active_User_Number", "max", None, None, "users"),
    "max_rrc_users": ("Webe_Maximum_Cell_RRC_Connected_User_Number", "max", None, None, "users"),
    "dl_prb_utilization": ("Webe_DL_Resource_Block_Utilization", "avg", "lower", 80.0, "%"),
    "ul_prb_utilization": ("Webe_UL_Resource_Block_Utilization", "avg", "lower", 80.0, "%"),
    "volte_setup_success_rate": ("Webe_Volte_Setup_Success_Rate", "avg", "higher", 98.0, "%"),
    "volte_drop_rate": ("Webe_Volte_Drop_Rate", "avg", "lower", 1.0, "%"),
    "s1_setup_success_rate": ("Webe_S1_Signal_Establishment_Success_Rate", "avg", "higher", 99.0, "%"),
}
KPI_5G = {
    "cell_availability": ("Cell_Availability_5G", "avg", "higher", 99.5, "%"),
    "data_session_setup_success_rate": ("Data_Session_Setup_Success_Rate_5G", "avg", "higher", 99.5, "%"),
    "data_session_abnormal_release_rate": ("Data_Session_Abnormal_Release_Rate_5G", "avg", "lower", 1.0, "%"),
    "intra_sgnb_pscell_change_success_rate": ("Intra_SgNB_PSCell_Change_Success_Rate_5G", "avg", "higher", 95.0, "%"),
    "inter_sgnb_pscell_change_success_rate": ("Inter_SgNB_PSCell_Change_Success_Rate_5G", "avg", "higher", 95.0, "%"),
    "dl_user_throughput": ("Average_DL_User_Throughput_Mbps", "avg", "higher", 100.0, "Mbps"),
    "ul_user_throughput": ("Average_UL_User_Throughput_Mbps", "avg", "higher", 10.0, "Mbps"),
    "dl_traffic_volume": ("DL_Traffic_Volume_GB", "sum", None, None, "GB"),
    "ul_traffic_volume": ("UL_Traffic_Volume_GB", "sum", None, None, "GB"),
    "dl_prb_utilization": ("DL_PRB_Utilization", "avg", "lower", 80.0, "%"),
    "max_rrc_users": ("Max_RRC_Connected_Users", "max", None, None, "users"),
    "latency": ("Latency_ms", "avg", "lower", 15.0, "ms"),
}
CATALOG = {"4g": (KPI_4G, "ran_kpi_4g"), "5g": (KPI_5G, "ran_kpi_5g")}
GRAIN = {"daily": ("Date", 14), "weekly": ("date_trunc('week', Date)::DATE", 56),
         "monthly": ("date_trunc('month', Date)::DATE", 60)}
KpiParam = Annotated[str | list[str] | None, Field(
    description="KPI name(s): comma list or array, or 'all'. See get_ran_kpi_summary for the catalogue.")]


def _tech(technology: str) -> tuple[dict, str, str]:
    t = (technology or "").lower()
    if t not in CATALOG:
        raise ValidationError("'technology' must be 4g or 5g")
    return *CATALOG[t], t


def _kpis(catalog: dict, kpi) -> list[str]:
    names = csv_list(kpi)
    if not names or names == ["all"]:
        return list(catalog)
    bad = [k for k in names if k not in catalog]
    if bad:
        raise ValidationError(f"Unknown KPI(s) {bad}. Available: {', '.join(catalog)}")
    return names


def _range(view: str) -> dict:
    r = db.query_one(f"SELECT min(Date) AS s, max(Date) AS e FROM {view}")
    return {"start_date": r["s"].isoformat(), "end_date": r["e"].isoformat()}


def _window(view, start_date, end_date, default_days):
    avail = _range(view)
    e = parse_date(end_date, "end_date") or dt.date.fromisoformat(avail["end_date"])
    s = parse_date(start_date, "start_date") or e - dt.timedelta(days=default_days - 1)
    if s > e:
        raise ValidationError("'start_date' must be on or before 'end_date'")
    return s, e, avail


def _exclusion_cte(tech: str) -> str:
    ref = db.ref_date().isoformat()
    if tech == "4g":
        ntt = f"""SELECT split_part(network_element_ne_id, ',', 1) AS site_id,
                  unnest(generate_series(created_date::DATE,
                         CASE WHEN status = 'Open' THEN DATE '{ref}' ELSE greatest(ettr::DATE, created_date::DATE) END,
                         INTERVAL 1 DAY))::DATE AS d
           FROM ntt_granite WHERE id IN (SELECT max(id) FROM ntt_granite GROUP BY ntt_no)
             AND fault_category IN ('Total Outage', 'Partial Outage')"""
    else:
        ntt = f"""SELECT hpd_ci, unnest(generate_series(event_start_time::DATE,
                         COALESCE(event_end_time::DATE, DATE '{ref}'), INTERVAL 1 DAY))::DATE
           FROM ntt_5g_ntt5g WHERE id IN (SELECT max(id) FROM ntt_5g_ntt5g GROUP BY tm_incident_id)"""
    pm = """SELECT Hostname, unnest(generate_series("Planned Start"::DATE, "Planned End"::DATE, INTERVAL 1 DAY))::DATE
            FROM Webe_Plan_Maintenance WHERE Status IN ('WIMPLEMENTER', 'CLOSE') AND "NCA/CA" = 'CA'"""
    return f"excl AS ({ntt} UNION {pm})"


def _base(view, tech, s, e, vendor, region, site_ids, exclusion):
    where = ["v.Date BETWEEN ? AND ?"]
    params: list = [s, e]
    if vendor:
        where.append("v.vendor ILIKE ?")
        params.append(vendor.strip())
    if region:
        where.append("v.region ILIKE ?")
        params.append(f"%{region.strip()}%")
    if site_ids:
        where.append(f"v.site_id IN ({','.join('?' * len(site_ids))})")
        params += site_ids
    cte = ""
    if exclusion:
        cte = "WITH " + _exclusion_cte(tech) + " "
        where.append("NOT EXISTS (SELECT 1 FROM excl x WHERE x.site_id = v.site_id AND x.d = v.Date)")
    return cte, f"FROM {view} v WHERE " + " AND ".join(where), params


def _agg(catalog, names, prefix="v.") -> str:
    out = []
    for k in names:
        col, agg, *_ = catalog[k]
        out.append(f"round({agg}({prefix}{col}), 3) AS {k}")
    return ", ".join(out)


def _meta(catalog, names):
    return [{"kpi": k, "unit": catalog[k][4], "aggregation": catalog[k][1], "direction": catalog[k][2],
             "threshold": catalog[k][3]} for k in names]


def _status(catalog, k, v):
    _, _, direction, thr, _ = catalog[k]
    if direction is None or v is None:
        return None
    return "pass" if (v >= thr if direction == "higher" else v <= thr) else "fail"


# ---------------------------------------------------------------------------
def get_ran_kpi(
    level: Literal["national", "region", "site"],
    kpi: KpiParam,
    technology: Literal["4g", "5g"],
    start_date: DateStr = None,
    end_date: DateStr = None,
    granularity: Annotated[Literal["daily", "weekly", "monthly"], Field(description="Time bucket")] = "daily",
    vendor: Annotated[str | None, Field(description="Huawei or ZTE (4G), Ericsson (5G)")] = None,
    region: str | None = None,
    site_id: Annotated[str | None, Field(description="Site ID or comma list (required for level=site)")] = None,
    exclusion: Annotated[bool, Field(description="Exclude site-days with an outage NTT or planned maintenance")] = False,
) -> dict:
    """Get RAN KPI time series for one or more KPIs at national, region or site level for 4G or 5G, bucketed daily,
    weekly or monthly. Rates are cell averages, traffic is summed, user counts are maxima. Omit start_date/end_date
    for the latest period (14 days daily, 8 weeks weekly, 60 days monthly); the response includes start_date,
    end_date and available_range. exclusion=true drops site-days affected by outages or planned maintenance."""
    catalog, view, tech = _tech(technology)
    names = _kpis(catalog, kpi)
    lvl = level.lower()
    if granularity not in GRAIN:
        raise ValidationError("'granularity' must be daily, weekly or monthly")
    period, days = GRAIN[granularity]
    s, e, avail = _window(view, start_date, end_date, days)
    sites = csv_list(site_id)
    if lvl == "site" and not sites:
        raise ValidationError("'site_id' is required for level=site")
    cte, frm, params = _base(view, tech, s, e, vendor, region, sites, exclusion)
    group = {"national": "", "region": ", v.region", "site": ", v.site_id"}.get(lvl)
    if group is None:
        raise ValidationError("'level' must be national, region or site")
    sql = (f"{cte}SELECT {period.replace('Date', 'v.Date')} AS period{group}, "
           f"count(DISTINCT v.Site_Cell_ID) AS cells, {_agg(catalog, names)} {frm} "
           f"GROUP BY ALL ORDER BY period{group}")
    rows = db.query(sql, params)
    for r in rows:
        if granularity == "weekly":
            y, w, _ = r["period"].isocalendar()
            r["period_label"] = f"{y}-W{w:02d}"
        r["period"] = r["period"].isoformat()
    if lvl == "site" and not rows:
        raise NotFoundError(f"No {tech.upper()} KPI data for site(s) {', '.join(sites)} in the period")
    return {"level": lvl, "technology": tech, "granularity": granularity, "start_date": s.isoformat(),
            "end_date": e.isoformat(), "available_range": avail, "exclusion": exclusion,
            "kpis": _meta(catalog, names), "series": rows}


def get_ran_kpi_summary(
    technology: Literal["4g", "5g"],
    start_date: DateStr = None,
    end_date: DateStr = None,
    region: str | None = None,
    vendor: str | None = None,
) -> dict:
    """Get a RAN KPI scorecard for 4G or 5G: every KPI in the catalogue aggregated over the period (default last 7
    days) with unit, threshold, pass/fail status, the previous equal-length period and delta %. Optional region and
    vendor filters. The response includes start_date, end_date and available_range."""
    catalog, view, tech = _tech(technology)
    s, e, avail = _window(view, start_date, end_date, 7)
    span = (e - s).days + 1
    ps, pe = s - dt.timedelta(days=span), s - dt.timedelta(days=1)
    names = list(catalog)
    out = []
    vals = {}
    for key, (a, b) in (("cur", (s, e)), ("prev", (ps, pe))):
        _, frm, params = _base(view, tech, a, b, vendor, region, [], False)
        vals[key] = db.query_one(f"SELECT count(DISTINCT v.Site_Cell_ID) AS cells, {_agg(catalog, names)} {frm}", params)
    for k in names:
        cur, prev = vals["cur"][k], vals["prev"][k]
        out.append({**_meta(catalog, [k])[0], "value": cur, "previous": prev,
                    "delta_percentage": pct_delta(cur, prev) if cur is not None and prev else None,
                    "status": _status(catalog, k, cur)})
    return {"technology": tech, "start_date": s.isoformat(), "end_date": e.isoformat(),
            "previous_period": {"start_date": ps.isoformat(), "end_date": pe.isoformat()},
            "available_range": avail, "region": region, "vendor": vendor, "cells": vals["cur"]["cells"],
            "failing_kpis": [r["kpi"] for r in out if r["status"] == "fail"], "kpis": out}


def get_ran_site_info(site_id: str) -> dict:
    """Get RAN information for a 4G or 5G site: inventory (vendor, region, cluster, rollout, coordinates, status),
    each cell with its last-7-day KPIs and failing KPIs, a site-level KPI scorecard, plus current open NTT, active
    planned maintenance and congestion status."""
    s4 = db.query_one("SELECT * FROM Site4G WHERE upper(Site_ID) = upper(?)", [site_id])
    s5 = None if s4 else db.query_one("SELECT * FROM Site5G WHERE upper(Site_ID) = upper(?)", [site_id])
    if not (s4 or s5):
        raise NotFoundError(f"Site '{site_id}' not found in Site4G or Site5G")
    tech = "4g" if s4 else "5g"
    site = s4 or s5
    sid = site["Site_ID"]
    catalog, view, _ = _tech(tech)
    e = dt.date.fromisoformat(_range(view)["end_date"])
    s = e - dt.timedelta(days=6)
    keys = ["cell_availability", "dl_user_throughput", "dl_prb_utilization", "dl_traffic_volume"] + (
        ["erab_drop_rate", "volte_drop_rate"] if tech == "4g" else ["data_session_abnormal_release_rate", "latency"])
    cells = db.query(f"SELECT v.Site_Cell_ID AS cell, v.Cell AS cell_name, {_agg(catalog, keys)} FROM {view} v "
                     f"WHERE v.site_id = ? AND v.Date BETWEEN ? AND ? GROUP BY ALL ORDER BY cell", [sid, s, e])
    for c in cells:
        c["failing_kpis"] = [k for k in keys if _status(catalog, k, c[k]) == "fail"]
    summary = db.query_one(f"SELECT {_agg(catalog, list(catalog))} FROM {view} v WHERE v.site_id = ? "
                           f"AND v.Date BETWEEN ? AND ?", [sid, s, e])
    scorecard = [{**_meta(catalog, [k])[0], "value": summary[k], "status": _status(catalog, k, summary[k])}
                 for k in catalog]
    if tech == "4g":
        ntt = db.query("""SELECT ntt_no, fault_category, created_date, ettr, status FROM ntt_granite
            WHERE id IN (SELECT max(id) FROM ntt_granite GROUP BY ntt_no) AND status = 'Open'
              AND network_element_ne_id ILIKE ?""", [f"%{sid}%"])
    else:
        ntt = db.query("""SELECT tm_incident_id, incident_status, incident_priority, event_start_time FROM ntt_5g_ntt5g
            WHERE id IN (SELECT max(id) FROM ntt_5g_ntt5g GROUP BY tm_incident_id)
              AND incident_status IN ('Assigned', 'Pending', 'In Progress') AND hpd_ci = ?""", [sid])
    now = dt.datetime.combine(db.ref_date(), dt.time(12))
    pm = db.query("""SELECT "RFC ID" AS rfc_id, Title AS title, "Planned Start" AS planned_start,
            "Planned End" AS planned_end FROM Webe_Plan_Maintenance WHERE Hostname = ? AND Status = 'WIMPLEMENTER'
            AND "NCA/CA" = 'CA' AND ? BETWEEN "Planned Start" AND "Planned End" """, [sid, now])
    congested = [r["cell"] for r in db.query("""SELECT DISTINCT Site_Cell_ID AS cell FROM Webe_Congested_Cell
        WHERE "Site ID" = ? AND (report_year * 100 + Week) = (SELECT max(report_year * 100 + Week) FROM Webe_Congested_Cell)""",
                                             [sid])]
    from netops_mcp.tools.common import snake
    return {"technology": tech, "site": snake(site), "kpi_period": {"start_date": s.isoformat(), "end_date": e.isoformat()},
            "kpi_scorecard": scorecard, "cells": cells, "open_ntt": ntt, "active_maintenance": pm,
            "congested_cells": congested}


def get_worst_cells(
    scope: Literal["national", "kpi"],
    technology: Literal["4g", "5g"],
    start_date: DateStr = None,
    end_date: DateStr = None,
    kpi: Annotated[str | None, Field(description="KPI to rank by (required for scope=kpi)")] = None,
    region: str | None = None,
    vendor: str | None = None,
    page: Page = 1,
    page_size: PageSize = 50,
) -> dict:
    """Get worst cells over a period (default last 7 days) for 4G or 5G with site, region, vendor and coordinates.
    scope=national ranks cells by the number of failing KPIs, then by DL traffic (impact); scope=kpi ranks by one
    KPI's value in its bad direction and flags threshold failures. Optional region/vendor filters. Paginated; the
    response includes start_date, end_date and available_range."""
    catalog, view, tech = _tech(technology)
    s, e, avail = _window(view, start_date, end_date, 7)
    sc = scope.lower()
    _, frm, params = _base(view, tech, s, e, vendor, region, [], False)
    judged = [k for k in catalog if catalog[k][2]]
    cols = (f"v.Site_Cell_ID AS cell, any_value(v.Cell) AS cell_name, v.site_id, any_value(v.region) AS region, "
            f"any_value(v.vendor) AS vendor, any_value(v.latitude) AS latitude, any_value(v.longitude) AS longitude, "
            f"{_agg(catalog, list(catalog))}")
    fails = " + ".join(
        f"(CASE WHEN {k} {'<' if catalog[k][2] == 'higher' else '>'} {catalog[k][3]} THEN 1 ELSE 0 END)" for k in judged)
    inner = f"SELECT {cols} {frm} GROUP BY v.Site_Cell_ID, v.site_id"
    if sc == "national":
        sql = f"SELECT *, ({fails}) AS failing_kpi_count FROM ({inner}) WHERE ({fails}) > 0"
        order = "failing_kpi_count DESC, dl_traffic_volume DESC"
        ranked_by = "failing_kpi_count"
    elif sc == "kpi":
        if not kpi or kpi not in catalog:
            raise ValidationError(f"'kpi' is required for scope=kpi. Available: {', '.join(catalog)}")
        direction = catalog[kpi][2] or "higher"
        thr = catalog[kpi][3]
        fail = f"{kpi} {'<' if direction == 'higher' else '>'} {thr}" if thr is not None else "false"
        sql = f"SELECT *, ({fail}) AS failing FROM ({inner}) WHERE {kpi} IS NOT NULL"
        order = f"{kpi} {'ASC' if direction == 'higher' else 'DESC'}"
        ranked_by = kpi
    else:
        raise ValidationError("'scope' must be national or kpi")
    result = db.paginate(sql, params, page, page_size, order_by=order)
    for i, r in enumerate(result["items"], start=(result["page"] - 1) * result["page_size"] + 1):
        r["rank"] = i
        if sc == "national":
            r["failing_kpis"] = [k for k in judged if _status(catalog, k, r[k]) == "fail"]
    return {"scope": sc, "technology": tech, "ranked_by": ranked_by, "start_date": s.isoformat(),
            "end_date": e.isoformat(), "available_range": avail, **result}


TOOLS = [get_ran_kpi, get_ran_kpi_summary, get_ran_site_info, get_worst_cells]
