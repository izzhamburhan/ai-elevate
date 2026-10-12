"""Build the synthetic network-operations DuckDB database.

    uv run netops-mcp-seed            # writes data/netops.duckdb
    NETOPS_REF_DATE=2026-10-01 uv run netops-mcp-seed

All dates are generated relative to a reference date (default: today), which is
stored in _meta so the server treats it as "today"."""

import datetime as dt
import os
import random
import sys
import time
from importlib import resources

import duckdb

from netops_mcp import config
from netops_mcp.seed import hotspots, network, people
from netops_mcp.seed.util import bulk_insert


class Ctx:
    def __init__(self, con, ref: dt.date, seed: int):
        self.con = con
        self.ref = ref
        self.ref_dt = dt.datetime.combine(ref, dt.time(12, 0))
        self.rng = random.Random(seed)
        self.clusters: dict = {}
        self.sites4g: list = []
        self.site_by_id: dict = {}
        self.cell_by_name: dict = {}
        self.sites5g: list = []
        self.site5g_by_id: dict = {}
        self.sites_mocn: list = []
        self.site_mocn_by_id: dict = {}
        self.sites3g: list = []
        self.sites2g: list = []
        self.used_ids: set = set()
        self.bins: dict = {}
        self.open_outage_sites: set = set()
        self.active_pm_sites: set = set()
        self.subscribers: list = []
        self.hotspot_thd: list = []
        self.hotspot_vip: list = []


def main() -> None:
    ref = dt.date.fromisoformat(os.environ["NETOPS_REF_DATE"]) if os.environ.get("NETOPS_REF_DATE") else dt.date.today()
    path = config.DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    for p in (path, path.with_suffix(path.suffix + ".wal")):
        if p.exists():
            p.unlink()

    con = duckdb.connect(str(path))
    con.execute("SET threads = 1")  # deterministic random() with setseed
    con.execute(f"SELECT setseed({(config.SEED % 1000) / 1000})")
    con.execute(resources.files("netops_mcp").joinpath("schema.sql").read_text(encoding="utf-8"))
    ctx = Ctx(con, ref, config.SEED)

    # last eight completed ISO weeks, idx 1 = most recent
    weeks = []
    for k in range(1, 9):
        d = ref - dt.timedelta(days=7 * k)
        y, w, _ = d.isocalendar()
        weeks.append((k, y, w, dt.date.fromisocalendar(y, w, 1)))
    con.execute("CREATE TEMP TABLE _weeks (idx INT, year INT, week INT, monday DATE)")
    bulk_insert(con, "_weeks", ["idx", "year", "week", "monday"], weeks)

    steps = [
        ("clusters", network.build_clusters),
        ("4G sites and cells", network.build_sites_4g),
        ("5G / MOCN / 3G / 2G / AOP sites", network.build_sites_other),
        ("BIN grid and KPIs", network.build_bins),
        ("EMS, HWC and handover", network.build_ems),
        ("NTT (4G + 5G)", network.build_ntt),
        ("planned maintenance", network.build_plan_maintenance),
        ("Cyberjaya / KL demo hotspots", hotspots.build_hotspots),
        ("congested cells", network.build_congested_cells),
        ("site status", network.update_site_status),
        ("coverage / congestion layers", network.build_coverage_layers),
        ("dashboards and CTT", network.build_dashboards),
        ("RAN KPI", network.build_ran_kpi),
        ("site KPI, BinKPI, Ookla", network.build_site_kpis),
        ("subscribers and NBA upstream", people.build_subscribers),
        ("VIP tickets", people.build_vip_tickets),
        ("advisory / ML tables", people.build_advisory),
    ]
    t0 = time.time()
    for label, fn in steps:
        t = time.time()
        fn(ctx)
        print(f"  {label:<34} {time.time() - t:6.1f}s", file=sys.stderr)

    bulk_insert(con, "_meta", ["key", "value"], [
        ("ref_date", ref.isoformat()),
        ("generated_at", dt.datetime.now().isoformat(timespec="seconds")),
        ("seed", str(config.SEED)),
        ("default_imsi", people.DEFAULT_IMSI),
        ("default_msisdn", people.DEFAULT_MSISDN),
    ])
    con.execute("CHECKPOINT")
    counts = con.execute("""SELECT table_name, estimated_size FROM duckdb_tables()
                            WHERE NOT temporary ORDER BY table_name""").fetchall()
    con.close()
    print(f"\nBuilt {path} in {time.time() - t0:.1f}s (ref date {ref})", file=sys.stderr)
    for name, n in counts:
        print(f"  {name:<34} {n:>9,}", file=sys.stderr)


if __name__ == "__main__":
    main()
