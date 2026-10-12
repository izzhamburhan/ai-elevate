"""Download the latest DOSM open data and build data/dosm.duckdb (one table per dataset).

    uv run python -m dosm_mcp.download                 # every DOSM dataset up to --max-mb, only what changed
    uv run python -m dosm_mcp.download --force         # re-download everything
    uv run python -m dosm_mcp.download population_district cpi_core   # just these (plus what is cached)

The catalogue comes from github.com/data-gov-my/datagovmy-meta (the metadata behind open.dosm.gov.my);
the files come from storage.dosm.gov.my, which has no rate limit, unlike api.data.gov.my (4 req/min).
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import duckdb

from dosm_mcp.db import DATA_DIR, DB_PATH, PARQUET_DIR, STATE_PATH, table_name

META_ZIP = "https://codeload.github.com/data-gov-my/datagovmy-meta/zip/refs/heads/main"
USER_AGENT = "dosm-mcp/0.1 (+https://open.dosm.gov.my)"
TIMEOUT_S = 120


def _get(url: str, method: str = "GET") -> Any:
    req = urllib.request.Request(url, method=method, headers={"User-Agent": USER_AGENT})
    return urllib.request.urlopen(req, timeout=TIMEOUT_S)


def _category(meta: dict[str, Any]) -> dict[str, Any]:
    cats = meta.get("site_category") or [{}]
    return next((c for c in cats if c.get("site") == "opendosm"), cats[0])


def fetch_catalogue() -> list[dict[str, Any]]:
    """Every DOSM dataset in the data.gov.my catalogue, trimmed to what the tools need."""
    with _get(META_ZIP) as resp:
        archive = zipfile.ZipFile(io.BytesIO(resp.read()))
    out = []
    for name in sorted(archive.namelist()):
        parts = name.split("/")
        if len(parts) != 3 or parts[1] != "data-catalogue" or not parts[2].endswith(".json"):
            continue
        try:
            meta = json.loads(archive.read(name).decode("utf-8"))
        except ValueError:
            print(f"  skip {parts[2]}: invalid JSON", file=sys.stderr)
            continue
        sites = {c.get("site") for c in meta.get("site_category", [])}
        if not meta.get("link_parquet") or ("opendosm" not in sites and "DOSM" not in meta.get("data_source", [])):
            continue
        dataset_id = parts[2].removesuffix(".json")
        cat = _category(meta)
        out.append(
            {
                "id": dataset_id,
                "table_name": table_name(dataset_id),
                "title": meta.get("title_en", ""),
                "description": meta.get("description_en", ""),
                "category": cat.get("category_en", ""),
                "subcategory": cat.get("subcategory_en", ""),
                "frequency": meta.get("frequency", ""),
                "geography": meta.get("geography") or [],
                "demography": meta.get("demography") or [],
                "dataset_begin": meta.get("dataset_begin"),
                "dataset_end": meta.get("dataset_end"),
                "data_as_of": str(meta.get("data_as_of", "")),
                "last_updated": meta.get("last_updated", ""),
                "next_update": meta.get("next_update", ""),
                "methodology": meta.get("methodology_en", ""),
                "caveat": meta.get("caveat_en", ""),
                "link_parquet": meta["link_parquet"],
                "link_csv": meta.get("link_csv", ""),
                "fields": [
                    {"name": f.get("name", ""), "title": f.get("title_en", ""), "description": f.get("description_en", "")}
                    for f in meta.get("fields", [])
                ],
            }
        )
    return out


def _head(url: str) -> tuple[int, str]:
    """(size in bytes, Last-Modified) or (-1, "") when the server does not say."""
    try:
        with _get(url, "HEAD") as resp:
            return int(resp.headers.get("Content-Length") or -1), resp.headers.get("Last-Modified") or ""
    except OSError:
        return -1, ""


def _download(url: str, dest: Path) -> None:
    tmp = dest.with_suffix(".part")
    for attempt in (1, 2, 3):
        try:
            with _get(url) as resp, tmp.open("wb") as f:
                while chunk := resp.read(1 << 20):
                    f.write(chunk)
            tmp.replace(dest)
            return
        except OSError:
            if attempt == 3:
                tmp.unlink(missing_ok=True)
                raise
            time.sleep(2 * attempt)


def _months_back(n: int) -> list[str]:
    """The current month and the n-1 before it, as YYYY-MM, newest first."""
    y, m = time.localtime()[:2]
    out = []
    for _ in range(n):
        out.append(f"{y}-{m:02d}")
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
    return out


def jobs_for(entry: dict[str, Any], months: int) -> list[tuple[str, Path]]:
    """(url, local file) pairs. Monthly-partitioned datasets (pricecatcher_YYYY-MM-DD.parquet) get one file per
    month in a folder named after the dataset; the rest are one file."""
    url = entry["link_parquet"]
    if "YYYY-MM-DD" not in url:
        return [(url, PARQUET_DIR / f"{entry['id']}.parquet")]
    folder = PARQUET_DIR / entry["id"]
    return [(url.replace("YYYY-MM-DD", ym), folder / f"{ym}.parquet") for ym in _months_back(months)]


def sync_files(catalogue: list[dict[str, Any]], *, force: bool, max_mb: float, workers: int, months: int) -> dict[str, Any]:
    """Download new or changed parquet files. Returns the state saved to state.json."""
    PARQUET_DIR.mkdir(parents=True, exist_ok=True)
    state: dict[str, Any] = json.loads(STATE_PATH.read_text("utf-8")) if STATE_PATH.exists() else {}
    jobs = [(e["id"], url, dest) for e in catalogue for url, dest in jobs_for(e, months)]

    def one(job: tuple[str, str, Path]) -> tuple[str, str]:
        dataset_id, url, dest = job
        key = dest.relative_to(PARQUET_DIR).as_posix()
        size, modified = _head(url)
        if size < 0 and not modified and dest.parent != PARQUET_DIR and not dest.exists():
            return key, "not published (yet)"
        if not force and dest.exists() and modified and state.get(key, {}).get("last_modified") == modified:
            return key, "unchanged"
        if max_mb and size > max_mb * 1e6:
            return key, f"skipped ({size / 1e6:.0f} MB > --max-mb {max_mb:g})"
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            _download(url, dest)
        except OSError as e:
            return key, f"FAILED ({e})"
        state[key] = {"last_modified": modified, "bytes": dest.stat().st_size, "downloaded_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
        return key, f"downloaded ({dest.stat().st_size / 1e6:.1f} MB)"

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for i, (key, status) in enumerate(pool.map(one, jobs), 1):
            if status != "unchanged":
                print(f"  [{i}/{len(jobs)}] {key}: {status}")
    STATE_PATH.write_text(json.dumps(state, indent=1), "utf-8")
    return state


def build_db(catalogue: list[dict[str, Any]]) -> Path:
    """Build dosm.duckdb next to the old one, then swap it in, so a running server only ever sees a whole file."""
    tmp = DB_PATH.with_suffix(".duckdb.tmp")
    tmp.unlink(missing_ok=True)
    conn = duckdb.connect(str(tmp))
    loaded: dict[str, int] = {}
    try:
        for entry in catalogue:
            single, folder = PARQUET_DIR / f"{entry['id']}.parquet", PARQUET_DIR / entry["id"]
            if single.exists():
                src = f"read_parquet('{single.as_posix()}')"
            elif any(folder.glob("*.parquet")):
                src = f"read_parquet('{folder.as_posix()}/*.parquet', union_by_name = true)"
            else:
                continue
            t = entry["table_name"]
            try:
                cols = conn.execute(f"DESCRIBE SELECT * FROM {src}").fetchall()
                # DOSM stores dates as midnight timestamps; DATE is what every query wants
                select = ", ".join(
                    f'CAST("{c[0]}" AS DATE) AS "{c[0]}"' if c[0] == "date" and "TIMESTAMP" in c[1] else f'"{c[0]}"'
                    for c in cols
                )
                conn.execute(f'CREATE TABLE "{t}" AS SELECT {select} FROM {src}')
                loaded[entry["id"]] = conn.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0]  # type: ignore[index]
            except duckdb.Error as e:
                print(f"  {entry['id']}: not loaded ({str(e).splitlines()[0]})", file=sys.stderr)

        catalogue_rows = [
            {k: v for k, v in e.items() if k != "fields"} | {"loaded": e["id"] in loaded, "row_count": loaded.get(e["id"], 0)}
            for e in catalogue
        ]
        column_rows = [{"dataset_id": e["id"], "position": i, **f} for e in catalogue for i, f in enumerate(e["fields"])]
        for name, rows in (("_catalogue", catalogue_rows), ("_fields", column_rows)):
            path = DATA_DIR / f"{name.strip('_')}.json"
            path.write_text(json.dumps(rows), "utf-8")
            conn.execute(f"CREATE TABLE {name} AS SELECT * FROM read_json('{path.as_posix()}', format='array')")
        conn.execute(
            "CREATE TABLE _build AS SELECT current_timestamp::VARCHAR AS built_at, ? AS datasets, ? AS loaded",
            [len(catalogue), len(loaded)],
        )
    finally:
        conn.close()
    try:
        os.replace(tmp, DB_PATH)
    except PermissionError:
        print(f"{DB_PATH} is open in another process (stop dosm-mcp), new build left at {tmp}", file=sys.stderr)
        raise
    print(f"wrote {DB_PATH} ({len(loaded)}/{len(catalogue)} datasets, {DB_PATH.stat().st_size / 1e6:.0f} MB)")
    return DB_PATH


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="dosm-download", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("ids", nargs="*", help="only download these dataset ids (the DB still includes everything cached)")
    parser.add_argument("--force", action="store_true", help="re-download even if the file has not changed")
    parser.add_argument("--max-mb", type=float, default=200, help="skip files larger than this (0 = no limit)")
    parser.add_argument("--months", type=int, default=3, help="months to keep of monthly-partitioned data (PriceCatcher)")
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args(argv)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    started = time.time()
    print("fetching DOSM catalogue ...")
    catalogue = fetch_catalogue()
    print(f"  {len(catalogue)} DOSM datasets")
    wanted = [e for e in catalogue if e["id"] in args.ids] if args.ids else catalogue
    unknown = set(args.ids) - {e["id"] for e in wanted}
    if unknown:
        parser.error(f"unknown dataset ids: {', '.join(sorted(unknown))}")
    print(f"syncing {len(wanted)} parquet files from storage.dosm.gov.my ...")
    sync_files(wanted, force=args.force, max_mb=args.max_mb, workers=args.workers, months=args.months)
    print("building DuckDB ...")
    build_db(catalogue)
    print(f"done in {time.time() - started:.0f}s")


if __name__ == "__main__":
    main()
