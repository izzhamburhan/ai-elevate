"""Real Malaysian administrative boundaries: country, states, districts and mukim from geoBoundaries
(data/boundaries_my.parquet, downloaded by `uv run python -m netops_mcp.seed.boundaries`).

The polygons are held in a private in-memory DuckDB (spatial extension), loaded on first use and
reloaded when the file changes, so these tools work without the synthetic netops.duckdb."""

import json
import threading
from typing import Annotated, Literal
from urllib.parse import urlencode

import duckdb
from pydantic import Field

from netops_mcp import config, db
from netops_mcp.errors import NotFoundError, UpstreamError, ValidationError
from netops_mcp.geo import feature_collection, parse_latlng
from netops_mcp.tools.common import Page, PageSize

ATTRIBUTION = ("geoBoundaries (www.geoboundaries.org): states © OpenStreetMap contributors (ODbL 1.0); "
               "districts geoBoundaries/citypopulation.de (CC BY 3.0); mukim Wikimedia Commons (CC BY 4.0)")
LEVELS = ("state", "district", "mukim")
NEAREST_DEG = 0.05  # points this close (~5.5 km) outside every polygon, e.g. offshore, get the nearest area
KM_PER_DEG = 111.32
MAX_POINTS = 500
# Simplification tolerance as a fraction of each feature's extent, and output coordinate precision
DETAIL = {"low": (0.01, 0.0001), "medium": (0.002, 0.00001), "full": (0.0, 0.0)}
COLS = "id, level, name, alt_names, iso_code, state, district, area_km2, lat, lng"

Level = Annotated[Literal["state", "district", "mukim"], Field(
    description="state = 16 states and federal territories; district = daerah (159; Putrajaya lies inside Sepang); "
                "mukim = mukim/bandar/pekan, the level below district (~2,040; none for Sabah)")]
Parent = Annotated[str | None, Field(
    description="State or district name the areas must lie in, e.g. 'Selangor', 'Penang', 'Petaling'")]

_lock = threading.RLock()
_con: duckdb.DuckDBPyConnection | None = None
_loaded: float | None = None


def _connection() -> duckdb.DuckDBPyConnection:
    global _con, _loaded
    path = config.BOUNDARIES_PATH
    if not path.exists():
        raise UpstreamError(f"Boundary data not found at {path}. Run `uv run python -m netops_mcp.seed.boundaries` first.")
    if _con is None:
        _con = duckdb.connect()
        try:
            _con.execute("LOAD spatial")
        except duckdb.Error:
            _con.execute("INSTALL spatial; LOAD spatial")
    mtime = path.stat().st_mtime
    if mtime != _loaded:
        _con.execute("CREATE OR REPLACE TABLE b AS SELECT * FROM read_parquet(?)", [str(path)])
        _loaded = mtime
    return _con


def _query(sql: str, params: list | None = None) -> list[dict]:
    with _lock:
        cur = _connection().cursor()
        try:
            cur.execute(sql, params or [])
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
        finally:
            cur.close()


def _match(text: str, levels: tuple[str, ...]) -> list[dict]:
    """Areas whose name or alias matches `text`: exact (case-insensitive) matches if any, else partial."""
    t = text.strip().lower()
    if not t:
        raise ValidationError("Area name must not be empty")
    rows = _query(f"""SELECT {COLS}, lower(name) = ? OR list_contains(string_split(search_text, ' | '), ?) AS exact
                      FROM b WHERE level IN ({', '.join('?' * len(levels))}) AND contains(search_text, ?)""",
                  [t, t, *levels, t])
    exact = [r for r in rows if r.pop("exact")]
    return exact or rows


def _parent_filter(parent: str | None) -> tuple[str, list]:
    if not parent:
        return "", []
    found = _match(parent, ("state", "district"))
    if not found:
        raise NotFoundError(f"No state or district matches '{parent}'. Try list_admin_areas(level='state').")
    states = [r["name"] for r in found if r["level"] == "state"]
    districts = [r["name"] for r in found if r["level"] == "district"]
    return " AND (list_contains(?, state) OR list_contains(?, district))", [states, districts]


def lookup_admin_area(
    lat: Annotated[float | None, Field(ge=-90, le=90, description="Latitude of a single point")] = None,
    lng: Annotated[float | None, Field(ge=-180, le=180, description="Longitude of a single point")] = None,
    points: Annotated[list[str] | None, Field(
        max_length=MAX_POINTS,
        description=f"Several points as 'lat,lng' strings (max {MAX_POINTS}), e.g. ['3.1579,101.7123', "
                    f"'5.4141,100.3288'], instead of lat/lng")] = None,
) -> dict:
    """Find the Malaysian state, district and mukim that contain a point (reverse geocoding to administrative
    areas). Give lat/lng for one point, or `points` to tag many sites in one call. Returns state, state_code
    (ISO 3166-2, e.g. MY-10), district and mukim (null outside Malaysia, and mukim is null in Sabah, which has
    no mukim data). A point up to ~5 km outside every polygon (offshore, coastline) gets the nearest area, with
    the distance in `nearest_km`; treat those as approximate, since near a land border they may actually be in
    Singapore, Thailand, Brunei or Indonesia. State, district and mukim are separate datasets; where they
    disagree (borders, Putrajaya, which the district data includes in Sepang) a `note` says so.
    One point returns the result object; `points` returns {total, items}."""
    if points:
        if lat is not None or lng is not None:
            raise ValidationError("Give either lat/lng or points, not both")
        coords = [parse_latlng(p, f"points[{i}]") for i, p in enumerate(points)]
    elif lat is not None and lng is not None:
        coords = [(float(lat), float(lng))]
    else:
        raise ValidationError("Give lat and lng, or points")

    values = ", ".join("(?, ?, ?)" for _ in coords)
    params = [v for i, (la, ln) in enumerate(coords) for v in (i, la, ln)]
    rows = _query(f"""
        WITH p AS (SELECT i, lat, lng, ST_Point(lng, lat) AS pt FROM (VALUES {values}) v(i, lat, lng)),
        c AS (SELECT p.i, b.level, b.name, b.iso_code, b.state, b.district,
                     ST_Distance(b.geometry, p.pt) AS d, b.area_km2
              FROM p JOIN b ON b.level <> 'country'
               AND p.lng BETWEEN b.min_lng - {NEAREST_DEG} AND b.max_lng + {NEAREST_DEG}
               AND p.lat BETWEEN b.min_lat - {NEAREST_DEG} AND b.max_lat + {NEAREST_DEG})
        SELECT i, level, name, iso_code, state, district, d FROM c WHERE d <= {NEAREST_DEG}
        QUALIFY row_number() OVER (PARTITION BY i, level ORDER BY d, area_km2) = 1""", params)

    results = [{"lat": la, "lng": ln, "state": None, "state_code": None, "district": None, "mukim": None}
               for la, ln in coords]
    parents = {}
    for r in rows:
        out = results[r["i"]]
        out[r["level"]] = r["name"]
        parents[r["i"], r["level"]] = r
        if r["level"] == "state":
            out["state_code"] = r["iso_code"]
        if r["d"] > 0:
            out.setdefault("nearest_km", {})[r["level"]] = round(r["d"] * KM_PER_DEG, 1)
    for i, out in enumerate(results):
        d, m = parents.get((i, "district")), parents.get((i, "mukim"))
        if d and out["state"] and d["state"] != out["state"]:
            out["note"] = f"Boundary datasets disagree here: district {d['name']} belongs to {d['state']}"
        elif m and out["district"] and m["district"] and m["district"] != out["district"]:
            out["note"] = f"Boundary datasets disagree here: mukim {m['name']} belongs to district {m['district']}"
    if points:
        return {"total": len(results), "items": results, "attribution": ATTRIBUTION}
    return {**results[0], "attribution": ATTRIBUTION}


def list_admin_areas(
    level: Level = "district",
    parent: Parent = None,
    search: Annotated[str | None, Field(description="Name or alias (partial match), e.g. 'langat', 'Malacca'")] = None,
    page: Page = 1,
    page_size: PageSize = 100,
) -> dict:
    """List Malaysian administrative areas of one level, optionally only those inside a state or district
    (`parent`) or matching a name (`search`). E.g. all districts of Selangor: level='district', parent='Selangor';
    mukim of Petaling: level='mukim', parent='Petaling'. Returns id, name, alt_names, iso_code, state, district,
    area_km2 and an interior point (lat, lng), ordered by state, district, name. Use the names or ids with
    get_admin_boundary. Paginated with page/page_size; returns total."""
    where, params = "level = ?", [level]
    clause, clause_params = _parent_filter(parent)
    where += clause
    params += clause_params
    if search:
        where += " AND contains(search_text, ?)"
        params.append(search.strip().lower())
    items = _query(f"SELECT {COLS} FROM b WHERE {where} ORDER BY state, district, name", params)
    result = db.paginate_list(items, page, page_size)
    result["attribution"] = ATTRIBUTION
    return result


def get_admin_boundary(
    name: Annotated[str | None, Field(
        description="Area name or alias, e.g. 'Selangor', 'Penang', 'Hulu Langat', 'Mukim Damansara'. "
                    "An exact name match wins over partial matches.")] = None,
    id: Annotated[str | None, Field(description="Area id from list_admin_areas")] = None,
    level: Annotated[Literal["country", "state", "district", "mukim"] | None, Field(
        description="Restrict to one level, e.g. 'district' for the Kuala Lumpur district rather than the "
                    "federal territory. Alone, 'state' returns all 16 states and 'country' the national outline.")] = None,
    parent: Parent = None,
    detail: Annotated[Literal["low", "medium", "full"], Field(
        description="Polygon detail: low (~1% of the area's size, smallest output; fine for maps of many areas), "
                    "medium (~0.2%), full (original survey detail; can be megabytes)")] = "low",
    limit: Annotated[int, Field(ge=1, le=500, description="Maximum features returned")] = 50,
    include_geometry: Annotated[bool, Field(
        description="false = return only the matching areas' properties plus geojson_url (much smaller); "
                    "use it when the polygons are only for drawing on a map")] = True,
) -> dict:
    """Get the boundary polygons of Malaysian administrative areas as a GeoJSON FeatureCollection, by name,
    id, level and/or parent. E.g. the outline of Selangor: name='Selangor'; all districts of Johor:
    level='district', parent='Johor'; all states: level='state'. Feature properties are id, level, name, state,
    district, iso_code, area_km2. To find which area contains a coordinate use lookup_admin_area instead.
    Returns {total, returned, geojson, geojson_url}. To DRAW the areas on a map, call with
    include_geometry=false and give geojson_url to the map's load-data tool as its url (do not copy the
    coordinates into the map tool; the url also allows detail='medium' at no cost)."""
    call_args = {k: v for k, v in dict(name=name, id=id, level=level, parent=parent, detail=detail,
                                       limit=limit).items() if v is not None}
    if not (name or id or parent or level in ("country", "state")):
        raise ValidationError("Give name, id or parent (or level='state' / level='country' alone)")
    levels = (level,) if level else ("country", *LEVELS)
    where, params = [f"level IN ({', '.join('?' * len(levels))})"], list(levels)
    if id:
        where.append("id = ?")
        params.append(id.strip())
    if name:
        ids = [r["id"] for r in _match(name, levels)]
        if not ids:
            raise NotFoundError(f"No {level or 'area'} matches '{name}'. Try list_admin_areas(search=...).")
        where.append("list_contains(?, id)")
        params.append(ids)
    clause, clause_params = _parent_filter(parent)
    if clause:
        where.append(clause.removeprefix(" AND "))
        params += clause_params

    frac, grid = DETAIL[detail]
    geom = "geometry"
    if frac:
        geom = (f"ST_ReducePrecision(ST_SimplifyPreserveTopology(geometry, "
                f"{frac} * greatest(max_lng - min_lng, max_lat - min_lat)), {grid})")
    filt = " AND ".join(where)
    total = _query(f"SELECT count(*) AS n FROM b WHERE {filt}", params)[0]["n"]
    if not total:
        raise NotFoundError("No area matches those filters")
    g = f"ST_AsGeoJSON({geom})" if include_geometry else "NULL"
    rows = _query(f"""SELECT id, level, name, state, district, iso_code, area_km2, {g} AS g
                      FROM b WHERE {filt}
                      ORDER BY list_position(['country', 'state', 'district', 'mukim'], level), state, district, name
                      LIMIT ?""", params + [limit])
    result = {"total": total, "returned": len(rows)}
    if include_geometry:
        result["geojson"] = feature_collection(
            [{"type": "Feature", "geometry": json.loads(r.pop("g")), "properties": r} for r in rows])
    else:
        result["areas"] = [{k: v for k, v in r.items() if k != "g"} for r in rows]
    if config.PUBLIC_URL:
        result["geojson_url"] = f"{config.PUBLIC_URL}/geojson/get_admin_boundary?{urlencode(call_args)}"
    result["attribution"] = ATTRIBUTION
    return result


TOOLS = [lookup_admin_area, list_admin_areas, get_admin_boundary]
