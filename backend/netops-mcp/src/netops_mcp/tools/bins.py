"""BIN map tools (bin_visualisation): polygons, KPI heat layer, BIN detail,
places, cell detail, area analysis and 4G network elements."""

import json
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from netops_mcp import db, geo
from netops_mcp.errors import NotFoundError, ValidationError
from netops_mcp.tools.common import LatLngStr, Page, PageSize, RadiusKm, csv_list, snake

DURATIONS = ("weekly", "monthly", "bi_monthly", "quarterly", "half_yearly", "yearly")
TOPCELL_SUFFIX = {"weekly": "Weekly", "monthly": "Monthly", "bi_monthly": "Bi_Monthly", "quarterly": "Quarterly",
                  "half_yearly": "Half_Yearly", "yearly": "Yearly"}
CALC = ("avg", "min", "max")
OLO = ("Celcom", "Digi", "Maxis", "U Mobile", "Yes")

Duration = Annotated[Literal["weekly", "monthly", "bi_monthly", "quarterly", "half_yearly", "yearly"],
                     Field(description="Observation window; weekly uses the latest available week.")]
Calc = Annotated[Literal["avg", "min", "max"], Field(description="Aggregate to read.")]


def _duration(value: str | None) -> str:
    d = (value or "weekly").lower()
    if d not in DURATIONS:
        raise ValidationError(f"'observation_duration' must be one of: {', '.join(DURATIONS)}")
    return d


def _calc(value: str | None) -> str:
    c = (value or "avg").lower()
    if c not in CALC:
        raise ValidationError("'calculation_type' must be avg, min or max")
    return c


def _period(duration: str, table: str = "bin_bgs") -> tuple[str, list, str]:
    """SQL filter for the latest period of a duration table, plus a label."""
    if duration == "weekly":
        row = db.query_one(f"SELECT year, weekly_id FROM {table}_weekly ORDER BY year DESC, weekly_id DESC LIMIT 1")
        if not row:
            raise NotFoundError("No weekly BIN data")
        return " AND year = ? AND weekly_id = ?", [row["year"], row["weekly_id"]], f"{row['year']}{row['weekly_id']:02d}"
    year = db.scalar(f"SELECT max(year) FROM {table}_{duration}")
    return "", [], f"{year}_{duration}"


def _area_filter(center, radius, northwest, northeast, southeast, southwest, alias="b"):
    """Spatial filter on Bin_Information-like columns (centroid + bbox)."""
    corners = [northwest, northeast, southeast, southwest]
    if all(corners):
        min_lat, max_lat, min_lng, max_lng = geo.bbox_from_corners(*corners)
        return (f" AND {alias}.max_lat >= ? AND {alias}.min_lat <= ? AND {alias}.max_lng >= ? AND {alias}.min_lng <= ?",
                [min_lat, max_lat, min_lng, max_lng])
    if any(corners):
        raise ValidationError("Provide all four corners (northwest, northeast, southeast, southwest) or none")
    if center:
        lat, lng = geo.parse_latlng(center, "center")
        r = radius or 6.0
        min_lat, max_lat, min_lng, max_lng = geo.bbox_around(lat, lng, r)
        return (f" AND {alias}.max_lat >= ? AND {alias}.min_lat <= ? AND {alias}.max_lng >= ? AND {alias}.min_lng <= ?"
                f" AND haversine_km(?, ?, ({alias}.min_lat + {alias}.max_lat) / 2, ({alias}.min_lng + {alias}.max_lng) / 2) <= ?",
                [min_lat, max_lat, min_lng, max_lng, lat, lng, r])
    return "", []


def _fc_page(result: dict, prop_fn) -> dict:
    features = [geo.feature(r["geometry"], prop_fn(r)) for r in result.pop("items")]
    result["geojson"] = geo.feature_collection(features)
    return result


# ---------------------------------------------------------------------------
def get_bin_polygons(
    layer: Literal["bin_border", "hwc_clover", "tm_cluster"],
    center: LatLngStr = None,
    radius: RadiusKm = None,
    northwest: LatLngStr = None,
    northeast: LatLngStr = None,
    southeast: LatLngStr = None,
    southwest: LatLngStr = None,
    page: Page = 1,
    page_size: PageSize = 300,
) -> dict:
    """Get BIN map base polygons as GeoJSON for layer bin_border (grid squares: grid_id, state, cluster_id),
    hwc_clover (cell sector wedges: cell_name, hwc_status Hot/Warm/Cold) or tm_cluster (cluster outlines). Filter by
    center 'lat,lng' + radius km (default 6) or a bbox of four corners. Paginated; returns total."""
    lyr = layer.lower()
    area, params = _area_filter(center, radius, northwest, northeast, southeast, southwest)
    if lyr == "bin_border":
        sql = f"SELECT Grid_ID, State, Cluster_ID, geometry FROM Bin_Information b WHERE true{area}"
        props = lambda r: {"grid_id": r["Grid_ID"], "state": r["State"], "cluster_id": r["Cluster_ID"]}  # noqa: E731
        order = "Grid_ID"
    elif lyr == "hwc_clover":
        sql = f"SELECT Cell_Name, HWC_Status, Week, Year, geometry FROM HWC_Status b WHERE true{area}"
        props = lambda r: {"cell_name": r["Cell_Name"], "hwc_status": r["HWC_Status"],  # noqa: E731
                           "week": r["Week"], "year": r["Year"]}
        order = "Cell_Name"
    elif lyr == "tm_cluster":
        sql = f"SELECT Cluster_ID, Cluster_Name, Morphology, Region, State, geometry FROM TM_Cluster b WHERE true{area}"
        props = lambda r: {"cluster_id": r["Cluster_ID"], "cluster_name": r["Cluster_Name"],  # noqa: E731
                           "morphology": r["Morphology"], "region": r["Region"], "state": r["State"]}
        order = "Cluster_ID"
    else:
        raise ValidationError("'layer' must be bin_border, hwc_clover or tm_cluster")
    return {"layer": lyr, **_fc_page(db.paginate(sql, params, page, page_size, order_by=order), props)}


def search_bins(
    bin_id: Annotated[str, Field(description="Grid ID or its leading digits, or a 'lat,lng' to find the BIN there")],
    page: Page = 1,
    page_size: PageSize = 20,
) -> dict:
    """Search BINs by grid ID prefix, or by location when given 'lat,lng' (returns the containing/nearest BINs within
    1 km). Returns grid_id, state, cluster_id and centroid latitude/longitude. Paginated; returns total."""
    term = str(bin_id or "").strip()
    base = "SELECT Grid_ID AS grid_id, State AS state, Cluster_ID AS cluster_id, latitude, longitude FROM Bin_Information"
    if "," in term:
        lat, lng = geo.parse_latlng(term, "bin_id")
        min_lat, max_lat, min_lng, max_lng = geo.bbox_around(lat, lng, 1.0)
        sql = (f"SELECT *, round(haversine_km(?, ?, latitude, longitude), 3) AS distance_km FROM ({base}) "
               f"WHERE latitude BETWEEN ? AND ? AND longitude BETWEEN ? AND ?")
        return db.paginate(sql, [lat, lng, min_lat, max_lat, min_lng, max_lng], page, page_size,
                           order_by="distance_km")
    if not term.isdigit():
        raise ValidationError("'bin_id' must be digits or a 'lat,lng' string")
    return db.paginate(f"{base} WHERE CAST(Grid_ID AS VARCHAR) LIKE ?", [f"{term}%"], page, page_size,
                       order_by="grid_id")


def get_bin_kpi_values(
    kpi: Literal["rsrp", "rsrq", "throughput"],
    observation_duration: Duration = "weekly",
    calculation_type: Calc = "avg",
    center: LatLngStr = None,
    radius: RadiusKm = None,
    northwest: LatLngStr = None,
    northeast: LatLngStr = None,
    southeast: LatLngStr = None,
    southwest: LatLngStr = None,
    page: Page = 1,
    page_size: PageSize = 500,
) -> dict:
    """Get Unifi BIN KPI values for the heat layer as GeoJSON polygons: kpi rsrp (dBm), rsrq (dB) or throughput
    (download Mbps) using the avg/min/max aggregate for the observation duration. Filter by center 'lat,lng' + radius
    km (default 6) or four bbox corners. Paginated; returns total and observation_range."""
    k = kpi.lower()
    dur, ct = _duration(observation_duration), _calc(calculation_type)
    if k in ("rsrp", "rsrq"):
        table, col = f"bin_bgs_{dur}", f"{k}_{ct}"
    elif k == "throughput":
        table, col = f"bin_ci_{dur}", f"{ct}_download_mbps"
    else:
        raise ValidationError("'kpi' must be rsrp, rsrq or throughput")
    period_sql, period_params, label = _period(dur, "bin_bgs" if k != "throughput" else "bin_ci")
    area, area_params = _area_filter(center, radius, northwest, northeast, southeast, southwest)
    sql = f"""SELECT b.Grid_ID, b.geometry, round(m.{col}, 2) AS value
              FROM {table} m JOIN Bin_Information b ON b.Grid_ID = m.grid_id
              WHERE m.operator = 'Unifi'{period_sql.replace('year', 'm.year').replace('weekly_id', 'm.weekly_id')}{area}"""
    result = db.paginate(sql, period_params + area_params, page, page_size, order_by="Grid_ID")
    name = {"rsrp": "rsrp", "rsrq": "rsrq", "throughput": "throughput_mbps"}[k]
    return {"kpi": k, "observation_duration": dur, "calculation_type": ct, "observation_range": label,
            **_fc_page(result, lambda r: {"grid_id": r["Grid_ID"], name: r["value"]})}


# ---------------------------------------------------------------------------
def _tag(value, kind="rsrp"):
    if value is None:
        return "No Sample"
    good, moderate = (-95, -105) if kind == "rsrp" else (-10, -15)
    return "Good" if value >= good else "Moderate" if value >= moderate else "Poor"


def _vs_olo(unifi, best_olo, kind="rsrp"):
    if unifi is None or best_olo is None:
        return "Undetermined"
    if _tag(unifi, kind) == "Poor":
        return "Weak"
    return "Good" if unifi > best_olo else "On Par"


def _top_cells(grid_id: int, dur: str) -> tuple[list[dict], str]:
    table = f"Bin_BGS_Top_Cell_{TOPCELL_SUFFIX[dur]}"
    if dur == "weekly":
        row = db.query_one(f"SELECT year, weekly_id FROM {table} ORDER BY year DESC, weekly_id DESC LIMIT 1")
        period, params = " AND t.year = ? AND t.weekly_id = ?", [row["year"], row["weekly_id"]]
    else:
        period, params = "", []
    rows = db.query(f"""
        SELECT t.cell_rank_in_grid_id, t.Site_ID AS site_id, t.site_cell_id AS cell, t.Cell_Name AS cell_name,
               t.Vendor AS vendor, round(t.rsrp_mean_db, 2) AS rsrp, round(t.rsrq_mean_db, 2) AS rsrq,
               s.Latitude AS latitude, s.Longitude AS longitude, c.Azimuth AS azimuth, c.Freq_Band AS freq_band
        FROM {table} t
        LEFT JOIN Site4G s ON s.Site_ID = t.Site_ID
        LEFT JOIN Cell4G c ON c.Cell_Name = t.Cell_Name
        WHERE t.grid_id = ? AND t.Site_ID IS NOT NULL AND t.rsrp_mean_db IS NOT NULL{period}
        ORDER BY t.cell_rank_in_grid_id LIMIT 5""", [grid_id] + params)
    return rows, table


def _latest_ems_week() -> tuple[int, int]:
    r = db.query_one("SELECT Year, Week_No FROM HUAWEI_EMS ORDER BY Year DESC, Week_No DESC LIMIT 1")
    return r["Year"], r["Week_No"]


EMS_UNION = "(SELECT 'Huawei' AS vendor, * FROM HUAWEI_EMS UNION ALL SELECT 'ZTE', * FROM ZTE_EMS)"
EMS_FIELDS = """round(DL_PRB_Utilization, 2) AS prb_overall, round(DL_PRB_Utilization_QCI9, 2) AS prb_cqi9,
    round(DL_PRB_Utilization_QCI6, 2) AS prb_cqi6, round(Avg_UL_Throughput, 2) AS avg_uplink_throughput,
    round(Avg_DL_Throughput, 2) AS avg_downlink_throughput, round(Active_User, 2) AS active_users_overall,
    round(Active_User_QCI9, 2) AS active_users_cqi9, round(Active_User_QCI6, 2) AS active_users_cqi6,
    round(UL_Traffic_GB, 2) AS total_uplink_traffic_overall, round(DL_Traffic_GB, 2) AS total_downlink_traffic_overall,
    round(DL_Traffic_Vol_QCI9_GB, 2) AS total_downlink_traffic_cqi9,
    round(DL_Traffic_Vol_QCI6_GB, 2) AS total_downlink_traffic_cqi6, round(CQI, 2) AS cqi,
    round(Less_Than_1KM, 2) AS ta_less_1km, round(More_Than_1KM, 2) AS ta_more_1km, TA_Group AS ta_group,
    Distance AS ta_most_samples, Congestion_Status AS congestion_status"""


def _five_weeks(cell_name: str) -> list[dict]:
    rows = db.query(f"""SELECT Year AS year, Week_No AS week_number,
            CASE WHEN Congestion_Status = '' THEN 'OK' ELSE Congestion_Status END AS congestion_status
        FROM {EMS_UNION} WHERE cell_name = ? ORDER BY Year DESC, Week_No DESC LIMIT 5""", [cell_name])
    return rows


def get_bin_info(
    section: Literal["performance", "coverage", "top_cells", "serving_cell", "neighbouring_cells"],
    grid_id: int,
    observation_duration: Duration = "weekly",
    calculation_type: Calc = "avg",
) -> dict:
    """Get detail of one BIN by section: performance (download/upload Mbps and latency across operators), coverage
    (Unifi RSRP/RSRQ with Good/Moderate/Poor tags and comparison against OLO operators), top_cells (top 5 serving
    cells with RSRP and site coordinates), serving_cell (top cells with site/antenna info, weekly EMS performance and
    5-week congestion) or neighbouring_cells (handover neighbours of the top cells with coordinates)."""
    sec = section.lower()
    dur = _duration(observation_duration)
    _calc(calculation_type)
    b = db.query_one("SELECT Grid_ID, State, Cluster_ID, latitude, longitude FROM Bin_Information WHERE Grid_ID = ?",
                     [grid_id])
    if not b:
        raise NotFoundError(f"BIN {grid_id} not found")
    head = {"grid_id": grid_id, "state": b["State"], "cluster_id": b["Cluster_ID"], "latitude": b["latitude"],
            "longitude": b["longitude"], "observation_duration": dur}

    if sec == "performance":
        period_sql, params, label = _period(dur, "bin_ci")
        row = db.query_one(f"""SELECT round(min(min_download_mbps), 2) AS min_download_mbps,
                round(max(max_download_mbps), 2) AS max_download_mbps, round(avg(avg_download_mbps), 2) AS avg_download_mbps,
                round(avg(avg_latency), 2) AS avg_latency, round(min(min_upload_mbps), 2) AS min_upload_mbps,
                round(max(max_upload_mbps), 2) AS max_upload_mbps, round(avg(avg_upload_mbps), 2) AS avg_upload_mbps
            FROM bin_ci_{dur} WHERE grid_id = ?{period_sql}""", [grid_id] + params)
        return {**head, "observation_range": label, "performance_throughput": row}

    if sec == "coverage":
        period_sql, params, label = _period(dur)
        rows = db.query(f"""SELECT operator, round(rsrp_avg, 2) AS rsrp_avg, round(rsrp_min, 2) AS rsrp_min,
                round(rsrp_max, 2) AS rsrp_max, round(rsrq_avg, 2) AS rsrq_avg, round(rsrq_min, 2) AS rsrq_min,
                round(rsrq_max, 2) AS rsrq_max
            FROM bin_bgs_{dur} WHERE grid_id = ?{period_sql} ORDER BY operator""", [grid_id] + params)
        unifi = next((r for r in rows if r["operator"] == "Unifi"), None)
        olo = [r for r in rows if r["operator"] in OLO]
        best_rsrp = max((r["rsrp_avg"] for r in olo), default=None)
        best_rsrq = max((r["rsrq_avg"] for r in olo), default=None)
        u_rsrp = unifi["rsrp_avg"] if unifi else None
        return {**head, "observation_range": label, "unifi_rsrp_rsrq": unifi,
                "webe_stronghold_weakhold_tagging": _tag(u_rsrp),
                "webe_vs_olo_tagging": _vs_olo(u_rsrp, best_rsrp),
                "olo_best_rsrp": [r["operator"] for r in olo if r["rsrp_avg"] == best_rsrp],
                "olo_best_rsrq": [r["operator"] for r in olo if r["rsrq_avg"] == best_rsrq],
                "olo_coverage": [{"operator": r["operator"], "rsrp_avg": r["rsrp_avg"], "rsrq_avg": r["rsrq_avg"]}
                                 for r in olo]}

    top, _ = _top_cells(grid_id, dur)
    if sec == "top_cells":
        year, week = _latest_ems_week()
        for t in top:
            cs = db.scalar(f"SELECT Congestion_Status FROM {EMS_UNION} WHERE cell_name = ? AND Year = ? AND Week_No = ?",
                           [t["cell_name"], year, week])
            t["congestion_status"] = (cs or "OK") if cs is not None else ""
        cov = get_bin_info("coverage", grid_id, dur)
        u = cov["unifi_rsrp_rsrq"] or {}
        return {**head, "top_five_serving_cells": top,
                "coverage": {"rsrp_avg": u.get("rsrp_avg"), "rsrp_max": u.get("rsrp_max"),
                             "webe_vs_olo_coverage": cov["webe_vs_olo_tagging"]}}

    if sec == "serving_cell":
        year, week = _latest_ems_week()
        names = [t["cell_name"] for t in top]
        basic = []
        for t in top:
            info = db.query_one("""SELECT s.Cluster_ID AS cluster_id, s.Cluster_Name AS cluster_name, s.Rollout AS rollout,
                    s.Backhaul AS backhaul, s.Owner AS site_owner, s.TM_Exchange AS exchange, s.ZBC_Border AS zbc,
                    c.Antenna_Height AS antenna_height, c.Azimuth AS azimuth, c.M_Tilt AS m_tilt, c.E_Tilt AS e_tilt,
                    c.RS_Power AS rs_power
                FROM Cell4G c JOIN Site4G s ON s.Site_ID = c.Site_ID WHERE c.Cell_Name = ?""", [t["cell_name"]]) or {}
            basic.append({**t, **info,
                          "location": f"{t['latitude']:.6f}, {t['longitude']:.6f}" if t["latitude"] else None})
        perf = db.query(f"SELECT cell_name, vendor, {EMS_FIELDS} FROM {EMS_UNION} WHERE Year = ? AND Week_No = ? "
                        f"AND cell_name IN ({','.join('?' * len(names)) or 'NULL'})", [year, week] + names)
        return {**head, "week_id": f"{week:02d}", "year": year,
                "top_five_serving_cell_name": names,
                "top_five_serving_short_cell_name": [t["cell"] for t in top],
                "basic_info_cell": basic, "detail_perf_info": perf,
                "five_week_congestion_overview": [{"cell_name": t["cell"], "details": _five_weeks(t["cell_name"])}
                                                  for t in top]}

    if sec == "neighbouring_cells":
        out = []
        for t in top:
            neigh = db.query("""SELECT target_site_id_cell_id, target_site_id, target_site_latitude,
                    target_site_longitude, handover_success, handover_success_rank
                FROM History_Performance_Handover_4G WHERE local_cell_name = ?
                ORDER BY handover_success_rank LIMIT 5""", [t["cell_name"]])
            out.append({"cell": t["cell"], "cell_rank_in_grid_id": t["cell_rank_in_grid_id"],
                        "latitude": t["latitude"], "longitude": t["longitude"], "neighbours": neigh})
        return {**head, "neighbouring_cells": out}
    raise ValidationError("'section' must be performance, coverage, top_cells, serving_cell or neighbouring_cells")


# ---------------------------------------------------------------------------
def get_bin_places(type: Literal["poi", "property"], grid_id: int, page: Page = 1, page_size: PageSize = 50) -> dict:
    """Get places inside a BIN by type: poi (name, category, coordinates, plus per-category counts and the dominant
    active category) or property (address, property type, coordinates, plus counts per type). Paginated; returns
    total."""
    t = type.lower()
    if t not in ("poi", "property"):
        raise ValidationError("'type' must be poi or property")
    if not db.scalar("SELECT COUNT(*) FROM Bin_Information WHERE Grid_ID = ?", [grid_id]):
        raise NotFoundError(f"BIN {grid_id} not found")
    result = db.paginate("""SELECT id, category, name, latitude, longitude FROM bin_places
                            WHERE grid_id = ? AND place_type = ?""", [grid_id, t], page, page_size,
                         order_by="category, id")
    counts = {r["category"]: r["n"] for r in db.query(
        "SELECT category, COUNT(*) AS n FROM bin_places WHERE grid_id = ? AND place_type = ? GROUP BY category "
        "ORDER BY n DESC, category", [grid_id, t])}
    if t == "poi":
        from netops_mcp.seed.reference import ACTIVE_POI
        active = {k: v for k, v in counts.items() if k in ACTIVE_POI}
        top = max(active.values(), default=0)
        summary = {"poi_category_count": counts,
                   "dominant_poi": ", ".join(k for k, v in active.items() if v == top) if top else None,
                   "active_poi_category": [k for k in counts if k in ACTIVE_POI],
                   "inactive_poi_category": [k for k in counts if k not in ACTIVE_POI]}
    else:
        summary = {"property_count": sum(counts.values()), "property_type_count": counts}
    return {"grid_id": grid_id, "type": t, **summary, **result}


def get_cell_details(
    cell_name: Annotated[str, Field(description="4G cell name or site_cell_id, e.g. 'CB0048_011'")],
    observation_duration: Duration = "weekly",
) -> dict:
    """Get detail of a 4G cell: site/antenna info and location, latest weekly EMS performance (PRB %, throughput,
    users, traffic GB, CQI, timing advance), 5-week congestion overview, handover neighbours, RSRP/RSRQ across the
    BINs it serves and the list of those BINs (best first)."""
    dur = _duration(observation_duration)
    cell = db.query_one("""SELECT c.*, s.Vendor, s.Cluster_ID, s.Cluster_Name, s.Latitude, s.Longitude, s.Rollout,
            s.Backhaul, s.Owner, s.TM_Exchange, s.ZBC_Border, s.Region
        FROM Cell4G c JOIN Site4G s ON s.Site_ID = c.Site_ID
        WHERE upper(c.Cell_Name) = upper(?) OR upper(c.Site_Cell_ID) = upper(?)""", [cell_name, cell_name])
    if not cell:
        raise NotFoundError(f"Cell '{cell_name}' not found")
    name = cell["Cell_Name"]
    info = {
        "site_id": cell["Site_ID"], "vendor": cell["Vendor"], "cell_id": cell["Site_Cell_ID"], "cell_name": name,
        "freq_band": cell["Freq_Band"], "new_cluster_id": cell["Cluster_ID"], "new_cluster_name": cell["Cluster_Name"],
        "region": cell["Region"], "zbc": cell["ZBC_Border"], "exchange": cell["TM_Exchange"],
        "latitude": cell["Latitude"], "longitude": cell["Longitude"],
        "location": f"{cell['Latitude']:.6f}, {cell['Longitude']:.6f}", "rollout": cell["Rollout"],
        "antenna_height": cell["Antenna_Height"], "azimuth": cell["Azimuth"], "m_tilt": cell["M_Tilt"],
        "e_tilt": cell["E_Tilt"], "rs_power": cell["RS_Power"], "backhaul": cell["Backhaul"],
        "site_owner": cell["Owner"],
    }
    year, week = _latest_ems_week()
    perf = db.query_one(f"SELECT {EMS_FIELDS} FROM {EMS_UNION} WHERE cell_name = ? AND Year = ? AND Week_No = ?",
                        [name, year, week]) or {}
    neigh = [r["target_site_id_cell_id"] for r in db.query(
        """SELECT target_site_id_cell_id FROM History_Performance_Handover_4G WHERE local_cell_name = ?
           ORDER BY handover_success_rank, target_site_id""", [name])]
    table = f"Bin_BGS_Top_Cell_{TOPCELL_SUFFIX[dur]}"
    period = ""
    params = [name]
    if dur == "weekly":
        row = db.query_one(f"SELECT year, weekly_id FROM {table} ORDER BY year DESC, weekly_id DESC LIMIT 1")
        period, params = " AND year = ? AND weekly_id = ?", [name, row["year"], row["weekly_id"]]
    agg = db.query_one(f"""SELECT round(min(rsrp_min_db), 2) AS rsrp_min, round(max(rsrp_max_db), 2) AS rsrp_max,
            round(avg(rsrp_mean_db), 2) AS rsrp_avg, round(min(rsrq_min_db), 2) AS rsrq_min,
            round(max(rsrq_max_db), 2) AS rsrq_max, round(avg(rsrq_mean_db), 2) AS rsrq_avg, count(*) AS bin_count
        FROM {table} WHERE Cell_Name = ?{period}""", params)
    bins = db.query(f"""SELECT t.grid_id, round(t.rsrp_mean_db, 2) AS rsrp_avg, b.latitude, b.longitude
        FROM {table} t JOIN Bin_Information b ON b.Grid_ID = t.grid_id
        WHERE t.Cell_Name = ?{period.replace('year', 't.year').replace('weekly_id', 't.weekly_id')}
        ORDER BY rsrp_avg DESC LIMIT 100""", params)
    return {"cell_info": {**info, "ems_week": f"{year}-W{week:02d}", **perf,
                          "five_week_congestion_overview": _five_weeks(name),
                          "neighbouring_cells": neigh, **agg, "list_of_bin": bins}}


class PolygonPoint(BaseModel):
    lat: float
    lng: float


def get_bins_in_area(
    mode: Literal["polygon", "cluster"],
    polygon: Annotated[list[PolygonPoint] | None, Field(description="At least 3 {lat, lng} vertices (mode=polygon)")] = None,
    cluster: Annotated[str | None, Field(description="TM cluster ID or name (mode=cluster)")] = None,
    page: Page = 1,
    page_size: PageSize = 200,
) -> dict:
    """Get BINs inside a freehand polygon or a TM cluster with their latest weekly Unifi RSRP/RSRQ (and category) and
    download Mbps, plus an area summary: average KPIs, % of BINs Good/Moderate/Poor, and 4G sites per layer
    (FDD850/TDD2300/TDD2600) with average DL PRB utilisation. Paginated; returns total."""
    m = mode.lower()
    if m == "polygon":
        if not polygon or len(polygon) < 3:
            raise ValidationError("'polygon' needs at least 3 points")
        ring = [[p.lng, p.lat] for p in polygon]
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        label = "polygon"
    elif m == "cluster":
        if not cluster:
            raise ValidationError("'cluster' is required for mode=cluster")
        row = db.query_one("SELECT Cluster_ID, Cluster_Name, geometry FROM TM_Cluster WHERE Cluster_ID ILIKE ? "
                           "OR Cluster_Name ILIKE ? LIMIT 1", [cluster, f"%{cluster}%"])
        if not row:
            raise NotFoundError(f"Cluster '{cluster}' not found")
        ring = json.loads(row["geometry"])["coordinates"][0]
        label = f"{row['Cluster_ID']} {row['Cluster_Name']}"
    else:
        raise ValidationError("'mode' must be polygon or cluster")
    min_lat, max_lat, min_lng, max_lng = geo.ring_bbox(ring)

    wk = db.query_one("SELECT year, weekly_id FROM bin_bgs_weekly ORDER BY year DESC, weekly_id DESC LIMIT 1")
    rows = db.query("""
        SELECT b.Grid_ID AS grid_id, b.latitude, b.longitude, round(g.rsrp_avg, 2) AS rsrp_avg,
               round(g.rsrq_avg, 2) AS rsrq_avg, round(c.avg_download_mbps, 2) AS avg_download_mbps
        FROM Bin_Information b
        LEFT JOIN bin_bgs_weekly g ON g.grid_id = b.Grid_ID AND g.operator = 'Unifi' AND g.year = ? AND g.weekly_id = ?
        LEFT JOIN bin_ci_weekly c ON c.grid_id = b.Grid_ID AND c.operator = 'Unifi' AND c.year = ? AND c.weekly_id = ?
        WHERE b.latitude BETWEEN ? AND ? AND b.longitude BETWEEN ? AND ?""",
                    [wk["year"], wk["weekly_id"], wk["year"], wk["weekly_id"], min_lat, max_lat, min_lng, max_lng])
    inside = [r for r in rows if geo.point_in_ring(r["latitude"], r["longitude"], ring)]
    for r in inside:
        r["rsrp_category"] = _tag(r["rsrp_avg"])
    inside.sort(key=lambda r: r["grid_id"])

    sites = db.query("SELECT Site_ID, Rollout, Latitude, Longitude FROM Site4G WHERE Latitude BETWEEN ? AND ? "
                     "AND Longitude BETWEEN ? AND ?", [min_lat, max_lat, min_lng, max_lng])
    sites = [s for s in sites if geo.point_in_ring(s["Latitude"], s["Longitude"], ring)]
    year, week = _latest_ems_week()
    layers = {}
    for token, band, key in (("FDD850", "FDD-LTE850", "fdd_850_sites_info"), ("TDD2300", "TDD-LTE2300", "tdd_2300_sites_info"),
                             ("TDD2600", "TDD-LTE2600", "tdd_2600_sites_info")):
        ids = [s["Site_ID"] for s in sites if token in s["Rollout"]]
        prb = None
        if ids:
            prb = db.scalar(f"""SELECT round(avg(e.DL_PRB_Utilization), 2) FROM {EMS_UNION} e
                JOIN Cell4G c ON c.Cell_Name = e.cell_name
                WHERE c.Freq_Band = ? AND e.Year = ? AND e.Week_No = ? AND c.Site_ID IN ({','.join('?' * len(ids))})""",
                            [band, year, week] + ids)
        layers[key] = {"total_sites": len(ids), "average_dl_prb_utilization": prb}
    vals = [r["rsrp_avg"] for r in inside if r["rsrp_avg"] is not None]
    cats = [r["rsrp_category"] for r in inside]
    n = len(inside) or 1
    summary = {
        "area": label, "bin_count": len(inside), "observation_range": f"{wk['year']}{wk['weekly_id']:02d}",
        "avg_rsrp": round(sum(vals) / len(vals), 2) if vals else None,
        "avg_rsrq": round(sum(r["rsrq_avg"] for r in inside if r["rsrq_avg"] is not None) / max(len(vals), 1), 2) if vals else None,
        "avg_download_mbps": round(sum(r["avg_download_mbps"] or 0 for r in inside) / n, 2) if inside else None,
        "rsrp_category_pct": {c: round(cats.count(c) / n * 100, 1) for c in ("Good", "Moderate", "Poor", "No Sample")},
        **layers,
    }
    return {"mode": m, "summary": summary, **db.paginate_list(inside, page, page_size)}


def get_bin_network_elements(
    entity: Literal["site", "cell"],
    site_id: Annotated[str | None, Field(description="Site ID, or comma-separated list")] = None,
    tdd_site_id: Annotated[str | None, Field(description="TDD site ID, or comma-separated list (entity=site)")] = None,
    status: Annotated[str | None, Field(description="Operational, Out of Service, Congested, Plan Maintenance")] = None,
    page: Page = 1,
    page_size: PageSize = 100,
) -> dict:
    """Get 4G network elements shown in the BIN view: entity=site returns Site4G rows (vendor, type, rollout, region,
    cluster, eNodeB, TAC, morphology, coordinates, address, status, owner); entity=cell returns Cell4G rows (cell
    name/ID, ECI, band, antenna, azimuth, tilt, PCI, RS power). Filter by site_id, tdd_site_id, status. Paginated."""
    e = entity.lower()
    where, params = [], []
    ids = csv_list(site_id)
    if ids:
        where.append(f"Site_ID IN ({','.join('?' * len(ids))})")
        params += ids
    if e == "site":
        tdd = csv_list(tdd_site_id)
        if tdd:
            where.append(f"TDD_Site_ID IN ({','.join('?' * len(tdd))})")
            params += tdd
        if status:
            where.append("Status ILIKE ?")
            params.append(status.strip())
        sql = "SELECT * EXCLUDE (ZBC_Border, TM_Exchange, Exchange_ABB) FROM Site4G"
        order = "Site_ID"
    elif e == "cell":
        if status or tdd_site_id:
            raise ValidationError("'status' and 'tdd_site_id' apply to entity=site only")
        sql = "SELECT * EXCLUDE (Radius, Bandwidth, Sector_ID) FROM Cell4G"
        order = "Site_ID, Cell_Name"
    else:
        raise ValidationError("'entity' must be site or cell")
    sql += (" WHERE " + " AND ".join(where)) if where else ""
    result = db.paginate(sql, params, page, page_size, order_by=order)
    result["items"] = [snake(r) for r in result["items"]]
    return {"entity": e, **result}


TOOLS = [
    get_bin_polygons, search_bins, get_bin_kpi_values, get_bin_info, get_bin_places, get_cell_details,
    get_bins_in_area, get_bin_network_elements,
]
