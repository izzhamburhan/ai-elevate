"""Shared helpers for tool modules."""

import datetime as dt
import re
from typing import Annotated

from pydantic import BaseModel, Field

from netops_mcp import config, db, geo
from netops_mcp.errors import NotFoundError, ValidationError

Page = Annotated[int, Field(ge=1, description="Page number, starting at 1.")]
PageSize = Annotated[int, Field(ge=1, le=config.MAX_PAGE_SIZE, description="Rows per page (max 1000).")]
DateStr = Annotated[str | None, Field(description="Date as YYYY-MM-DD.")]
LatLngStr = Annotated[str | None, Field(description="Coordinate as 'lat,lng', e.g. '3.1579,101.7123'.")]
RadiusKm = Annotated[float | None, Field(gt=0, le=200, description="Search radius in km.")]

MSISDN_RE = re.compile(r"^60\d{9,10}$")
IMSI_RE = re.compile(r"^\d{15}$")


class Boundary(BaseModel):
    """Map viewport as four 'lat,lng' corners."""

    northwest: str = Field(description="'lat,lng' of the north-west corner")
    northeast: str = Field(description="'lat,lng' of the north-east corner")
    southeast: str = Field(description="'lat,lng' of the south-east corner")
    southwest: str = Field(description="'lat,lng' of the south-west corner")

    def bbox(self) -> tuple[float, float, float, float]:
        return geo.bbox_from_corners(self.northwest, self.northeast, self.southeast, self.southwest)


def snake(row: dict) -> dict:
    return {re.sub(r"[^0-9a-z]+", "_", k.lower()).strip("_"): v for k, v in row.items()}


def parse_date(value: str | None, name: str) -> dt.date | None:
    if value in (None, ""):
        return None
    try:
        return dt.date.fromisoformat(str(value)[:10])
    except ValueError:
        raise ValidationError(f"'{name}' must be YYYY-MM-DD (got '{value}')")


def window(start: str | None, end: str | None, default_days: int, end_offset: int = 0) -> tuple[dt.date, dt.date]:
    """Resolve an inclusive [start, end] date window around the dataset's ref date."""
    s, e = parse_date(start, "start_date"), parse_date(end, "end_date")
    ref = db.ref_date()
    e = e or (ref - dt.timedelta(days=end_offset))
    s = s or (e - dt.timedelta(days=default_days - 1))
    if s > e:
        raise ValidationError("'start_date' must be on or before 'end_date'")
    return s, e


def day_bounds(s: dt.date, e: dt.date) -> tuple[dt.datetime, dt.datetime]:
    return dt.datetime.combine(s, dt.time()), dt.datetime.combine(e, dt.time(23, 59, 59))


def radius_filter(lat_col: str, lng_col: str, lat: float, lng: float, radius_km: float) -> tuple[str, list]:
    min_lat, max_lat, min_lng, max_lng = geo.bbox_around(lat, lng, radius_km)
    sql = (f"({lat_col} BETWEEN ? AND ? AND {lng_col} BETWEEN ? AND ? "
           f"AND haversine_km(?, ?, {lat_col}, {lng_col}) <= ?)")
    return sql, [min_lat, max_lat, min_lng, max_lng, lat, lng, radius_km]


def need_point(lat, lng, what="lat/lng") -> tuple[float, float] | None:
    if lat is None and lng is None:
        return None
    if lat is None or lng is None:
        raise ValidationError(f"Both coordinates of {what} are required")
    return float(lat), float(lng)


def csv_list(value: str | list | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    return [v.strip() for v in str(value).split(",") if v.strip()]


def check_msisdn(msisdn: str) -> str:
    m = re.sub(r"\D", "", str(msisdn or ""))
    if m and not m.startswith("6"):
        m = "6" + m
    if not MSISDN_RE.match(m):
        raise ValidationError(f"Invalid MSISDN '{msisdn}'. Expected 60 followed by 9-10 digits.")
    return m


def check_imsi(imsi: str) -> str:
    i = str(imsi or "").strip()
    if not IMSI_RE.match(i):
        raise ValidationError(f"Invalid IMSI '{imsi}'. Expected 15 digits.")
    return i


def imsi_for(msisdn: str | None = None, imsi: str | None = None) -> tuple[str, str]:
    """Resolve (imsi, msisdn) from either identifier."""
    if imsi:
        imsi = check_imsi(imsi)
        row = db.query_one("SELECT imsi, msisdn FROM zl_crm WHERE imsi = ?", [imsi])
    elif msisdn:
        msisdn = check_msisdn(msisdn)
        row = db.query_one("SELECT imsi, msisdn FROM zl_crm WHERE msisdn = ?", [msisdn])
    else:
        raise ValidationError("Provide 'msisdn' or 'imsi'")
    if not row:
        raise NotFoundError("Subscriber not found")
    return row["imsi"], row["msisdn"]


def rsrp_category(v: float | None) -> str | None:
    if v is None:
        return None
    if v > -85:
        return "Very Good"
    if v > -95:
        return "Good"
    if v > -105:
        return "Moderate"
    if v > -115:
        return "Bad"
    return "Very Bad"


def pct_delta(cur, prev):
    return round((cur - prev) / prev * 100, 2) if prev else None


def site_location(site_id: str) -> dict | None:
    """Find a site in any technology table."""
    return db.query_one("""
        SELECT * FROM (
            SELECT Site_ID AS site_id, '4G' AS technology, Latitude AS latitude, Longitude AS longitude,
                   Region AS region, Cluster_Name AS cluster FROM Site4G
            UNION ALL SELECT Site_ID, '5G', Latitude, Longitude, Region, Cluster_ID FROM Site5G
            UNION ALL SELECT Site_ID, 'MOCN', Latitude, Longitude, Region, Cluster FROM SiteMOCN
            UNION ALL SELECT Site_ID, '3G', Latitude, Longitude, Region, NULL FROM Site3G
            UNION ALL SELECT Site_ID, '2G', Latitude, Longitude, Region, NULL FROM Site2G
        ) WHERE upper(site_id) = upper(?) LIMIT 1""", [site_id])
