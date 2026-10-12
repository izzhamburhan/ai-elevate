"""Download real Malaysian place data from Overture Maps into one Parquet file.

    uv run python -m netops_mcp.seed.places                       # latest Overture release
    uv run python -m netops_mcp.seed.places --release 2026-09-23.1

Two kinds of rows land in data/places_my.parquet:
  place  points of interest (shops, hospitals, schools, malls, ...) from the places theme
  area   named areas (states, districts, towns, neighbourhoods) from the divisions theme

Overture data is CDLA-Permissive-2.0 / ODbL (see https://docs.overturemaps.org/attribution/).
The synthetic seed never touches this file, so it survives `netops-mcp-seed`."""

import argparse
import json
import os
import time
import urllib.request

import duckdb

from netops_mcp import config

STAC_CATALOG = "https://stac.overturemaps.org/catalog.json"
S3_BASE = "s3://overturemaps-us-west-2/release"
# Malaysia plus a margin; rows are then filtered by country code
BBOX = "bbox.xmin BETWEEN 99.5 AND 119.5 AND bbox.ymin BETWEEN 0.8 AND 7.5"


def latest_release() -> str:
    with urllib.request.urlopen(STAC_CATALOG, timeout=30) as r:
        return json.load(r)["latest"]


def _src(release: str, theme: str, kind: str) -> str:
    return f"read_parquet('{S3_BASE}/{release}/theme={theme}/type={kind}/*', hive_partitioning = 1)"


def download(con: duckdb.DuckDBPyConnection, release: str) -> None:
    """Pull the Malaysian rows into the staging database (the slow, network-bound part)."""
    # State polygons, simplified to ~50 m: every row gets its state from where it sits
    con.execute(f"""CREATE TABLE states AS
        SELECT names.primary AS state, ST_SimplifyPreserveTopology(geometry::GEOMETRY, 0.0005) AS geometry
        FROM {_src(release, 'divisions', 'division_area')}
        WHERE country = 'MY' AND subtype = 'region' AND class = 'land'""")

    con.execute(f"""CREATE TABLE areas AS
        SELECT id, 'area' AS kind, names.primary AS name,
               array_to_string(map_values(names.common), ' | ') AS alt_names,
               subtype AS category, NULL::VARCHAR AS taxonomy, NULL::VARCHAR AS brand,
               array_to_string(list_reverse(list_transform(
                   list_filter(hierarchies[1], h -> h.subtype <> 'country' AND h.division_id <> id),
                   h -> h.name)), ', ') AS address,
               NULL::VARCHAR AS locality, NULL::VARCHAR AS postcode,
               NULL::VARCHAR AS phone, NULL::VARCHAR AS website, population,
               NULL::DOUBLE AS confidence, NULL::VARCHAR AS operating_status, geometry::GEOMETRY AS geometry
        FROM {_src(release, 'divisions', 'division')}
        WHERE country = 'MY' AND names.primary IS NOT NULL""")

    con.execute(f"""CREATE TABLE pois AS
        SELECT id, 'place' AS kind, names.primary AS name,
               array_to_string(map_values(names.common), ' | ') AS alt_names,
               basic_category AS category, array_to_string(taxonomy.hierarchy, ' > ') AS taxonomy,
               brand.names.primary AS brand,
               addresses[1].freeform AS address, addresses[1].locality AS locality,
               addresses[1].postcode AS postcode,
               phones[1] AS phone, websites[1] AS website, NULL::INTEGER AS population,
               confidence, operating_status, geometry::GEOMETRY AS geometry
        FROM {_src(release, 'places', 'place')}
        WHERE {BBOX} AND addresses[1].country = 'MY' AND names.primary IS NOT NULL""")
    con.execute("CREATE TABLE _meta AS SELECT ? AS release", [release])


def export(con: duckdb.DuckDBPyConnection, path: str, release: str) -> None:
    # Narrow point-in-state join (id + point only) keeps memory small
    con.execute("""CREATE OR REPLACE TABLE located AS
        SELECT u.id, any_value(s.state) AS geo_state
        FROM (SELECT id, geometry FROM areas UNION ALL SELECT id, geometry FROM pois) u
        JOIN states s ON ST_Intersects(s.geometry, u.geometry)
        GROUP BY u.id""")
    # Coastal points just outside the simplified outlines: nearest state within ~11 km
    con.execute("""INSERT INTO located
        SELECT u.id, arg_min(s.state, ST_Distance(s.geometry, u.geometry))
        FROM (SELECT id, geometry FROM areas UNION ALL SELECT id, geometry FROM pois) u
        JOIN states s ON ST_DWithin(s.geometry, u.geometry, 0.1)
        WHERE u.id NOT IN (SELECT id FROM located)
        GROUP BY u.id""")
    tmp = path + ".tmp"
    con.execute(f"""COPY (
        WITH u AS (SELECT * FROM areas UNION ALL SELECT * FROM pois),
        s AS (SELECT u.*, l.geo_state AS state
              FROM u LEFT JOIN located l USING (id)
              WHERE ST_GeometryType(u.geometry) = 'POINT')
        SELECT id, kind, name, alt_names, category, taxonomy, brand, address, locality, postcode, state,
               phone, website, population, round(confidence, 3) AS confidence, operating_status,
               round(ST_Y(geometry), 6) AS lat, round(ST_X(geometry), 6) AS lng,
               lower(concat_ws(' ', name, alt_names, brand, category, taxonomy, address, locality, postcode,
                               state)) AS search_text
        FROM s
        ORDER BY state, kind, name
    ) TO '{tmp}' (FORMAT parquet, COMPRESSION zstd, KV_METADATA {{overture_release: '{release}'}})""")
    os.replace(tmp, path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Download Malaysian places from Overture Maps")
    parser.add_argument("--release", help="Overture release, e.g. 2026-09-23.1 (default: latest)")
    args = parser.parse_args()

    release = args.release or latest_release()
    path = config.PLACES_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    staging = path.with_suffix(".staging.duckdb")
    print(f"Overture release {release} -> {path}")

    # Staging on disk lets a failed export resume without downloading again, and lets DuckDB spill
    con = duckdb.connect(str(staging))
    con.execute("SET enable_progress_bar = false")
    con.execute("SET memory_limit = '4GB'")
    con.execute("SET preserve_insertion_order = false")
    for ext in ("httpfs", "spatial"):
        con.execute(f"INSTALL {ext}; LOAD {ext};")
    con.execute("SET s3_region = 'us-west-2'")

    t0 = time.time()
    staged = con.execute("SELECT count(*) FROM duckdb_tables() WHERE table_name = '_meta'").fetchone()[0]
    if staged and con.execute("SELECT release FROM _meta").fetchone()[0] == release:
        print("Reusing staged download")
    else:
        for table in ("_meta", "states", "areas", "pois", "located"):
            con.execute(f"DROP TABLE IF EXISTS {table}")
        download(con, release)
        print(f"Downloaded in {time.time() - t0:.0f}s")
    export(con, str(path), release)
    counts = con.execute(f"SELECT kind, count(*) FROM '{path}' GROUP BY kind ORDER BY kind").fetchall()
    con.close()
    staging.unlink()
    size_mb = path.stat().st_size / 1e6
    print(", ".join(f"{n:,} {k}s" for k, n in counts) + f"; {size_mb:.0f} MB in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
