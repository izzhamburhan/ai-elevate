"""Coverage, sites, NTT, maintenance, congestion and dashboard tools
(map API / THD reporting / BIN visualisation summary)."""

import datetime as dt
import re
from typing import Annotated, Literal

from pydantic import Field

from netops_mcp import db, geo
from netops_mcp.errors import NotFoundError, ValidationError
from netops_mcp.tools.common import (
    Boundary, DateStr, Page, PageSize, RadiusKm, day_bounds, need_point, parse_date, pct_delta, radius_filter,
    snake, window,
)

REGIONS = ["Central", "Northern", "Southern", "Eastern", "Sabah", "Sarawak"]

COVERAGE_COLLECTIONS = {
    "fdd": "Coverage_FDD", "tdd": "Coverage_TDD", "5g": "Coverage_5G", "mocn": "Coverage_MOCN", "hwc": "HWC",
}
CONGESTION_COLLECTIONS = {"fdd": "Congestion_FDD", "tdd": "Congestion_TDD"}


# ---------------------------------------------------------------------------
# Layers
# ---------------------------------------------------------------------------
def _parse_week(week: str | int | None, available: list[dict]) -> dict:
    if not available:
        raise NotFoundError("Data is not available")
    if week in (None, ""):
        return available[0]
    text = str(week).strip().upper()
    m = re.fullmatch(r"(\d{4})[-_ ]?W?(\d{1,2})", text)
    if m:
        y, w = int(m.group(1)), int(m.group(2))
    elif re.fullmatch(r"W?\d{1,2}", text):
        y, w = None, int(text.lstrip("W"))
    else:
        raise ValidationError("'week' must be a week number (e.g. 40) or 'YYYY-Www' (e.g. 2026-W40)")
    for a in available:
        if a["week"] == w and (y is None or a["year"] == y):
            return a
    raise NotFoundError(f"Week {week} is not available. Available: {', '.join(a['label'] for a in available)}")


def _layer(collection: str, week, boundary: Boundary | None, max_features: int) -> dict:
    weeks = db.query(
        "SELECT DISTINCT Year AS year, Week AS week FROM coverage_layers WHERE collection = ? ORDER BY year DESC, week DESC",
        [collection])
    for w in weeks:
        monday = dt.date.fromisocalendar(w["year"], w["week"], 1)
        w.update(label=f"{w['year']}-W{w['week']:02d}", start_date=monday.isoformat(),
                 end_date=(monday + dt.timedelta(days=6)).isoformat())
    chosen = _parse_week(week, weeks)
    where, params = "collection = ? AND Year = ? AND Week = ?", [collection, chosen["year"], chosen["week"]]
    if boundary:
        min_lat, max_lat, min_lng, max_lng = boundary.bbox()
        where += " AND max_lat >= ? AND min_lat <= ? AND max_lng >= ? AND min_lng <= ?"
        params += [min_lat, max_lat, min_lng, max_lng]
    total = db.scalar(f"SELECT COUNT(*) FROM coverage_layers WHERE {where}", params)
    rows = db.query(f"SELECT site_id, Name, Action, Target, geometry FROM coverage_layers WHERE {where} "
                    f"ORDER BY id LIMIT ?", params + [max_features])
    features = []
    for r in rows:
        props = {"site_id": r["site_id"]}
        if collection == "HWC":
            props.update(name=r["Name"], action=r["Action"], target=r["Target"])
        elif r["Name"]:
            props["cell_name"] = r["Name"]
        features.append(geo.feature(r["geometry"], props))
    return {
        "collection": collection,
        "week": chosen,
        "available_weeks": [w["label"] for w in weeks],
        "feature_count": len(features),
        "total_features": total,
        "truncated": total > len(features),
        "geojson": geo.feature_collection(features),
    }


MaxFeatures = Annotated[int, Field(ge=1, le=5000, description="Cap on returned polygons.")]
WeekParam = Annotated[str | None, Field(description="ISO week: '40' or '2026-W40'. Omit for the latest week.")]


def get_coverage_layer(
    technology: Literal["fdd", "tdd", "5g", "mocn", "hwc"],
    week: WeekParam = None,
    boundary: Boundary | None = None,
    max_features: MaxFeatures = 1500,
) -> dict:
    """Get a weekly coverage layer as GeoJSON polygons for technology fdd, tdd, 5g, mocn or hwc (hot/warm cells with
    name/action/target). Omit `week` for the latest week; `week` and `available_weeks` in the response drive a week
    picker. Optional `boundary` (four 'lat,lng' corners) clips to a viewport."""
    tech = technology.lower()
    if tech not in COVERAGE_COLLECTIONS:
        raise ValidationError("'technology' must be one of: fdd, tdd, 5g, mocn, hwc")
    return {"technology": tech, **_layer(COVERAGE_COLLECTIONS[tech], week, boundary, max_features)}


def get_congestion_layer(
    duplex: Literal["fdd", "tdd"],
    week: WeekParam = None,
    boundary: Boundary | None = None,
    max_features: MaxFeatures = 1500,
) -> dict:
    """Get a weekly congestion layer as GeoJSON sector polygons of congested cells for duplex mode fdd or tdd.
    Omit `week` for the latest week; the response includes `week` and `available_weeks`. Optional `boundary`
    (four 'lat,lng' corners) clips to a viewport."""
    d = duplex.lower()
    if d not in CONGESTION_COLLECTIONS:
        raise ValidationError("'duplex' must be fdd or tdd")
    return {"duplex": d, **_layer(CONGESTION_COLLECTIONS[d], week, boundary, max_features)}


def get_coverage_boxes() -> dict:
    """Get the dashboard coverage box values: population coverage (%, with and without MOCN), 4G availability,
    5G coverage, industry benchmarks and total RFS site counts (4G+MOCN, Unifi Mobile, 5G DNB)."""
    row = db.query_one("SELECT * FROM Coverage_Boxes ORDER BY id LIMIT 1")
    if not row:
        raise NotFoundError("Coverage boxes not available")
    return row


# ---------------------------------------------------------------------------
# Sites
# ---------------------------------------------------------------------------
SITE_SQL = {
    "4g": """SELECT Site_ID AS site_id, Site_Name AS site_name, '4G' AS technology, Latitude AS latitude,
                    Longitude AS longitude, Type_Map AS type_map, Status AS status, Region AS region,
                    Cluster_ID AS cluster_id, Cluster_Name AS cluster, Vendor AS vendor FROM Site4G""",
    "5g": """SELECT Site_ID, Site_Name, '5G', Latitude, Longitude, Type_Map, Status, Region, Cluster_ID,
                    District, 'Ericsson' FROM Site5G""",
    "mocn": """SELECT Site_ID, eNobeB_Name, 'MOCN', Latitude, Longitude, Type_Map, NULL, Region, NULL, Cluster,
                      Vendor FROM SiteMOCN""",
    "3g": """SELECT Site_ID, Sitename, '3G', Latitude, Longitude, Type_Map, NULL, Region, NULL,
                    split_part(Sitename, '_', 1), Vendor FROM Site3G""",
    "2g": """SELECT Site_ID, Sitename, '2G', Latitude, Longitude, Type_Map, NULL, Region, NULL,
                    split_part(Sitename, '_', 1), Vendor FROM Site2G""",
    "aop": """SELECT site_id, site_name, 'AOP', latitude, longitude, type_map,
                     COALESCE(status, pmo_summary), region, NULL, target_quarter, NULL FROM SiteAOP
              WHERE COALESCE(status, '') <> 'RFS' AND COALESCE(latitude, 0) <> 0 AND COALESCE(longitude, 0) <> 0""",
}
SITE_COLS = "site_id, site_name, technology, latitude, longitude, type_map, status, region, cluster_id, cluster, vendor"


def _sites_sql(tech: str) -> str:
    return f"SELECT * FROM ({SITE_SQL[tech]}) _s({SITE_COLS})"


def get_sites(
    technology: Literal["mocn", "5g", "4g", "3g", "2g", "aop"],
    region: Annotated[str | None, Field(description="Region: Central, Northern, Southern, Eastern, Sabah, Sarawak")] = None,
    cluster: Annotated[str | None, Field(description="Cluster ID or name (partial match)")] = None,
    page: Page = 1,
    page_size: PageSize = 200,
) -> dict:
    """List sites as map points (site_id, site_name, latitude, longitude, type_map, status, region, cluster, vendor)
    for technology mocn, 5g, 4g, 3g, 2g or aop (planned, not yet RFS). Filter by region and/or cluster.
    Paginated with page/page_size; returns total."""
    tech = technology.lower()
    if tech not in SITE_SQL:
        raise ValidationError("'technology' must be one of: mocn, 5g, 4g, 3g, 2g, aop")
    where, params = [], []
    if region:
        where.append("region ILIKE ?")
        params.append(f"%{region.strip()}%")
    if cluster:
        where.append("(cluster ILIKE ? OR cluster_id ILIKE ?)")
        params += [f"%{cluster.strip()}%"] * 2
    sql = _sites_sql(tech) + (" WHERE " + " AND ".join(where) if where else "")
    return db.paginate(sql, params, page, page_size, order_by="site_id")


def search_sites(
    site_id: Annotated[str, Field(description="Full or partial site ID or site name, e.g. 'CB0' or 'KLCC'")],
    page: Page = 1,
    page_size: PageSize = 50,
) -> dict:
    """Search sites of every technology by site ID or name (case-insensitive partial match). Returns site_id,
    site_name, technology, latitude, longitude, region and cluster. Paginated with page/page_size; returns total."""
    term = (site_id or "").strip()
    if len(term) < 2:
        raise ValidationError("'site_id' needs at least 2 characters")
    union = " UNION ALL ".join(_sites_sql(t) for t in ("4g", "5g", "mocn", "3g", "2g"))
    sql = f"SELECT * FROM ({union}) WHERE site_id ILIKE ? OR site_name ILIKE ?"
    return db.paginate(sql, [f"%{term}%"] * 2, page, page_size, order_by="site_id, technology")


SITE_INFO_TABLE = {"4g": "Site4G", "5g": "Site5G", "mocn": "SiteMOCN", "3g": "Site3G", "2g": "Site2G"}
CELL_TABLE = {"4g": "Cell4G", "5g": "Cell5G", "mocn": "CellMOCN", "3g": "Cell3G", "2g": "Cell2G"}
TechParam = Literal["mocn", "5g", "4g", "3g", "2g"]


def get_site_info(technology: TechParam, site_id: str) -> dict:
    """Get full inventory detail for one site by technology (mocn, 5g, 4g, 3g, 2g) and site_id: vendor, type,
    region, state, cluster, eNodeB/gNodeB ID, TAC, coordinates, address, status and the number of cells."""
    tech = technology.lower()
    if tech not in SITE_INFO_TABLE:
        raise ValidationError("'technology' must be one of: mocn, 5g, 4g, 3g, 2g")
    row = db.query_one(f"SELECT * FROM {SITE_INFO_TABLE[tech]} WHERE upper(Site_ID) = upper(?)", [site_id])
    if not row:
        raise NotFoundError(f"{tech.upper()} site '{site_id}' not found")
    row = snake(row)
    row["cell_count"] = db.scalar(f"SELECT COUNT(*) FROM {CELL_TABLE[tech]} WHERE upper(Site_ID) = upper(?)", [site_id])
    return {"technology": tech, **row}


def get_site_cells(technology: TechParam, site_id: str, page: Page = 1, page_size: PageSize = 50) -> dict:
    """Get the cells of a site by technology (mocn, 5g, 4g, 3g, 2g) and site_id, e.g. cell name/ID, ECI, frequency
    band, azimuth, antenna height, tilt, PCI and RS power for 4G. Paginated with page/page_size; returns total."""
    tech = technology.lower()
    if tech not in CELL_TABLE:
        raise ValidationError("'technology' must be one of: mocn, 5g, 4g, 3g, 2g")
    if not db.scalar(f"SELECT COUNT(*) FROM {SITE_INFO_TABLE[tech]} WHERE upper(Site_ID) = upper(?)", [site_id]):
        raise NotFoundError(f"{tech.upper()} site '{site_id}' not found")
    result = db.paginate(f"SELECT * FROM {CELL_TABLE[tech]} WHERE upper(Site_ID) = upper(?)", [site_id],
                         page, page_size, order_by="2")
    result["items"] = [snake(r) for r in result["items"]]
    return result


def get_best_server(
    technology: Literal["2g3g", "4g"],
    lat: Annotated[float, Field(ge=-90, le=90)],
    lng: Annotated[float, Field(ge=-180, le=180)],
) -> dict:
    """Get the best serving site for a coordinate. technology=2g3g returns the nearest 2G and 3G sites within
    ~2.2 km; technology=4g returns the serving 4G cell (TDD2300 > TDD2600 > FDD priority, then MOCN fallback)
    with its site, cell ID, layer type and distance in km."""
    tech = technology.lower()
    if tech == "2g3g":
        out = []
        for t, table in (("2G", "Site2G"), ("3G", "Site3G")):
            clause, params = radius_filter("Latitude", "Longitude", lat, lng, 2.2)
            row = db.query_one(f"""SELECT DISTINCT Site_ID AS site_id, Latitude AS latitude, Longitude AS longitude,
                round(haversine_km(?, ?, Latitude, Longitude), 3) AS distance_km, '{t}' AS technology
                FROM {table} WHERE {clause} ORDER BY distance_km LIMIT 1""", [lat, lng] + params)
            if row:
                out.append(row)
        return {"lat": lat, "lng": lng, "servers": out}
    if tech != "4g":
        raise ValidationError("'technology' must be 2g3g or 4g")
    clause, params = radius_filter("s.Latitude", "s.Longitude", lat, lng, 5)
    cells = db.query(f"""
        SELECT s.Site_ID AS site_id, s.Latitude AS latitude, s.Longitude AS longitude, c.Site_Cell_ID AS cell_id,
               c.Freq_Band, c.Azimuth, c.Radius, s.Type_Map,
               haversine_km(?, ?, s.Latitude, s.Longitude) AS d
        FROM Site4G s JOIN Cell4G c ON c.Site_ID = s.Site_ID WHERE {clause} ORDER BY d""", [lat, lng] + params)
    for band, layer in (("TDD-LTE2300", "TDD2300"), ("TDD-LTE2600", "TDD2600"), ("FDD-LTE850", "FDD")):
        for c in cells:
            if c["Freq_Band"] != band or c["d"] > c["Radius"]:
                continue
            if c["Type_Map"] == "Macro":
                diff = abs((geo.bearing(c["latitude"], c["longitude"], lat, lng) - c["Azimuth"] + 180) % 360 - 180)
                if diff > 60:
                    continue
            return {"lat": lat, "lng": lng, "servers": [{
                "site_id": c["site_id"], "latitude": c["latitude"], "longitude": c["longitude"],
                "cell_id": c["cell_id"], "type": layer, "distance_km": round(c["d"], 3)}]}
    clause, params = radius_filter("Latitude", "Longitude", lat, lng, 4)
    m = db.query_one(f"""SELECT Site_ID AS site_id, Latitude AS latitude, Longitude AS longitude,
            round(haversine_km(?, ?, Latitude, Longitude), 3) AS distance_km FROM SiteMOCN WHERE {clause}
            ORDER BY distance_km LIMIT 1""", [lat, lng] + params)
    if m:
        return {"lat": lat, "lng": lng, "servers": [{**m, "cell_id": f"{m['site_id']}_1", "type": "MOCN"}]}
    return {"lat": lat, "lng": lng, "servers": []}


def get_total_site_number() -> dict:
    """Get the total number of MOCN, 4G and 5G sites."""
    return {
        "total_site_mocn": db.scalar("SELECT COUNT(*) FROM SiteMOCN"),
        "total_site4g": db.scalar("SELECT COUNT(*) FROM Site4G"),
        "total_site5g": db.scalar("SELECT COUNT(*) FROM Site5G"),
    }


def _region_site_totals() -> dict:
    out = {r.lower(): db.scalar("SELECT COUNT(*) FROM Site4G WHERE Region ILIKE ?", [f"%{r}%"]) for r in REGIONS}
    out["total_4g_site"] = sum(out.values())
    return out


def get_site4g_region_totals() -> dict:
    """Get the number of 4G sites per region (sarawak, sabah, eastern, southern, northern, central) and the
    national total."""
    return _region_site_totals()


# ---------------------------------------------------------------------------
# CTT
# ---------------------------------------------------------------------------
def get_ctt_summary(
    scope: Literal["total", "cluster", "subscriber_percentage"],
    year: Annotated[int | None, Field(ge=2000, le=2100, description="4-digit year; defaults to the latest year")] = None,
) -> dict:
    """Get customer trouble ticket (CTT) figures. scope=total: year-to-date CTT at the latest week vs the
    previous week with difference and delta %. scope=cluster: CTT count per region for the year.
    scope=subscriber_percentage: monthly subscriber and CTT growth %, plus overall total CTT."""
    s = scope.lower()
    if s == "total":
        latest = db.query_one("SELECT CreatedOn, Week FROM THD ORDER BY CreatedOn DESC LIMIT 1")
        if not latest:
            return {"latest_available_data_week": None, "total_current_ctt": None, "total_previous_week_ctt": None,
                    "difference_current_previous_week_ctt": None, "delta_current_previous_week_ctt": None}
        last = latest["CreatedOn"].date()
        y = year or last.year
        if year and year != last.year:
            last = dt.date(year, 12, 31)
        start = dt.datetime(y, 1, 1)
        cur = db.scalar("SELECT COUNT(*) FROM THD WHERE CreatedOn BETWEEN ? AND ?",
                        [start, dt.datetime.combine(last, dt.time(23, 59, 59))])
        prev = db.scalar("SELECT COUNT(*) FROM THD WHERE CreatedOn BETWEEN ? AND ?",
                         [start, dt.datetime.combine(last - dt.timedelta(days=7), dt.time(23, 59, 59))])
        return {"year": y, "latest_available_data_week": latest["Week"] if not year or year == last.year else 52,
                "latest_available_date": last.isoformat(), "total_current_ctt": cur, "total_previous_week_ctt": prev,
                "difference_current_previous_week_ctt": cur - prev,
                "delta_current_previous_week_ctt": pct_delta(cur, prev)}
    if s == "cluster":
        y = year or db.ref_date().year
        out = {r.lower(): db.scalar("SELECT COUNT(*) FROM THD WHERE year(CreatedOn) = ? AND Region ILIKE ?",
                                    [y, f"%{r}%"]) for r in REGIONS}
        return {"year": y, **out}
    if s == "subscriber_percentage":
        params = [year] if year else []
        rows = db.query("SELECT * FROM Subscribers" + (" WHERE year = ?" if year else "") + " ORDER BY SubscribersID",
                        params)
        items = []
        for r in rows:
            m, y = r["month_number"], r["year"]
            pm, py = (12, y - 1) if m == 1 else (m - 1, y)
            prev_abbr = dt.date(py, pm, 1).strftime("%b").upper()
            items.append({"month": f"{prev_abbr}-{str(py)[2:]} to {r['month_abbreviation']}-{str(y)[2:]}",
                          "subscribers_percentage": r["Subscriber"], "ctt_percentage": r["Ctt"],
                          "total_subscribers": r["Total Subscribers"], "total_ctt": r["Total CTT"]})
        return {"subscriber_and_ctt_percentage": items,
                "overall_total_ctt": sum(r["Total CTT"] for r in rows)}
    raise ValidationError("'scope' must be total, cluster or subscriber_percentage")


# ---------------------------------------------------------------------------
# NTT
# ---------------------------------------------------------------------------
NTT4G_LATEST = """
    SELECT * FROM ntt_granite WHERE id IN (
        SELECT max(id) FROM ntt_granite
        WHERE resp_unit ILIKE '%LTE 4G%' AND fault_category IN ('Total Outage', 'Partial Outage')
        GROUP BY ntt_no)"""
NTT4G_SELECT = f"""
    SELECT n.id, n.ntt_no AS ntt_num, n.status AS ntt_status, n.fault_category AS faulty_category,
           n.major_breakdown, n.service_impacted AS service_impact, n.resp_unit AS network_domain,
           n.region, n.ptt AS state, n.network_element_ne_id AS ne_id, n.network_element_type AS ne_type,
           n.network_element_brand AS iticket_ne_brand, n.problem_desc AS problem_description,
           n.possible_symptoms AS possible_symptom, n.faulty_severity AS faults_long, n.ettr,
           n.created_date AS ntt_created_date, s.Site_ID AS site_id, s.Latitude AS latitude, s.Longitude AS longitude
    FROM ({NTT4G_LATEST}) n LEFT JOIN Site4G s ON s.Site_ID = split_part(n.network_element_ne_id, ',', 1)"""
NTT5G_LATEST = "SELECT * FROM ntt_5g_ntt5g WHERE id IN (SELECT max(id) FROM ntt_5g_ntt5g GROUP BY tm_incident_id)"
NTT5G_SELECT = f"""
    SELECT n.id, n.tm_incident_id, n.dnb_incident_id, n.incident_status, n.incident_priority, n.incident_urgency,
           n.incident_type, n.summary, n.incident_description, n.hpd_ci, n.assigned_group, n.region,
           n.incident_categorization_tier1, n.resolution_note, n.event_start_time, n.event_end_time,
           n.last_modified_date, s.Site_ID AS site_id, s.Latitude AS latitude, s.Longitude AS longitude
    FROM ({NTT5G_LATEST}) n LEFT JOIN Site5G s ON s.Site_ID = n.hpd_ci"""
OPEN_5G = ("Assigned", "Pending", "In Progress")


def _ntt_query(tech, status, start, end, site_id, radius, current_lat, current_long):
    if tech == "4g":
        base, date_col, status_col = NTT4G_SELECT, "ntt_created_date", "ntt_status"
        open_sql = f"{status_col} = 'Open'"
    else:
        base, date_col, status_col = NTT5G_SELECT, "event_start_time", "incident_status"
        open_sql = f"{status_col} IN {OPEN_5G}"
    where, params = [f"{date_col} BETWEEN ? AND ?"], list(day_bounds(start, end))
    if status:
        st = status.lower()
        if st == "open":
            where.append(open_sql)
        elif st == "closed":
            where.append(f"NOT ({open_sql})")
        elif st != "all":
            raise ValidationError("'status' must be open, closed or all")
    if site_id:
        col = "ne_id" if tech == "4g" else "hpd_ci"
        where.append(f"{col} ILIKE ?")
        params.append(f"%{site_id.strip()}%")
    pt = need_point(current_lat, current_long, "current_lat/current_long")
    select = f"SELECT * FROM ({base}) t"
    if pt:
        r = radius or 2.0
        clause, p = radius_filter("latitude", "longitude", pt[0], pt[1], r)
        where.append(clause)
        params += p
        select = (f"SELECT *, round(haversine_km({pt[0]}, {pt[1]}, latitude, longitude), 3) AS distance_km "
                  f"FROM ({base}) t")
    return f"{select} WHERE " + " AND ".join(where), params, open_sql


def get_ntt_tickets(
    technology: Literal["4g", "5g"],
    status: Annotated[Literal["open", "closed", "all"] | None, Field(description="Default all")] = None,
    start_date: DateStr = None,
    end_date: DateStr = None,
    site_id: str | None = None,
    radius: RadiusKm = None,
    current_lat: float | None = None,
    current_long: float | None = None,
    page: Page = 1,
    page_size: PageSize = 50,
) -> dict:
    """Get network trouble tickets (NTT) for 4G (outage tickets, latest update per NTT) or 5G (DNB incidents) with
    the affected site's latitude/longitude. Defaults to the last 30 days. Filter by status (open/closed), site_id,
    or radius in km around current_lat/current_long (default 2 km). Paginated; returns total and open/closed counts."""
    tech = technology.lower()
    if tech not in ("4g", "5g"):
        raise ValidationError("'technology' must be 4g or 5g")
    start, end = window(start_date, end_date, 30)
    sql, params, open_sql = _ntt_query(tech, status, start, end, site_id, radius, current_lat, current_long)
    order = "ntt_created_date DESC" if tech == "4g" else "event_start_time DESC"
    result = db.paginate(sql, params, page, page_size, order_by=order)
    counts = db.query_one(f"SELECT count(*) FILTER (WHERE {open_sql}) AS open_count, "
                          f"count(*) FILTER (WHERE NOT ({open_sql})) AS closed_count FROM ({sql}) q", params)
    return {"technology": tech, "start_date": start.isoformat(), "end_date": end.isoformat(), **counts, **result}


SIGNIFICATION = [(0.6, "Excellent"), (1.1, "Average"), (1.6, "Poor")]


def get_ntt_summary(
    scope: Literal["total", "mocn_5g", "region", "region_detail", "cluster"],
    duration: Annotated[Literal["daily", "weekly", "annually"] | None, Field(description="Default weekly")] = None,
    region_name: str | None = None,
    start_date: DateStr = None,
    end_date: DateStr = None,
    site_id: str | None = None,
    radius: RadiusKm = None,
    current_lat: float | None = None,
    current_long: float | None = None,
) -> dict:
    """Get NTT summary figures. scope=total: 4G outage NTTs in the current vs previous period (daily or weekly) with
    difference/delta % and open count. mocn_5g: same for 5G DNB incidents. region: open 4G NTTs per region.
    region_detail: open 4G tickets for region_name (default Central). cluster: open NTT per region against 4G site
    count with a signification legend (Excellent/Average/Poor/Bad). Optional site_id or radius filters for 4G."""
    s = scope.lower()
    dur = (duration or "weekly").lower()
    ref = db.ref_date()
    days = {"daily": 1, "weekly": 7, "annually": 365}.get(dur)
    if not days:
        raise ValidationError("'duration' must be daily, weekly or annually")
    e = parse_date(end_date, "end_date") or ref
    cur_start = parse_date(start_date, "start_date") or e - dt.timedelta(days=days - 1)
    if cur_start > e:
        raise ValidationError("'start_date' must be on or before 'end_date'")
    prev_end = cur_start - dt.timedelta(days=1)
    prev_start = prev_end - (e - cur_start)
    interval = {"start": cur_start.isoformat(), "end": e.isoformat(),
                "previous_start": prev_start.isoformat(), "previous_end": prev_end.isoformat()}

    def count4g(a, b, status=None, region=None):
        sql, params, _ = _ntt_query("4g", status, a, b, site_id, radius, current_lat, current_long)
        if region:
            sql = f"SELECT * FROM ({sql}) r WHERE region ILIKE ?"
            params = params + [f"%{region}%"]
        return db.scalar(f"SELECT COUNT(*) FROM ({sql}) c", params)

    far_past = ref - dt.timedelta(days=3650)
    if s == "total":
        cur, prev = count4g(cur_start, e), count4g(prev_start, prev_end)
        return {"scope": s, "duration": dur, "interval": interval, "total_current_ntt": cur, "total_previous_ntt": prev,
                "difference_current_previous_ntt": cur - prev, "delta_current_previous_ntt": pct_delta(cur, prev),
                "open_ntt": count4g(far_past, ref, "open")}
    if s == "mocn_5g":
        def c5(a, b, only_open=False):
            sql, params, _ = _ntt_query("5g", "open" if only_open else None, a, b, None, None, None, None)
            return db.scalar(f"SELECT COUNT(*) FROM ({sql}) c", params)
        cur, prev = c5(cur_start, e), c5(prev_start, prev_end)
        return {"scope": s, "duration": dur, "interval": interval, "total_current_ntt": cur, "total_previous_ntt": prev,
                "difference_current_previous_ntt": cur - prev, "delta_current_previous_ntt": pct_delta(cur, prev),
                "open_ntt": c5(far_past, ref, True)}
    if s == "region":
        out = {r.lower(): count4g(far_past, ref, "open", r) for r in REGIONS}
        return {"scope": s, "status": "open", "total_current_ntt": sum(out.values()), **out}
    if s == "region_detail":
        region = region_name or "Central"
        sql, params, _ = _ntt_query("4g", "open", far_past, ref, site_id, radius, current_lat, current_long)
        rows = db.query(f"SELECT * FROM ({sql}) r WHERE region ILIKE ? ORDER BY ntt_created_date DESC",
                        params + [f"%{region}%"])
        return {"scope": s, "region": region, "total": len(rows), "tickets": rows}
    if s == "cluster":
        sites = _region_site_totals()
        a = ref - dt.timedelta(days=1) if dur == "daily" else dt.date(ref.year, 1, 1) if dur == "annually" else ref - dt.timedelta(days=6)
        details = {}
        for r in REGIONS:
            n = count4g(a, ref, "open", r)
            pct = n / sites[r.lower()] * 100 if sites[r.lower()] else 0
            label = next((lbl for lim, lbl in SIGNIFICATION if pct < lim), "Bad")
            details[r.lower()] = {"total_ntt": n, "total_sites": sites[r.lower()], "ntt_percentage": round(pct, 2),
                                  "signification": label}
        return {"scope": s, "duration": dur, "interval": {"start": a.isoformat(), "end": ref.isoformat()},
                "ntt_info_details": details,
                "legend_details": {"Excellent": "< 0.6%", "Average": "0.6% - 1.1%", "Poor": "1.1% - 1.6%",
                                   "Bad": ">= 1.6%"}}
    raise ValidationError("'scope' must be total, mocn_5g, region, region_detail or cluster")


# ---------------------------------------------------------------------------
# Planned maintenance
# ---------------------------------------------------------------------------
PM_SEARCH_COLS = ['"RFC ID"', "Hostname", "Title", "p.Region", "p.Status", '"Requester Name"', '"Requestor Division"',
                  '"RFC Type"', "Reason", '"Sub Network"']


def get_plan_maintenance(
    site: str | None = None,
    search: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    radius: RadiusKm = None,
    page: Page = 1,
    page_size: PageSize = 50,
) -> dict:
    """Get planned maintenance RFCs, newest first, with the host site's latitude/longitude and an `active_now` flag
    (status WIMPLEMENTER, CA, window covering today). Filter by site (hostname), free-text search, or radius in km
    around lat/lng (default 2 km). Paginated with page/page_size; returns total."""
    now = dt.datetime.combine(db.ref_date(), dt.time(12))
    where, params = [], []
    pt = need_point(lat, lng)
    if pt:
        clause, p = radius_filter("s.Latitude", "s.Longitude", pt[0], pt[1], radius or 2.0)
        where.append(clause)
        params += p
    elif site:
        where.append("Hostname ILIKE ?")
        params.append(f"%{site.strip()}%")
    if search:
        where.append("(" + " OR ".join(f"CAST({c} AS VARCHAR) ILIKE ?" for c in PM_SEARCH_COLS) + ")")
        params += [f"%{search.strip()}%"] * len(PM_SEARCH_COLS)
    sql = f"""SELECT p.*, s.Latitude AS latitude, s.Longitude AS longitude,
                (p.Status = 'WIMPLEMENTER' AND p."NCA/CA" = 'CA' AND ? BETWEEN p."Planned Start" AND p."Planned End")
                AS active_now
              FROM Webe_Plan_Maintenance p LEFT JOIN Site4G s ON s.Site_ID = p.Hostname"""
    sql += (" WHERE " + " AND ".join(where)) if where else ""
    result = db.paginate(sql, [now] + params, page, page_size, order_by="Creation_Date DESC")
    result["items"] = [snake(r) for r in result["items"]]
    return result


def get_plan_maintenance_summary(
    duration: Annotated[Literal["weekly", "daily"] | None, Field(description="Default weekly")] = None,
) -> dict:
    """Get planned maintenance totals. weekly: year-to-date RFC count at the latest data date vs 7 days earlier;
    daily: RFCs created on the latest date vs the day before. Includes difference, delta % and active_now count."""
    dur = (duration or "weekly").lower()
    latest = db.query_one("SELECT Creation_Date, Week FROM Webe_Plan_Maintenance ORDER BY Creation_Date DESC LIMIT 1")
    if not latest:
        raise NotFoundError("No planned maintenance data")
    last = latest["Creation_Date"].date()
    if dur == "weekly":
        start = dt.datetime(last.year, 1, 1)
        cur = db.scalar("SELECT COUNT(*) FROM Webe_Plan_Maintenance WHERE Creation_Date BETWEEN ? AND ?",
                        [start, dt.datetime.combine(last, dt.time(23, 59, 59))])
        prev = db.scalar("SELECT COUNT(*) FROM Webe_Plan_Maintenance WHERE Creation_Date BETWEEN ? AND ?",
                         [start, dt.datetime.combine(last - dt.timedelta(days=7), dt.time(23, 59, 59))])
        label = latest["Week"]
    elif dur == "daily":
        cur = db.scalar("SELECT COUNT(*) FROM Webe_Plan_Maintenance WHERE Creation_Date::DATE = ?", [last])
        prev = db.scalar("SELECT COUNT(*) FROM Webe_Plan_Maintenance WHERE Creation_Date::DATE = ?",
                         [last - dt.timedelta(days=1)])
        label = last.isoformat()
    else:
        raise ValidationError("'duration' must be weekly or daily")
    now = dt.datetime.combine(db.ref_date(), dt.time(12))
    active = db.scalar("""SELECT COUNT(*) FROM Webe_Plan_Maintenance WHERE Status = 'WIMPLEMENTER'
                          AND "NCA/CA" = 'CA' AND ? BETWEEN "Planned Start" AND "Planned End" """, [now])
    return {"duration": dur, "latest_available_data": label, "total_latest_plan_maintenance": cur,
            "total_previous_plan_maintenance": prev, "difference_latest_and_previous": cur - prev,
            "delta_percentage": pct_delta(cur, prev), "active_now": active}


# ---------------------------------------------------------------------------
# Congested cells
# ---------------------------------------------------------------------------
CONG_NETWORK = {"all": None, "4g": "4G", "4g_mocn": "4G_MOCN", "5g": "5G"}
CONG_SEARCH = ['"Site ID"', "Site_Cell_ID", '"Cell ID"', '"Site Name"', '"Site Name_Cell"', "c.Region", "c.State",
               "c.Vendor", "Technology", "c.Status", "PIC"]


def get_congested_cells(
    technology: Literal["all", "4g", "4g_mocn", "5g"],
    site: str | None = None,
    search: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    radius: RadiusKm = None,
    page: Page = 1,
    page_size: PageSize = 50,
) -> dict:
    """Get congested cells from the last 28 days of data for technology all, 4g, 4g_mocn or 5g: DL PRB %, user
    throughput (Mbps), active users, remark, action plan, PIC, status, week, and the site's latitude/longitude.
    Filter by site ID, free-text search, or radius in km around lat/lng (default 2 km). Paginated; returns total."""
    tech = technology.lower()
    if tech not in CONG_NETWORK:
        raise ValidationError("'technology' must be all, 4g, 4g_mocn or 5g")
    where = ['c."Created On" > (SELECT max("Created On") FROM Webe_Congested_Cell) - INTERVAL 28 DAY']
    params: list = []
    if CONG_NETWORK[tech]:
        where.append("c.network = ?")
        params.append(CONG_NETWORK[tech])
    pt = need_point(lat, lng)
    if pt:
        clause, p = radius_filter("loc.lat", "loc.lng", pt[0], pt[1], radius or 2.0)
        where.append(clause)
        params += p
    elif site:
        where.append('c."Site ID" ILIKE ?')
        params.append(f"%{site.strip()}%")
    if search:
        where.append("(" + " OR ".join(f"CAST({c} AS VARCHAR) ILIKE ?" for c in CONG_SEARCH) + ")")
        params += [f"%{search.strip()}%"] * len(CONG_SEARCH)
    sql = f"""SELECT c.*, loc.lat AS latitude, loc.lng AS longitude
              FROM Webe_Congested_Cell c
              LEFT JOIN (SELECT Site_ID, Latitude AS lat, Longitude AS lng FROM Site4G
                         UNION ALL SELECT Site_ID, Latitude, Longitude FROM Site5G
                         UNION ALL SELECT Site_ID, Latitude, Longitude FROM SiteMOCN) loc ON loc.Site_ID = c."Site ID"
              WHERE {' AND '.join(where)}"""
    result = db.paginate(sql, params, page, page_size, order_by='"Created On" DESC, id')
    result["items"] = [snake(r) for r in result["items"]]
    return result


TOOLS = [
    get_coverage_layer, get_coverage_boxes, get_sites, search_sites, get_site_info, get_site_cells, get_best_server,
    get_total_site_number, get_ctt_summary, get_ntt_tickets, get_ntt_summary, get_plan_maintenance,
    get_plan_maintenance_summary, get_congested_cells, get_congestion_layer, get_site4g_region_totals,
]
