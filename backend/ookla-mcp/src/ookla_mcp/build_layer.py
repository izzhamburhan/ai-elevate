"""Build a Malaysia H3 layer from Ookla Open Data speed tiles on S3 (anonymous).

    uv run --package ookla-mcp python -m ookla_mcp.build_layer --type mobile --year 2026 --quarter 3 [--res 8]
"""

from __future__ import annotations

import argparse
import time

from ookla_mcp.db import DATA_DIR, connect, layer_path

# Malaysia bbox: lon 99.5-119.5, lat 0.8-7.5
MIN_LON, MAX_LON, MIN_LAT, MAX_LAT = 99.5, 119.5, 0.8, 7.5


def s3_url(type_: str, year: int, quarter: int) -> str:
    month = (quarter - 1) * 3 + 1
    return (
        f"s3://ookla-open-data/parquet/performance/type={type_}/year={year}/quarter={quarter}/"
        f"{year}-{month:02d}-01_performance_{type_}_tiles.parquet"
    )


def build(type_: str, year: int, quarter: int, res: int) -> None:
    out = layer_path(type_, year, quarter, res)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = connect()
    conn.execute("SET s3_region = 'us-west-2'")
    started = time.time()
    conn.execute(
        f"""
        COPY (
            WITH tiles AS (
                SELECT ST_Centroid(ST_GeomFromText(tile)) AS c, avg_d_kbps, avg_u_kbps, avg_lat_ms, tests
                FROM read_parquet('{s3_url(type_, year, quarter)}')
            ), my AS (
                SELECT h3_latlng_to_cell(ST_Y(c), ST_X(c), {res}) AS cell, avg_d_kbps, avg_u_kbps, avg_lat_ms, tests
                FROM tiles
                WHERE ST_X(c) BETWEEN {MIN_LON} AND {MAX_LON} AND ST_Y(c) BETWEEN {MIN_LAT} AND {MAX_LAT}
            )
            SELECT
                h3_h3_to_string(cell) AS h3,
                h3_cell_to_lat(cell) AS lat,
                h3_cell_to_lng(cell) AS lon,
                round(sum(avg_d_kbps * tests) / sum(tests) / 1000, 2) AS avg_down_mbps,
                round(sum(avg_u_kbps * tests) / sum(tests) / 1000, 2) AS avg_up_mbps,
                round(sum(avg_lat_ms * tests) / sum(tests), 1) AS avg_latency_ms,
                sum(tests)::BIGINT AS tests,
                count(*)::BIGINT AS tile_count
            FROM my
            GROUP BY cell
            ORDER BY h3
        ) TO '{out.as_posix()}' (FORMAT parquet)
        """
    )
    cells = conn.execute(f"SELECT count(*) FROM '{out.as_posix()}'").fetchone()[0]  # type: ignore[index]
    print(f"wrote {out} ({cells} cells, {time.time() - started:.0f}s)")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="ookla-build-layer", description=__doc__)
    parser.add_argument("--type", choices=["mobile", "fixed"], required=True)
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--quarter", type=int, choices=[1, 2, 3, 4], required=True)
    parser.add_argument("--res", type=int, default=8)
    args = parser.parse_args(argv)
    build(args.type, args.year, args.quarter, args.res)


if __name__ == "__main__":
    main()
