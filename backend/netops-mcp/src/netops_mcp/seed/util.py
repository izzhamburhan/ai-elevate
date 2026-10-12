"""Seeding helpers: fast bulk insert via VALUES literals, weighted choice, a
coarse spatial index, and RF propagation helpers shared by the generators."""

import datetime as dt
import math
import random
from collections import defaultdict

from netops_mcp import geo


def lit(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return "NULL"
        return repr(round(v, 6))
    if isinstance(v, dt.datetime):
        return f"TIMESTAMP '{v.replace(microsecond=0).isoformat(sep=' ')}'"
    if isinstance(v, dt.date):
        return f"DATE '{v.isoformat()}'"
    if isinstance(v, dt.time):
        return f"TIME '{v.isoformat()}'"
    return "'" + str(v).replace("'", "''") + "'"


def bulk_insert(con, table: str, columns: list[str], rows: list, chunk: int = 1500) -> None:
    if not rows:
        return
    cols = ", ".join(f'"{c}"' for c in columns)
    for i in range(0, len(rows), chunk):
        values = ",\n".join("(" + ", ".join(lit(v) for v in row) + ")" for row in rows[i : i + chunk])
        con.execute(f"INSERT INTO {table} ({cols}) VALUES {values}")


def weighted(rng: random.Random, pairs):
    """pairs = [(value, weight), ...]"""
    values, weights = zip(*pairs)
    return rng.choices(values, weights=weights, k=1)[0]


class SpatialIndex:
    """Bucket points in 0.05 degree cells for nearest-neighbour lookups."""

    STEP = 0.05

    def __init__(self, items, lat_key="lat", lng_key="lng"):
        self.lat_key, self.lng_key = lat_key, lng_key
        self.buckets = defaultdict(list)
        for it in items:
            self.buckets[self._key(it[lat_key], it[lng_key])].append(it)

    def _key(self, lat, lng):
        return int(math.floor(lat / self.STEP)), int(math.floor(lng / self.STEP))

    def nearest(self, lat, lng, k=1, max_rings=6):
        ki, kj = self._key(lat, lng)
        found = []
        for ring in range(max_rings + 1):
            for i in range(ki - ring, ki + ring + 1):
                for j in range(kj - ring, kj + ring + 1):
                    if max(abs(i - ki), abs(j - kj)) == ring:
                        found.extend(self.buckets.get((i, j), []))
            if len(found) >= k and ring >= 1:
                break
        if not found:  # far from everything: fall back to a full scan
            found = [it for bucket in self.buckets.values() for it in bucket]
        found.sort(key=lambda it: geo.haversine_km(lat, lng, it[self.lat_key], it[self.lng_key]))
        return found[:k]


bearing = geo.bearing


def rsrp_at(dist_km: float) -> float:
    """Simple log-distance path loss: -60 dBm at 30 m, ~-106 at 1 km, ~-115 at 2 km."""
    return -60.0 - 30.0 * math.log10(max(dist_km, 0.03) / 0.03)


def cell_rsrp(site: dict, cell: dict, lat: float, lng: float) -> float:
    d = geo.haversine_km(site["lat"], site["lng"], lat, lng)
    value = rsrp_at(d) + cell["band_offset"]
    if cell["sectorised"]:
        diff = abs((bearing(site["lat"], site["lng"], lat, lng) - cell["azimuth"] + 180) % 360 - 180)
        value -= min(25.0, 12.0 * (diff / 60.0) ** 2)
    elif d > 0.2:
        value -= 8.0  # small cells / in-building fall off quickly outdoors
    return value


def rsrq_from_rsrp(rng: random.Random, rsrp: float) -> float:
    return max(-19.5, min(-3.0, -4.0 - (-rsrp - 70.0) / 5.0 + rng.gauss(0, 1.2)))


def iso(d: dt.date) -> tuple[int, int]:
    c = d.isocalendar()
    return c[0], c[1]


def clamp(v, lo, hi):
    return max(lo, min(hi, v))
