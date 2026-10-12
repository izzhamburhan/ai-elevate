"""Download Malaysian administrative boundaries from geoBoundaries into one Parquet file.

    uv run python -m netops_mcp.seed.boundaries

Levels in data/boundaries_my.parquet:
  country   ADM0  Malaysia                            OpenStreetMap via geoBoundaries (ODbL 1.0)
  state     ADM1  16 states and federal territories   OpenStreetMap via geoBoundaries (ODbL 1.0)
  district  ADM2  160 districts (daerah)              geoBoundaries / citypopulation.de (CC BY 3.0)
  mukim     ADM3  ~2,040 mukim/bandar/pekan           Wikimedia Commons / geoBoundaries (CC BY 4.0)

The source files carry no hierarchy, so every district and mukim gets its state (and district) from
the parent polygon it overlaps most; same-named mukim the source merged across districts are split apart.
Sabah/Sarawak divisions (bahagian) and Sabah mukim are not in the source.
The synthetic seed never touches this file, so it survives `netops-mcp-seed`."""

import argparse
import json
import os
import re
import tempfile
import time
import urllib.request
from pathlib import Path

import duckdb

from netops_mcp import config

API = "https://www.geoboundaries.org/api/current/gbOpen/MYS/{level}/"
LEVELS = {"ADM0": "country", "ADM1": "state", "ADM2": "district", "ADM3": "mukim"}

# geoBoundaries uses English names for two states; search_locations uses the Malay ones
RENAME = {"Malacca": "Melaka", "Penang": "Pulau Pinang"}
# Other names people use for the same area (matched by name/alias search)
ALIASES = {
    "Melaka": ["Malacca"],
    "Pulau Pinang": ["Penang"],
    "Kuala Lumpur": ["Wilayah Persekutuan Kuala Lumpur", "WP Kuala Lumpur", "KL"],
    "Putrajaya": ["Wilayah Persekutuan Putrajaya", "WP Putrajaya"],
    "Labuan": ["Wilayah Persekutuan Labuan", "WP Labuan"],
    "Negeri Sembilan": ["Negri Sembilan"],
    "Ulu Langat": ["Hulu Langat"],
    "Ulu Selangor": ["Hulu Selangor"],
    "Kulaijaya": ["Kulai"],
    "Maradong": ["Meradong"],
    "Kecil Lojing": ["Lojing"],
    "Nabawan / Persiangan": ["Nabawan"],
    "Timur Laut": ["Northeast Penang Island"],
    "Barat Daya": ["Southwest Penang Island"],
}


def title_name(name: str) -> str:
    """'MUKIM BUKIT MERBAU' -> 'Mukim Bukit Merbau' (mukim names arrive in upper case)."""
    return re.sub(r"[a-z]+", lambda m: m[0].capitalize(), name.lower()) if name.isupper() else name


def fetch_meta(level: str) -> dict:
    with urllib.request.urlopen(API.format(level=level), timeout=60) as r:
        return json.load(r)


def download(con: duckdb.DuckDBPyConnection, tmp: Path) -> dict:
    """Load every level into table `raw`; returns per-level source metadata."""
    meta = {}
    con.execute("""CREATE TABLE raw (level VARCHAR, id VARCHAR, name VARCHAR, iso_code VARCHAR,
                                     geometry GEOMETRY)""")
    for code, level in LEVELS.items():
        m = fetch_meta(code)
        path = tmp / f"{code}.geojson"
        urllib.request.urlretrieve(m["gjDownloadURL"], path)
        con.execute("""INSERT INTO raw
            SELECT ?, shapeID, shapeName, nullif(shapeISO, ''), ST_MakeValid(geom)
            FROM ST_Read(?)""", [level, str(path)])
        meta[level] = {k: m.get(k) for k in ("boundarySource", "boundaryLicense", "boundaryYearRepresented",
                                              "sourceDataUpdateDate", "buildDate", "gjDownloadURL")}
        print(f"  {level}: {con.execute('SELECT count(*) FROM raw WHERE level = ?', [level]).fetchone()[0]}")
    for old, new in RENAME.items():
        con.execute("UPDATE raw SET name = ? WHERE level = 'state' AND name = ?", [new, old])
    names = [n for (n,) in con.execute("SELECT DISTINCT name FROM raw").fetchall() if n and title_name(n) != n]
    con.executemany("UPDATE raw SET name = ? WHERE name = ?", [(title_name(n), n) for n in names])
    return meta


def split_mukim(con: duckdb.DuckDBPyConnection, min_share: float = 0.15) -> None:
    """geoBoundaries merges same-named mukim of different districts into one feature: 'Mukim Pulai' covers
    mukim in Johor, Kelantan and Kedah, 'Mukim Petaling' one shape across Kuala Lumpur and Petaling. Split every
    mukim into its parts, cut a part along district lines where at least `min_share` of it lies in another
    district (smaller overlaps are edge mismatches between the datasets and stay whole), give islets the
    nearest district, and regroup by district; split features get ids '<id>-1', '<id>-2', ..."""
    con.execute("""CREATE TABLE parts AS
        SELECT row_number() OVER () AS pid, id, name, iso_code, part.geom AS g
        FROM (SELECT id, name, iso_code, unnest(ST_Dump(geometry)) AS part FROM raw WHERE level = 'mukim')""")
    con.execute("""CREATE TABLE dist AS
        SELECT id, ST_MakeValid(ST_SimplifyPreserveTopology(geometry, 0.001)) AS g FROM raw WHERE level = 'district'""")
    # Districts each part belongs to: every one holding min_share of it, else just the largest overlap
    con.execute(f"""CREATE TABLE part_district AS
        SELECT pid, did, row_number() OVER (PARTITION BY pid ORDER BY share DESC) AS rk FROM (
            SELECT pid, did, share FROM (
                SELECT p.pid, d.id AS did, ST_Area(ST_Intersection(p.g, d.g)) / ST_Area(p.g) AS share
                FROM parts p JOIN dist d ON ST_Intersects(p.g, d.g))
            WHERE share > 0
            QUALIFY share >= {min_share} OR share = max(share) OVER (PARTITION BY pid))""")
    con.execute("""INSERT INTO part_district
        SELECT p.pid, arg_min(d.id, ST_Distance(p.g, d.g)), 1
        FROM parts p JOIN dist d ON ST_DWithin(p.g, d.g, 0.2)
        WHERE p.pid NOT IN (SELECT pid FROM part_district) GROUP BY p.pid""")
    # Secondary districts get the part clipped to them; the main district keeps the rest
    con.execute("""CREATE TABLE pieces AS
        WITH minor AS (
            SELECT pd.pid, pd.did, ST_CollectionExtract(ST_Intersection(p.g, r.geometry), 3) AS g
            FROM part_district pd JOIN parts p USING (pid) JOIN raw r ON r.id = pd.did WHERE pd.rk > 1),
        cut AS (SELECT pid, ST_Union_Agg(g) AS g FROM minor GROUP BY pid)
        SELECT pd.pid, pd.did,
               CASE WHEN cut.g IS NULL THEN p.g ELSE ST_CollectionExtract(ST_Difference(p.g, cut.g), 3) END AS g
        FROM part_district pd JOIN parts p USING (pid) LEFT JOIN cut USING (pid) WHERE pd.rk = 1
        UNION ALL SELECT pid, did, g FROM minor
        UNION ALL SELECT pid, NULL, g FROM parts WHERE pid NOT IN (SELECT pid FROM part_district)""")
    con.execute("""CREATE TABLE mukim AS
        SELECT CASE WHEN count(*) OVER (PARTITION BY id) > 1
                    THEN id || '-' || row_number() OVER (PARTITION BY id ORDER BY area DESC) ELSE id END AS id,
               name, iso_code, geometry, district_id
        FROM (SELECT p.id, p.name, any_value(p.iso_code) AS iso_code, x.did AS district_id,
                     ST_Union_Agg(x.g) AS geometry, sum(ST_Area(x.g)) AS area
              FROM parts p JOIN pieces x USING (pid) WHERE NOT ST_IsEmpty(x.g)
              GROUP BY p.id, p.name, x.did)""")
    con.execute("DELETE FROM raw WHERE level = 'mukim'")
    con.execute("INSERT INTO raw SELECT 'mukim', id, name, iso_code, geometry FROM mukim")


def link_parents(con: duckdb.DuckDBPyConnection) -> None:
    """Parent = the polygon of the level above with the largest overlap (on ~100 m simplified shapes,
    which is plenty to tell neighbours apart and keeps the intersections fast)."""
    split_mukim(con)
    con.execute("""CREATE TABLE simp AS
        SELECT id, level, ST_MakeValid(ST_SimplifyPreserveTopology(geometry, 0.001)) AS g FROM raw""")

    def parent(child: str, par: str) -> str:
        return f"""SELECT c.id, arg_max(p.id, ST_Area(ST_Intersection(c.g, p.g))) AS parent_id
                   FROM simp c JOIN simp p ON p.level = '{par}' AND ST_Intersects(c.g, p.g)
                   WHERE c.level = '{child}' GROUP BY c.id"""

    con.execute(f"CREATE TABLE district_state AS {parent('district', 'state')}")
    con.execute("CREATE TABLE mukim_district AS SELECT id, district_id AS parent_id FROM mukim")
    con.execute(f"CREATE TABLE mukim_state AS {parent('mukim', 'state')}")
    con.execute("""CREATE TABLE parents AS
        SELECT r.id,
               CASE r.level WHEN 'state' THEN r.name
                            WHEN 'district' THEN s1.name
                            WHEN 'mukim' THEN coalesce(s2.name, s3.name) END AS state,
               CASE r.level WHEN 'district' THEN r.name WHEN 'mukim' THEN d.name END AS district
        FROM raw r
        LEFT JOIN district_state ds ON ds.id = r.id LEFT JOIN raw s1 ON s1.id = ds.parent_id
        LEFT JOIN mukim_district md ON md.id = r.id LEFT JOIN raw d ON d.id = md.parent_id
        LEFT JOIN district_state ds2 ON ds2.id = md.parent_id LEFT JOIN raw s2 ON s2.id = ds2.parent_id
        LEFT JOIN mukim_state ms ON ms.id = r.id LEFT JOIN raw s3 ON s3.id = ms.parent_id""")


def export(con: duckdb.DuckDBPyConnection, path: Path, meta: dict) -> None:
    con.execute("CREATE TABLE aliases (name VARCHAR, alt_names VARCHAR)")
    con.executemany("INSERT INTO aliases VALUES (?, ?)", [(k, " | ".join(v)) for k, v in ALIASES.items()])
    tmp = str(path) + ".tmp"
    kv = json.dumps(meta).replace("'", "''")
    con.execute(f"""COPY (
        SELECT r.id, r.level, r.name, a.alt_names, r.iso_code, p.state, p.district,
               round(ST_Area_Spheroid(ST_FlipCoordinates(r.geometry)) / 1e6, 2) AS area_km2,
               round(ST_Y(ST_PointOnSurface(r.geometry)), 6) AS lat,
               round(ST_X(ST_PointOnSurface(r.geometry)), 6) AS lng,
               ST_YMin(r.geometry) AS min_lat, ST_YMax(r.geometry) AS max_lat,
               ST_XMin(r.geometry) AS min_lng, ST_XMax(r.geometry) AS max_lng,
               lower(concat_ws(' | ', r.name, a.alt_names)) AS search_text,
               r.geometry
        FROM raw r JOIN parents p USING (id) LEFT JOIN aliases a ON a.name = r.name
        ORDER BY list_position(['country', 'state', 'district', 'mukim'], r.level), p.state, p.district, r.name
    ) TO '{tmp}' (FORMAT parquet, COMPRESSION zstd, KV_METADATA {{geoboundaries: '{kv}'}})""")
    os.replace(tmp, path)


def main() -> None:
    argparse.ArgumentParser(description="Download Malaysian administrative boundaries (geoBoundaries)").parse_args()
    path = config.BOUNDARIES_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"geoBoundaries MYS ADM0-3 -> {path}")

    t0 = time.time()
    con = duckdb.connect()
    con.execute("SET enable_progress_bar = false")
    con.execute("INSTALL spatial; LOAD spatial;")
    with tempfile.TemporaryDirectory(dir=path.parent) as tmp:
        meta = download(con, Path(tmp))
    print(f"Downloaded in {time.time() - t0:.0f}s")
    link_parents(con)
    export(con, path, meta)

    orphans = con.execute(f"""SELECT level, count(*) FILTER (WHERE state IS NULL),
                                     count(*) FILTER (WHERE level = 'mukim' AND district IS NULL)
                              FROM '{path}' WHERE level IN ('district', 'mukim') GROUP BY level""").fetchall()
    counts = con.execute(f"SELECT level, count(*) FROM '{path}' GROUP BY level ORDER BY min(area_km2) DESC").fetchall()
    con.close()
    print(", ".join(f"{n:,} {lvl}" for lvl, n in counts) + f"; {path.stat().st_size / 1e6:.0f} MB in {time.time() - t0:.0f}s")
    for lvl, no_state, no_district in orphans:
        if no_state or no_district:
            print(f"  warning: {lvl}: {no_state} without a state, {no_district} without a district")


if __name__ == "__main__":
    main()
