"""Real Malaysian place search: Overture Maps points of interest and named areas
(data/places_my.parquet, downloaded by `uv run python -m netops_mcp.seed.places`)."""

from typing import Annotated, Literal

from pydantic import Field

from netops_mcp import config, db
from netops_mcp.errors import UpstreamError, ValidationError
from netops_mcp.tools.common import Page, PageSize, RadiusKm, need_point, radius_filter

ATTRIBUTION = "© Overture Maps Foundation, © OpenStreetMap contributors (CDLA-Permissive-2.0 / ODbL)"
COLS = ("id, kind, name, category, taxonomy, brand, address, locality, postcode, state, phone, website, "
        "population, confidence, operating_status, lat, lng")

Kind = Annotated[Literal["any", "place", "area"], Field(
    description="place = points of interest (shops, hospitals, schools, ...); "
                "area = states, districts, towns and neighbourhoods; any = both")]


def _source() -> str:
    if not config.PLACES_PATH.exists():
        raise UpstreamError(f"Place data not found at {config.PLACES_PATH}. Run `uv run python -m netops_mcp.seed.places` first.")
    return "read_parquet('" + str(config.PLACES_PATH).replace("'", "''") + "')"


def _release() -> str | None:
    rows = db.raw("SELECT value FROM parquet_kv_metadata(?) WHERE key = 'overture_release'", [str(config.PLACES_PATH)])
    return bytes(rows[0][0]).decode() if rows else None


def search_locations(
    query: Annotated[str | None, Field(
        description="Name, address or keywords; every word must match, e.g. 'KLCC', 'hospital shah alam', "
                    "'Jalan Ampang', '47301'")] = None,
    category: Annotated[str | None, Field(
        description="Category (partial match), e.g. 'hospital', 'school', 'shopping_mall', 'petrol', 'locality'. "
                    "See list_location_categories.")] = None,
    state: Annotated[str | None, Field(
        description="State or federal territory (partial match), e.g. 'Selangor', 'Kuala Lumpur', 'Sabah'")] = None,
    kind: Kind = "any",
    lat: Annotated[float | None, Field(ge=-90, le=90, description="Centre latitude for a radius search")] = None,
    lng: Annotated[float | None, Field(ge=-180, le=180, description="Centre longitude for a radius search")] = None,
    radius_km: RadiusKm = None,
    page: Page = 1,
    page_size: PageSize = 20,
) -> dict:
    """Search real locations in Malaysia (about 845k points of interest plus states, districts, towns and
    neighbourhoods) by name/address keywords, category, state, and/or distance from lat/lng (default radius 5 km).
    Use it to geocode a place name to coordinates or to find e.g. hospitals near a site. Returns name, kind,
    category, address, state, lat, lng, phone, website (and distance_km for radius searches), best match first.
    Paginated with page/page_size; returns total."""
    words = (query or "").lower().split()
    point = need_point(lat, lng)
    if not words and not category and not point:
        raise ValidationError("Give at least one of 'query', 'category' or 'lat'/'lng'")

    where, params = [], []
    for w in words:
        where.append("contains(search_text, ?)")
        params.append(w)
    if category:
        cat = category.strip().lower().replace(" ", "_")
        where.append("(contains(lower(category), ?) OR contains(lower(taxonomy), ?))")
        params += [cat, cat]
    if state:
        where.append("contains(lower(state), ?)")
        params.append(state.strip().lower())
    if kind != "any":
        where.append("kind = ?")
        params.append(kind)

    select, select_params, order = [COLS], [], []
    if words:
        q = " ".join(words)
        select.append("CASE WHEN lower(name) = ? THEN 0 WHEN starts_with(lower(name), ?) THEN 1 "
                      "WHEN contains(lower(name), ?) THEN 2 ELSE 3 END AS _rank")
        select_params += [q, q, q]
        order += ["_rank", "kind", "population DESC NULLS LAST"]
    if point:
        radius_km = radius_km or 5
        clause, clause_params = radius_filter("lat", "lng", *point, radius_km)
        where.append(clause)
        params += clause_params
        select.append("round(haversine_km(?, ?, lat, lng), 3) AS distance_km")
        select_params += list(point)
        order.append("distance_km")
    order += ["confidence DESC NULLS LAST", "name"]

    sql = (f"SELECT {', '.join(select)} FROM {_source()}"
           + (" WHERE " + " AND ".join(where) if where else ""))
    result = db.paginate(sql, select_params + params, page, page_size, order_by=", ".join(order))
    for item in result["items"]:
        item.pop("_rank", None)
    result["attribution"] = ATTRIBUTION
    return result


def list_location_categories(
    search: Annotated[str | None, Field(description="Filter category names (partial match), e.g. 'hosp'")] = None,
    kind: Kind = "any",
    page: Page = 1,
    page_size: PageSize = 100,
) -> dict:
    """List the location categories usable as search_locations(category=...) with how many Malaysian locations
    each has, most common first. Area categories are region (state), county (district), locality (town),
    macrohood, neighborhood and microhood. Paginated with page/page_size; returns total."""
    where, params = ["category IS NOT NULL"], []
    if search:
        where.append("contains(lower(category), ?)")
        params.append(search.strip().lower().replace(" ", "_"))
    if kind != "any":
        where.append("kind = ?")
        params.append(kind)
    sql = f"SELECT category, kind, count(*) AS count FROM {_source()} WHERE {' AND '.join(where)} GROUP BY ALL"
    result = db.paginate(sql, params, page, page_size, order_by="count DESC, category")
    result.update(overture_release=_release(), attribution=ATTRIBUTION)
    return result


TOOLS = [search_locations, list_location_categories]
