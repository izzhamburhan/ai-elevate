"""Small geometry helpers (no GIS dependency)."""

import json
import math

from netops_mcp.errors import ValidationError

EARTH_KM = 6371.0


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_KM * math.asin(math.sqrt(a))


def bearing(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Initial bearing in degrees from point 1 to point 2."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lng2 - lng1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def parse_latlng(value: str, name: str = "coordinate") -> tuple[float, float]:
    """Parse a "lat,lng" string."""
    try:
        lat_s, lng_s = str(value).split(",")
        lat, lng = float(lat_s), float(lng_s)
    except (ValueError, AttributeError):
        raise ValidationError(f"'{name}' must be a 'lat,lng' string (got '{value}')")
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise ValidationError(f"'{name}' is out of range: {value}")
    return lat, lng


def offset(lat: float, lng: float, bearing_deg: float, dist_km: float) -> tuple[float, float]:
    """Point at a distance and bearing from (lat, lng) — flat-earth, fine at city scale."""
    b = math.radians(bearing_deg)
    dlat = dist_km * math.cos(b) / 110.574
    dlng = dist_km * math.sin(b) / (111.320 * math.cos(math.radians(lat)))
    return lat + dlat, lng + dlng


def circle(lat: float, lng: float, radius_km: float, n: int = 12, jitter=None) -> list[list[float]]:
    """Closed ring of [lng, lat] points."""
    ring = []
    for i in range(n):
        r = radius_km * (jitter() if jitter else 1.0)
        la, ln = offset(lat, lng, 360 * i / n, r)
        ring.append([round(ln, 6), round(la, 6)])
    ring.append(ring[0])
    return ring


def wedge(lat: float, lng: float, azimuth: float, radius_km: float, beamwidth: float = 65, n: int = 6):
    """Sector ("clover leaf") polygon ring for a cell."""
    ring = [[round(lng, 6), round(lat, 6)]]
    for i in range(n + 1):
        b = azimuth - beamwidth / 2 + beamwidth * i / n
        la, ln = offset(lat, lng, b, radius_km)
        ring.append([round(ln, 6), round(la, 6)])
    ring.append(ring[0])
    return ring


def polygon_geojson(ring: list[list[float]]) -> str:
    return json.dumps({"type": "Polygon", "coordinates": [ring]}, separators=(",", ":"))


def ring_bbox(ring: list[list[float]]) -> tuple[float, float, float, float]:
    """(min_lat, max_lat, min_lng, max_lng)"""
    lngs = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    return min(lats), max(lats), min(lngs), max(lngs)


def point_in_ring(lat: float, lng: float, ring: list[list[float]]) -> bool:
    """Ray casting; ring is [[lng, lat], ...]."""
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / (yj - yi + 1e-15) + xi:
            inside = not inside
        j = i
    return inside


def bbox_from_corners(northwest, northeast, southeast, southwest) -> tuple[float, float, float, float]:
    """Four "lat,lng" corners -> (min_lat, max_lat, min_lng, max_lng)."""
    pts = [
        parse_latlng(northwest, "northwest"),
        parse_latlng(northeast, "northeast"),
        parse_latlng(southeast, "southeast"),
        parse_latlng(southwest, "southwest"),
    ]
    lats = [p[0] for p in pts]
    lngs = [p[1] for p in pts]
    return min(lats), max(lats), min(lngs), max(lngs)


def bbox_around(lat: float, lng: float, radius_km: float) -> tuple[float, float, float, float]:
    dlat = radius_km / 110.574
    dlng = radius_km / (111.320 * max(math.cos(math.radians(lat)), 0.01))
    return lat - dlat, lat + dlat, lng - dlng, lng + dlng


def feature_collection(features: list[dict]) -> dict:
    return {"type": "FeatureCollection", "features": features}


def feature(geometry_json: str, properties: dict) -> dict:
    return {"type": "Feature", "geometry": json.loads(geometry_json), "properties": properties}
