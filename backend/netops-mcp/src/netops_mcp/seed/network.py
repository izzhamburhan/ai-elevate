"""Network side of the synthetic dataset: site/cell inventory, map layers, BIN
grid and KPIs, EMS, NTT, maintenance, congestion, CTT, RAN KPI and Ookla."""

import datetime as dt
import math

from netops_mcp import geo
from netops_mcp.seed import reference as R
from netops_mcp.seed.util import (
    SpatialIndex, bulk_insert, cell_rsrp, clamp, iso, rsrq_from_rsrp, weighted,
)

RRU = {"Huawei": ["RRU5304", "RRU3959", "AAU5613"], "ZTE": ["R8862A", "R8984E", "R8854"]}
ANTENNA = {"Huawei": ["ADU451807v01", "AQU4518R11"], "ZTE": ["ZXA10 A9065", "ZXA10 A9026"]}


# ---------------------------------------------------------------------------
# Clusters and sites
# ---------------------------------------------------------------------------
def build_clusters(ctx):
    rng = ctx.rng
    rows = []
    for cid, name, region, state, lat, lng, morph, _ in R.CLUSTERS:
        radius = R.MORPH_SPREAD_KM[morph] * 1.6
        ring = geo.circle(lat, lng, radius, n=14, jitter=lambda: rng.uniform(0.85, 1.15))
        bb = geo.ring_bbox(ring)
        rows.append((cid, name, morph, region, state, lat, lng, geo.polygon_geojson(ring), *bb))
        ctx.clusters[cid] = {"id": cid, "name": name, "region": region, "state": state,
                             "lat": lat, "lng": lng, "morph": morph, "district": _}
    bulk_insert(ctx.con, "TM_Cluster",
                ["Cluster_ID", "Cluster_Name", "Morphology", "Region", "State", "latitude", "longitude",
                 "geometry", "min_lat", "max_lat", "min_lng", "max_lng"], rows)


def _scatter(rng, lat, lng, spread, lo=0.0, hi=None):
    hi = hi or spread * 1.6
    dist = clamp(abs(rng.gauss(0, spread * 0.6)), lo, hi) if lo == 0 else rng.uniform(lo, hi)
    return geo.offset(lat, lng, rng.uniform(0, 360), dist)


def _new_id(rng, used, prefix, digits=4):
    while True:
        sid = f"{prefix}{rng.randint(1, 10 ** digits - 1):0{digits}d}"
        if sid not in used:
            used.add(sid)
            return sid


def build_sites_4g(ctx):
    rng, ref = ctx.rng, ctx.ref
    site_rows, cell_rows = [], []
    enb = 101000
    for ci, c in enumerate(ctx.clusters.values()):
        morph = c["morph"]
        for _ in range(R.MORPH_SITES[morph]):
            lat, lng = _scatter(rng, c["lat"], c["lng"], R.MORPH_SPREAD_KM[morph])
            sid = _new_id(rng, ctx.used_ids, rng.choice(R.SITE_PREFIX[c["region"]]))
            vendor = "Huawei" if rng.random() < (0.6 if c["region"] in ("Central", "Southern") else 0.4) else "ZTE"
            if morph in ("Dense Urban", "Urban"):
                rollout = weighted(rng, [("FDD850/TDD2300", 0.55), ("FDD850/TDD2300/TDD2600", 0.25), ("FDD850", 0.2)])
            elif morph == "Sub Urban":
                rollout = weighted(rng, [("FDD850", 0.6), ("FDD850/TDD2300", 0.4)])
            else:
                rollout = "FDD850"
            stype = weighted(rng, [("Macro", 0.8), ("IBC", 0.1), ("Small Cell", 0.1)]) if morph != "Rural" else "Macro"
            type_map = {"Macro": "Macro", "IBC": "In Building", "Small Cell": "Small Cell"}[stype]
            enb += rng.randint(1, 7)
            # ~4% of sites came on air in the last six weeks (shows up in coverage week-over-week)
            if rng.random() < 0.04:
                rfs = ref - dt.timedelta(days=rng.randint(3, 42))
            else:
                rfs = ref - dt.timedelta(days=rng.randint(200, 2200))
            site = {
                "id": sid, "lat": lat, "lng": lng, "vendor": vendor, "rollout": rollout, "type": stype,
                "type_map": type_map, "cluster": c, "enb": enb, "rfs": rfs, "cells": [],
                "morph": morph, "region": c["region"], "state": c["state"],
            }
            ctx.sites4g.append(site)
            ctx.site_by_id[sid] = site
            site_rows.append((
                sid, f"{sid}_{c['name'].upper().replace(' ', '')}",
                f"{sid}T" if "TDD" in rollout else None, vendor, stype, type_map, rollout,
                c["region"], c["state"].title().replace("Wp ", "WP "), c["name"], c["id"], c["name"],
                weighted(rng, [("TNB", 0.7), ("TNB + Battery", 0.25), ("Solar Hybrid", 0.05)]),
                weighted(rng, [("Fiber", 0.75), ("Microwave", 0.25)]),
                enb, str(53000 + ci * 7), str(5300 + ci), morph, round(lat, 6), round(lng, 6),
                f"Lot {rng.randint(1, 9999)}, {rng.choice(R.STREETS)}, {c['name']}, {c['state'].title()}",
                "Operational", weighted(rng, [("TM", 0.5), ("edotco", 0.3), ("Valser", 0.2)]),
                "Yes" if rng.random() < 0.05 else "No", f"{c['name']} Exchange", c["district"],
            ))
            # cells
            sectors = {"Macro": 3, "IBC": rng.randint(1, 2), "Small Cell": 1}[stype]
            base_az = rng.uniform(0, 119)
            local = 0
            for token in rollout.split("/"):
                band, digit, bw, band_offset = R.FREQ_BANDS[token]
                for s in range(1, sectors + 1):
                    local += 1
                    suffix = f"0{digit}{s}"
                    az = round((base_az + 120 * (s - 1)) % 360) if stype == "Macro" else 0
                    cell = {
                        "name": f"{sid}_{c['name']}_{suffix}", "site_cell_id": f"{sid}_{suffix}",
                        "suffix": suffix, "cell_id": int(suffix), "azimuth": az, "band": band,
                        "band_offset": band_offset, "sectorised": stype == "Macro", "sector": s,
                        "eci": enb * 256 + local,
                    }
                    site["cells"].append(cell)
                    ctx.cell_by_name[cell["name"]] = (site, cell)
                    cell_rows.append((
                        cell["name"], cell["cell_id"], sid, float(cell["eci"]), band,
                        rng.choice(ANTENNA[vendor]), rng.choice(RRU[vendor]), float(az),
                        str(rng.choice([18, 24, 30, 36, 42]) if stype == "Macro" else 4),
                        str(rng.randint(0, 8)), str(rng.randint(0, 4)), float(rng.randint(0, 503)),
                        round(rng.uniform(12.2, 18.2), 1), rfs.isoformat(),
                        R.MORPH_RADIUS_KM[morph] * (0.6 if "TDD" in band else 1.0), bw, float(s),
                        cell["site_cell_id"],
                    ))
    bulk_insert(ctx.con, "Site4G",
                ["Site_ID", "Site_Name", "TDD_Site_ID", "Vendor", "Type", "Type_Map", "Rollout", "Region",
                 "State", "Mukim_Area", "Cluster_ID", "Cluster_Name", "Power", "Backhaul", "eNodeB_ID", "TAC",
                 "TAL", "RFP_Morphology", "Latitude", "Longitude", "Address", "Status", "Owner", "ZBC_Border",
                 "TM_Exchange", "Exchange_ABB"], site_rows)
    bulk_insert(ctx.con, "Cell4G",
                ["Cell_Name", "Cell_ID", "Site_ID", "ECI", "Freq_Band", "Antenna_Model", "RRU", "Azimuth",
                 "Antenna_Height", "E_Tilt", "M_Tilt", "PCI", "RS_Power", "Date_Status_RFS", "Radius",
                 "Bandwidth", "Sector_ID", "Site_Cell_ID"], cell_rows)
    ctx.index4g = SpatialIndex(ctx.sites4g)


def build_sites_other(ctx):
    rng, ref = ctx.rng, ctx.ref
    # --- 5G (DNB) -----------------------------------------------------------
    s5, c5 = [], []
    gnb, enb = 300100, 500100
    counters = {}
    for c in ctx.clusters.values():
        n = {"Dense Urban": 6, "Urban": 4}.get(c["morph"], 0)
        hosts = [s for s in ctx.sites4g if s["cluster"] is c and s["type"] == "Macro"]
        for k in range(n):
            if hosts and rng.random() < 0.7:
                h = rng.choice(hosts)
                lat, lng = geo.offset(h["lat"], h["lng"], rng.uniform(0, 360), 0.02)
            else:
                lat, lng = _scatter(rng, c["lat"], c["lng"], R.MORPH_SPREAD_KM[c["morph"]])
            counters[c["district"]] = counters.get(c["district"], 0) + rng.randint(1, 9)
            sid = f"DA{c['district']}{counters[c['district']]:04d}"
            gnb += rng.randint(1, 5)
            enb += rng.randint(1, 5)
            site = {"id": sid, "lat": lat, "lng": lng, "cluster": c, "enb": enb, "gnb": gnb,
                    "region": c["region"], "state": c["state"], "cells": []}
            ctx.sites5g.append(site)
            ctx.site5g_by_id[sid] = site
            s5.append((sid, f"{sid}_{c['name'].upper().replace(' ', '')}", "Macro", "Macro", c["region"],
                       c["state"], c["name"].upper(), f"P{c['district']}_{k + 1:02d}", float(gnb), float(enb),
                       5100 + len(s5), round(lat, 6), round(lng, 6),
                       f"{rng.choice(R.STREETS)}, {c['name']}", "Operational"))
            base_az = rng.uniform(0, 119)
            for s in range(1, 4):
                az = round((base_az + 120 * (s - 1)) % 360)
                site["cells"].append({"site_cell_id": f"{sid}_{s}", "azimuth": az, "name": f"{sid}_N78_{s}"})
                c5.append((sid, f"{sid}_N78_{s}", float(s), f"{sid}_{s}", float(rng.randint(0, 1007)), "100",
                           636666, f"502152{gnb:07d}{s:03d}", str(az), str(rng.choice([24, 30, 36]))))
    bulk_insert(ctx.con, "Site5G",
                ["Site_ID", "Site_Name", "Type", "Type_Map", "Region", "State", "District", "Cluster_ID",
                 "gNodeB_ID", "eNodeB_ID", "TAC", "Latitude", "Longitude", "Address", "Status"], s5)
    bulk_insert(ctx.con, "Cell5G",
                ["Site_ID", "Cell_Name", "Cell_ID", "Site_Cell_ID", "PCI", "DL_BW", "DL_EARFCN", "nCGI",
                 "Azimuth", "Height"], c5)
    ctx.index5g = SpatialIndex(ctx.sites5g)

    # --- MOCN (Maxis-hosted 4G) --------------------------------------------
    sm, sm_enb, cm = [], [], []
    menb = 700100
    phases = ["Batch 6 2022 - 447  Sites", "Batch 3 2021 - 176 Sites", "Batch 1 - 64 Sites"]
    for c in ctx.clusters.values():
        n = {"Dense Urban": 0, "Urban": 2, "Sub Urban": 7, "Rural": 9}[c["morph"]]
        spread = R.MORPH_SPREAD_KM[c["morph"]]
        for _ in range(n):
            lat, lng = _scatter(rng, c["lat"], c["lng"], spread, lo=spread * 1.1, hi=spread * 2.6)
            sid = _new_id(rng, ctx.used_ids, rng.choice(R.SITE_PREFIX[c["region"]]), digits=5)
            menb += rng.randint(1, 5)
            site = {"id": sid, "lat": lat, "lng": lng, "cluster": c, "enb": menb, "region": c["region"],
                    "state": c["state"], "cells": []}
            ctx.sites_mocn.append(site)
            ctx.site_mocn_by_id[sid] = site
            sm.append((sid, rng.choice(phases), rng.choice(["Huawei", "Ericsson"]), "Macro", "Macro",
                       c["region"].upper(), c["state"], c["name"], float(rng.choice([187, 752, 753, 762])),
                       f"MX{rng.randint(10000, 99999)}_{c['name'].upper().replace(' ', '')}",
                       round(lat, 6), round(lng, 6), f"{rng.choice(R.STREETS)}, {c['name']}"))
            sm_enb.append((sid, menb, round(lat, 6), round(lng, 6)))
            base_az = rng.uniform(0, 119)
            for s in range(1, 4):
                az = round((base_az + 120 * (s - 1)) % 360)
                site["cells"].append({"name": f"{sid}_{s}", "azimuth": az, "cell_id": s})
                cm.append((f"{sid}_{s}", str(s), sid, menb * 256 + s, rng.choice([1850, 3500]), az,
                           rng.randint(0, 503)))
    bulk_insert(ctx.con, "SiteMOCN",
                ["Site_ID", "Phase", "Vendor", "Type", "Type_Map", "Region", "State", "Cluster", "TAC",
                 "eNobeB_Name", "Latitude", "Longitude", "Address"], sm)
    bulk_insert(ctx.con, "Site4GMOCN", ["SITE_ID", "ENODEB_ID", "Latitude", "Longitude"], sm_enb)
    bulk_insert(ctx.con, "CellMOCN", ["Cell_Name", "Cell_ID", "Site_ID", "ECI", "DL_EARFCN", "Azimuth", "PCI"], cm)
    ctx.index_mocn = SpatialIndex(ctx.sites_mocn)

    # --- 3G / 2G (domestic roaming partner sites) ---------------------------
    s3, c3, s2, c2 = [], [], [], []
    for c in ctx.clusters.values():
        for tech in ("3G", "2G"):
            for _ in range(rng.randint(3, 5)):
                lat, lng = _scatter(rng, c["lat"], c["lng"], R.MORPH_SPREAD_KM[c["morph"]] * 1.3)
                prefix = ("U" if tech == "3G" else "G") + rng.choice(R.SITE_PREFIX[c["region"]])
                sid = _new_id(rng, ctx.used_ids, prefix)
                vendor = rng.choice(["Ericsson", "Nokia"])
                name = f"{c['name'].upper()}_{sid[-4:]}"
                addr = f"{rng.choice(R.STREETS)}, {c['name']}"
                if tech == "3G":
                    s3.append((sid, name, "Macro", "Macro", c["region"], c["state"], vendor,
                               str(rng.randint(10000, 19999)), str(rng.randint(1000, 9999)),
                               round(lat, 6), round(lng, 6), addr))
                    for s in range(1, 4):
                        c3.append((rng.randint(10000, 65000), sid, f"{sid}_{s}", float(120 * (s - 1)),
                                   float(rng.choice([24, 30, 36])), "UMTS2100", rng.choice([10638, 10663, 10688])))
                else:
                    s2.append((sid, name, f"{sid}_Macro", "Macro", "Macro", c["region"], c["state"], vendor,
                               str(rng.randint(0, 63)), round(lat, 6), round(lng, 6), addr))
                    for s in range(1, 4):
                        c2.append((f"{sid}{s}", sid, f"{sid}_{s}", float(120 * (s - 1)),
                                   float(rng.choice([24, 30, 36])), rng.randint(10000, 19999),
                                   float(rng.randint(1, 124)), rng.choice(["GSM900", "DCS1800"]),
                                   str(rng.randint(0, 7)), float(rng.randint(0, 7))))
                site = {"id": sid, "lat": lat, "lng": lng, "cluster": c, "tech": tech}
                (ctx.sites3g if tech == "3G" else ctx.sites2g).append(site)
    bulk_insert(ctx.con, "Site3G", ["Site_ID", "Sitename", "Type", "Type_Map", "Region", "State", "Vendor",
                                    "LAC", "SAC", "Latitude", "Longitude", "Address"], s3)
    bulk_insert(ctx.con, "Cell3G", ["Cell_ID", "Site_ID", "Site_Cell_ID", "Azimuth", "Antenna_Height",
                                    "Freq_Band", "DL_UARFCN"], c3)
    bulk_insert(ctx.con, "Site2G", ["Site_ID", "Sitename", "Site_ID_Type", "Type", "Type_Map", "Region", "State",
                                    "Vendor", "BSIC", "Latitude", "Longitude", "Address"], s2)
    bulk_insert(ctx.con, "Cell2G", ["Traffic_Cell_Name", "Site_ID", "Site_Cell_ID", "Azimuth", "Antenna_Height",
                                    "LAC", "BCCH", "Freq_Band", "NCC", "BCC"], c2)
    ctx.index2g = SpatialIndex(ctx.sites2g)

    # --- AOP (planned rollout) ---------------------------------------------
    aop = []
    for i in range(1, 71):
        c = rng.choice(list(ctx.clusters.values()))
        lat, lng = _scatter(rng, c["lat"], c["lng"], R.MORPH_SPREAD_KM[c["morph"]] * 1.4)
        sid = _new_id(rng, ctx.used_ids, rng.choice(R.SITE_PREFIX[c["region"]]))
        rfs = rng.random() < 0.15
        base = ref + dt.timedelta(days=rng.randint(-60, 240))
        aop.append((i, sid, rng.choice(["AOP2026", "AOP2027"]),
                    rng.choice(["Site Acquisition", "Civil Works", "Installation", "Integration", "Pending Permit"]),
                    f"{sid}_{c['name'].upper().replace(' ', '')}", c["region"], round(lng, 6), round(lat, 6),
                    "RFS" if rfs else None, base if rfs else None, None, base,
                    f"Q{(base.month - 1) // 3 + 1} {base.year}", rng.choice(["Type A", "Type B", "Type C"])))
    bulk_insert(ctx.con, "SiteAOP", ["id", "site_id", "new_aop", "pmo_summary", "site_name", "region", "longitude",
                                     "latitude", "status", "fdd850_rfs_date", "tdd_rfs_date", "rfs_baseline",
                                     "target_quarter", "type_map"], aop)


# ---------------------------------------------------------------------------
# BIN grid
# ---------------------------------------------------------------------------
BIN_STEP = 0.004


def build_bins(ctx):
    rng = ctx.rng
    bins = {}
    for c in ctx.clusters.values():
        if c["morph"] not in ("Dense Urban", "Urban"):
            continue
        r_km = 2.4
        dlat = r_km / 110.574
        dlng = r_km / (111.32 * math.cos(math.radians(c["lat"])))
        i0, i1 = round((c["lat"] - dlat) / BIN_STEP), round((c["lat"] + dlat) / BIN_STEP)
        j0, j1 = round((c["lng"] - 99 - dlng) / BIN_STEP), round((c["lng"] - 99 + dlng) / BIN_STEP)
        for i in range(i0, i1 + 1):
            for j in range(j0, j1 + 1):
                lat, lng = i * BIN_STEP, 99 + j * BIN_STEP
                if geo.haversine_km(lat, lng, c["lat"], c["lng"]) > r_km:
                    continue
                gid = i * 10000 + j
                if gid not in bins:
                    bins[gid] = {"grid_id": gid, "lat": lat, "lng": lng, "cluster": c}

    info_rows, base_rows, top_rows, place_rows = [], [], [], []
    h = BIN_STEP / 2
    pid = 0
    for b in bins.values():
        lat, lng, c = b["lat"], b["lng"], b["cluster"]
        ring = [[lng - h, lat - h], [lng + h, lat - h], [lng + h, lat + h], [lng - h, lat + h], [lng - h, lat - h]]
        ring = [[round(x, 6), round(y, 6)] for x, y in ring]
        info_rows.append((b["grid_id"], c["state"].title()[:20], c["id"], round(lat, 6), round(lng, 6),
                          geo.polygon_geojson(ring), lat - h, lat + h, lng - h, lng + h))
        # serving cells
        cands = []
        for site in ctx.index4g.nearest(lat, lng, k=4):
            for cell in site["cells"]:
                cands.append((cell_rsrp(site, cell, lat, lng) + rng.gauss(0, 2.5), site, cell))
        cands.sort(key=lambda t: -t[0])
        top = cands[:5]
        best = top[0][0] if top else -125.0
        rsrp = clamp(best + rng.gauss(0, 1.5), -135, -50)
        rsrq = rsrq_from_rsrp(rng, rsrp)
        dl = clamp(140.0 / (1 + math.exp(-(rsrp + 102) / 6.0)) + rng.gauss(0, 4), 0.5, 280)
        ul = clamp(dl * rng.uniform(0.18, 0.35), 0.2, 80)
        lat_ms = int(clamp(16 + (-rsrp - 70) * 0.45 + rng.gauss(0, 3), 9, 120))
        base_rows.append((b["grid_id"], rsrp, rsrq, dl, ul, lat_ms))
        b["rsrp"] = rsrp
        for rank, (val, site, cell) in enumerate(top, start=1):
            v = clamp(val, -135, -50)
            top_rows.append((b["grid_id"], site["id"], cell["site_cell_id"], site["vendor"], site["enb"],
                             cell["name"], cell["suffix"], rank, v, rsrq_from_rsrp(rng, v)))
        # places
        dense = c["morph"] == "Dense Urban"
        for _ in range(rng.randint(1, 9) if dense else rng.randint(0, 5)):
            cat = rng.choices(R.POI_CATEGORIES, weights=[1, 2, 1, 3, 2, 4, 3, 2, 6])[0]
            pid += 1
            place_rows.append((pid, b["grid_id"], "poi", cat, f"{rng.choice(R.POI_NAMES[cat])} {c['name']}",
                               lat + rng.uniform(-h, h), lng + rng.uniform(-h, h)))
        for _ in range(rng.randint(4, 20) if dense else rng.randint(0, 10)):
            pid += 1
            ptype = rng.choice(R.PROPERTY_TYPES)
            place_rows.append((pid, b["grid_id"], "property", ptype,
                               f"No. {rng.randint(1, 250)}, {rng.choice(R.STREETS)}",
                               lat + rng.uniform(-h, h), lng + rng.uniform(-h, h)))
    ctx.bins = bins
    bulk_insert(ctx.con, "Bin_Information", ["Grid_ID", "State", "Cluster_ID", "latitude", "longitude", "geometry",
                                             "min_lat", "max_lat", "min_lng", "max_lng"], info_rows)
    bulk_insert(ctx.con, "bin_places", ["id", "grid_id", "place_type", "category", "name", "latitude",
                                        "longitude"], place_rows)
    con = ctx.con
    con.execute("CREATE TEMP TABLE _bin_base (grid_id INT, rsrp DOUBLE, rsrq DOUBLE, dl DOUBLE, ul DOUBLE, lat_ms INT)")
    bulk_insert(con, "_bin_base", ["grid_id", "rsrp", "rsrq", "dl", "ul", "lat_ms"], base_rows)
    con.execute("""CREATE TEMP TABLE _top_base (grid_id INT, site_id VARCHAR, site_cell_id VARCHAR, vendor VARCHAR,
                   enb INT, cell_name VARCHAR, cell_id VARCHAR, rnk INT, rsrp DOUBLE, rsrq DOUBLE)""")
    bulk_insert(con, "_top_base", ["grid_id", "site_id", "site_cell_id", "vendor", "enb", "cell_name", "cell_id",
                                   "rnk", "rsrp", "rsrq"], top_rows)
    con.execute("CREATE TEMP TABLE _ops (operator VARCHAR, off DOUBLE)")
    bulk_insert(con, "_ops", ["operator", "off"], list(R.OPERATORS.items()))

    # BGS (RSRP/RSRQ) and CI (throughput/latency), weekly + longer durations
    bgs_cols = """b.grid_id, b.operator,
        r + 3 + random() * 8 AS rsrp_max, r - 3 - random() * 10 AS rsrp_min, r * n AS rsrp_sum, n AS rsrp_count, r AS rsrp_avg,
        least(q + 1 + random() * 3, -3) AS rsrq_max, q - 1 - random() * 4 AS rsrq_min, q * n AS rsrq_sum, n AS rsrq_count, q AS rsrq_avg"""
    bgs_src = """(SELECT b.*, o.operator, o.off,
            b.rsrp + o.off + (random() - 0.5) * 5 AS r,
            least(b.rsrq + o.off / 3 + (random() - 0.5) * 1.5, -3) AS q,
            (20 + random() * 400)::BIGINT AS n
         FROM _bin_base b, _ops o WHERE o.operator = 'Unifi' OR random() < 0.85) b"""
    ci_cols = """b.grid_id, b.operator,
        dlv * n AS sum_download_mbps, n AS sample_download,
        dlv * (0.2 + random() * 0.3) AS min_download_mbps, dlv * (1.4 + random() * 0.8) AS max_download_mbps, dlv AS avg_download_mbps,
        ulv * n AS sum_upload_mbps, n AS sample_upload,
        ulv * (0.2 + random() * 0.3) AS min_upload_mbps, ulv * (1.4 + random() * 0.8) AS max_upload_mbps, ulv AS avg_upload_mbps,
        (lat_ms * n)::BIGINT, n, greatest(5, lat_ms - 8)::BIGINT, (lat_ms * 3)::BIGINT, lat_ms::BIGINT"""
    ci_src = """(SELECT b.grid_id, o.operator, b.lat_ms,
            greatest(0.3, b.dl * (1 + o.off / 20) * (0.8 + random() * 0.4)) AS dlv,
            greatest(0.1, b.ul * (1 + o.off / 20) * (0.8 + random() * 0.4)) AS ulv,
            (5 + random() * 120)::BIGINT AS n
         FROM _bin_base b, _ops o WHERE o.operator = 'Unifi' OR random() < 0.8) b"""
    ts = f"TIMESTAMP '{ctx.ref.isoformat()} 03:00:00'"
    con.execute(f"""INSERT INTO bin_bgs_weekly
        SELECT row_number() OVER (), w.year, w.week, w.year || lpad(w.week::VARCHAR, 2, '0'), {bgs_cols}, {ts}
        FROM {bgs_src}, _weeks w""")
    con.execute(f"""INSERT INTO bin_ci_weekly
        SELECT row_number() OVER (), w.year, w.week, w.year || lpad(w.week::VARCHAR, 2, '0'), {ci_cols}, {ts}
        FROM {ci_src}, _weeks w""")
    for dur in ("monthly", "bi_monthly", "quarterly", "half_yearly", "yearly"):
        con.execute(f"INSERT INTO bin_bgs_{dur} SELECT row_number() OVER (), {ctx.ref.year}, {bgs_cols}, {ts} FROM {bgs_src}")
        con.execute(f"INSERT INTO bin_ci_{dur} SELECT row_number() OVER (), {ctx.ref.year}, {ci_cols}, {ts} FROM {ci_src}")

    top_cols = """t.grid_id, t.site_id, t.site_cell_id, t.vendor, t.enb, t.cell_name, t.cell_id, t.rnk,
        r, r + 2 + random() * 6, r - 2 - random() * 8, r * n,"""
    top_tail = "q, least(q + 1 + random() * 2, -3), q - 1 - random() * 3, q * n"
    top_src = """(SELECT *, rsrp + (random() - 0.5) * 3 AS r, least(rsrq + (random() - 0.5), -3) AS q,
                 (10 + random() * 300)::BIGINT AS n FROM _top_base) t"""
    con.execute(f"""INSERT INTO Bin_BGS_Top_Cell_Weekly
        SELECT row_number() OVER (), w.year, w.week, {top_cols} n, {top_tail}, n FROM {top_src}, _weeks w
        WHERE w.idx <= 5""")
    for dur in ("Monthly", "Bi_Monthly", "Quarterly", "Half_Yearly", "Yearly"):
        con.execute(f"""INSERT INTO Bin_BGS_Top_Cell_{dur}
            SELECT row_number() OVER (), {ctx.ref.year}, {top_cols} n, {top_tail}, n FROM {top_src}""")


# ---------------------------------------------------------------------------
# EMS, HWC, handover
# ---------------------------------------------------------------------------
def build_ems(ctx):
    con = ctx.con
    con.execute("""CREATE TEMP TABLE _cellq AS
        SELECT c.Cell_Name, c.Site_ID, c.Cell_ID, c.Site_Cell_ID, c.Freq_Band, c.Bandwidth, s.Vendor,
               s.Region, s.State, s.Site_Name, (hash(c.Cell_Name) % 100)::INT AS q
        FROM Cell4G c JOIN Site4G s ON s.Site_ID = c.Site_ID""")
    for vendor, table in (("Huawei", "HUAWEI_EMS"), ("ZTE", "ZTE_EMS")):
        con.execute(f"""INSERT INTO {table}
        SELECT row_number() OVER (), Cell_Name, Site_ID, Cell_ID::VARCHAR, week, year,
            dl_traffic, dl_traffic * 0.12, prb, prb * 0.45, thr, thr * 0.3, users,
            greatest(3, 7 + r2 * 5 - CASE WHEN cs <> '' THEN 1.5 ELSE 0 END),
            dl_traffic * 0.3, dl_traffic * 0.7, users * 0.3, users * 0.7, prb * 0.3, prb * 0.7,
            cs, less1, 100 - less1, CASE WHEN less1 >= 50 THEN '<1KM' ELSE '>1KM' END,
            CASE WHEN r1 < 0.3 THEN '0KM_To_0_078KM' WHEN r1 < 0.6 THEN '0_078KM_To_0_234KM'
                 WHEN r1 < 0.85 THEN '0_234KM_To_0_546KM' ELSE '0_546KM_To_1_014KM' END
        FROM (
            SELECT *,
                CASE cs WHEN 'Congestion' THEN 82 + r1 * 16 WHEN 'Congestion2' THEN 70 + r1 * 14 ELSE 12 + r1 * 55 END AS prb,
                CASE cs WHEN 'Congestion' THEN 0.8 + r2 * 1.6 WHEN 'Congestion2' THEN 2 + r2 * 3 ELSE 5 + r2 * 25 END AS thr,
                CASE WHEN cs <> '' THEN 18 + r1 * 25 ELSE 2 + r1 * 16 END AS users,
                (CASE WHEN cs <> '' THEN 18 + r1 * 25 ELSE 2 + r1 * 16 END) * 35 * (0.7 + r2 * 0.6) AS dl_traffic,
                30 + r1 * 60 AS less1
            FROM (
                SELECT c.*, w.week, w.year, random() AS r1, random() AS r2,
                    CASE WHEN c.q < 6 AND random() < 0.85 THEN 'Congestion'
                         WHEN c.q < 11 AND random() < 0.45 THEN 'Congestion2' ELSE '' END AS cs
                FROM _cellq c, _weeks w WHERE c.Vendor = '{vendor}'
            )
        )""")

    # HWC status from the last four weeks of EMS congestion
    rows = con.execute("""
        SELECT cell_name, count(*) FILTER (WHERE Congestion_Status <> '') AS n
        FROM (SELECT * FROM HUAWEI_EMS UNION ALL SELECT * FROM ZTE_EMS) e
        JOIN _weeks w ON w.week = e.Week_No AND w.year = e.Year AND w.idx <= 4
        GROUP BY cell_name""").fetchall()
    year, week = iso(ctx.ref - dt.timedelta(days=7))
    hwc_rows = []
    for name, n in rows:
        site, cell = ctx.cell_by_name[name]
        status = "Hot" if n >= 3 else "Warm" if n >= 1 else "Cold"
        cell["hwc"] = status
        r_km = R.MORPH_RADIUS_KM[site["morph"]] * (0.6 if "TDD" in cell["band"] else 0.9)
        ring = geo.wedge(site["lat"], site["lng"], cell["azimuth"], r_km, beamwidth=65 if cell["sectorised"] else 360)
        hwc_rows.append((name, status, week, year, geo.polygon_geojson(ring), *geo.ring_bbox(ring)))
    bulk_insert(con, "HWC_Status", ["Cell_Name", "HWC_Status", "Week", "Year", "geometry", "min_lat", "max_lat",
                                    "min_lng", "max_lng"], hwc_rows)

    # Handover neighbours: same-band cells on the three nearest sites
    con.execute("""CREATE TEMP TABLE _site_pairs AS
        SELECT * FROM (
            SELECT a.Site_ID AS local_site, b.Site_ID AS target_site, b.Latitude AS tlat, b.Longitude AS tlng,
                   haversine_km(a.Latitude, a.Longitude, b.Latitude, b.Longitude) AS d,
                   row_number() OVER (PARTITION BY a.Site_ID
                                      ORDER BY haversine_km(a.Latitude, a.Longitude, b.Latitude, b.Longitude)) AS rn
            FROM Site4G a JOIN Site4G b ON a.Site_ID <> b.Site_ID
             AND abs(a.Latitude - b.Latitude) < 0.1 AND abs(a.Longitude - b.Longitude) < 0.1
        ) WHERE rn <= 3""")
    con.execute("""INSERT INTO History_Performance_Handover_4G
        SELECT row_number() OVER (), local_cell_name, local_site_id, local_cell_id, target_cell_name, target_site_id,
               target_cell_id, hs, local_sc, target_sc,
               row_number() OVER (PARTITION BY local_cell_name ORDER BY hs DESC), azimuth, sector_id, vendor, tlng, tlat
        FROM (
            SELECT lc.Cell_Name AS local_cell_name, lc.Site_ID AS local_site_id, lc.Cell_ID::VARCHAR AS local_cell_id,
                   tc.Cell_Name AS target_cell_name, tc.Site_ID AS target_site_id, tc.Cell_ID::VARCHAR AS target_cell_id,
                   (4000 * exp(-p.d) * (0.3 + random()))::INT AS hs, lc.Site_Cell_ID AS local_sc,
                   tc.Site_Cell_ID AS target_sc, lc.Azimuth AS azimuth, tc.Sector_ID AS sector_id, s.Vendor AS vendor,
                   p.tlng, p.tlat
            FROM _site_pairs p
            JOIN Cell4G lc ON lc.Site_ID = p.local_site
            JOIN Cell4G tc ON tc.Site_ID = p.target_site AND tc.Freq_Band = lc.Freq_Band
            JOIN Site4G s ON s.Site_ID = lc.Site_ID
            WHERE random() < 0.7
        )""")


# ---------------------------------------------------------------------------
# Coverage / congestion map layers
# ---------------------------------------------------------------------------
def build_coverage_layers(ctx):
    rng, con = ctx.rng, ctx.con
    weeks = con.execute("SELECT year, week, monday FROM _weeks ORDER BY idx").fetchall()
    congested = {}
    for name, wk, yr in con.execute("""SELECT cell_name, Week_No, Year FROM
            (SELECT * FROM HUAWEI_EMS UNION ALL SELECT * FROM ZTE_EMS) WHERE Congestion_Status <> ''""").fetchall():
        congested.setdefault((yr, wk), []).append(name)
    actions = ["Capacity upgrade - add TDD2600 layer", "Load balancing parameter tuning",
               "Add new sector", "Monitor traffic growth", "Site split - new small cell"]
    rows = []
    rid = 0

    def add(coll, year, week, site_id, ring, name=None, action=None, target=None):
        nonlocal rid
        rid += 1
        rows.append((rid, coll, week, year, site_id, name, action, target, geo.polygon_geojson(ring),
                     *geo.ring_bbox(ring)))

    jit = lambda: rng.uniform(0.85, 1.15)  # noqa: E731
    for year, week, monday in weeks:
        for s in ctx.sites4g:
            if s["rfs"] > monday + dt.timedelta(days=6):
                continue
            r = R.MORPH_RADIUS_KM[s["morph"]] * (0.35 if s["type"] != "Macro" else 1.0)
            add("Coverage_FDD", year, week, s["id"], geo.circle(s["lat"], s["lng"], r, n=10, jitter=jit))
            if "TDD" in s["rollout"]:
                add("Coverage_TDD", year, week, s["id"], geo.circle(s["lat"], s["lng"], r * 0.6, n=10, jitter=jit))
            for cell in s["cells"]:
                if cell.get("hwc") in ("Hot", "Warm"):
                    ring = geo.wedge(s["lat"], s["lng"], cell["azimuth"], r * 0.8,
                                     beamwidth=65 if cell["sectorised"] else 360)
                    add("HWC", year, week, s["id"], ring, cell["name"], rng.choice(actions),
                        rng.choice(["Q4 2026", "Q1 2027", "Q2 2027"]))
        for s in ctx.sites5g:
            add("Coverage_5G", year, week, s["id"], geo.circle(s["lat"], s["lng"], 0.45, n=10, jitter=jit))
        for s in ctx.sites_mocn:
            add("Coverage_MOCN", year, week, s["id"], geo.circle(s["lat"], s["lng"], 1.8, n=10, jitter=jit))
        for name in congested.get((year, week), []):
            s, cell = ctx.cell_by_name[name]
            coll = "Congestion_TDD" if "TDD" in cell["band"] else "Congestion_FDD"
            r = R.MORPH_RADIUS_KM[s["morph"]] * (0.6 if "TDD" in cell["band"] else 0.9)
            add(coll, year, week, s["id"],
                geo.wedge(s["lat"], s["lng"], cell["azimuth"], r, beamwidth=65 if cell["sectorised"] else 360),
                cell["name"])
    bulk_insert(con, "coverage_layers", ["id", "collection", "Week", "Year", "site_id", "Name", "Action", "Target",
                                         "geometry", "min_lat", "max_lat", "min_lng", "max_lng"], rows)


# ---------------------------------------------------------------------------
# NTT, maintenance, congestion table, dashboards, CTT
# ---------------------------------------------------------------------------
NTT_COLUMNS = ["id", "mid", "business_event", "ntt_no", "created_date", "network_element_ne_id",
               "network_element_type", "network_element_brand", "network_element_port", "region", "ptt",
               "building", "fault_category", "service_impacted", "possible_symptoms", "resp_unit", "ettr",
               "ettr_counter", "problem_desc", "major_breakdown", "faulty_severity", "status",
               "network_element_card_id", "network_element_card", "network_element_port_id"]
NTT5G_COLUMNS = ["id", "source_initiator", "destination", "dnb_incident_id", "tm_incident_id", "esb_id", "summary",
                 "incident_description", "node_ci", "hpd_ci", "incident_type", "incident_impact", "incident_urgency",
                 "incident_priority", "incident_status", "assigned_group", "incident_categorization_tier1",
                 "incident_categorization_tier2", "incident_categorization_tier3", "resolution_category_tier1",
                 "resolution_category_tier2", "resolution_category_tier3", "resolution_note", "region",
                 "transaction_type", "event_start_time", "event_end_time", "submit_date", "last_modified_date",
                 "last_resolved_date"]
PM_COLUMNS = ["RFC ID", "Creation_Date", "Week", "Status", "Title", "Planned Start", "Planned End",
              "Requester Name", "Requestor Division", "RFC Type", "Reason", "NCA/CA", "Sub Network", "Region",
              "Hostname"]


def ntt_ticket(ctx, rng, events, outage_days, site, created, fault, final, forced_symptom=None,
               problem=None, major=None, resp=None):
    """Append the update events of one 4G NTT to `events` and its outage days to `outage_days`."""
    ref_dt = ctx.ref_dt
    symptom = forced_symptom or rng.choice(R.NTT_SYMPTOMS)
    ettr = created + dt.timedelta(hours=rng.uniform(4, 36))
    ne = site["id"]
    if rng.random() < 0.1:
        other = ctx.index4g.nearest(site["lat"], site["lng"], k=2)[-1]
        ne = f"{site['id']},{other['id']}"
    ntt_no = f"NTT-{created:%Y%m%d}-{rng.randint(10000, 99999)}"
    n_rows = rng.randint(1, 3)
    resp = resp or ("LTE 4G" if rng.random() < 0.92 else rng.choice(["IP CORE", "TRANSMISSION"]))
    base = {
        "ntt_no": ntt_no, "created": created, "ne": ne, "site": site, "fault": fault, "symptom": symptom,
        "ettr": ettr, "resp": resp,
        "impact": f"Unifi Mobile:{rng.randint(50, 3000)}",
        "major": major or ("Y" if fault == "Total Outage" and rng.random() < 0.3 else "N"),
        "sev": {"Total Outage": "Critical", "Partial Outage": "Major"}.get(fault, "Minor"),
        "problem": problem or R.NTT_PROBLEMS[symptom],
    }
    span = max((min(ettr, ref_dt) - created).total_seconds(), 600)
    for k in range(n_rows):
        last = k == n_rows - 1
        when = created + dt.timedelta(seconds=span * k / max(n_rows, 1))
        status = final if last else "Open"
        events.append((when, base, status, "TT_CREATE" if k == 0 else ("TT_CLOSE" if last and final != "Open" else "TT_UPDATE")))
    if fault in ("Total Outage", "Partial Outage") and resp == "LTE 4G":
        end = ref_dt if final == "Open" else ettr
        d = created.date()
        while d <= end.date():
            outage_days.add((site["id"], d))
            d += dt.timedelta(days=1)
    return ntt_no


def ntt_rows(rng, events, first_id=1):
    """ntt_granite rows for `events`, ids from `first_id` in event-time order."""
    events.sort(key=lambda e: e[0])
    rows = []
    for i, (when, b, status, event) in enumerate(events, start=first_id):
        s = b["site"]
        rows.append((i, f"MID{100000 + i}", event, b["ntt_no"], b["created"], b["ne"], "E NODE B",
                     s["vendor"].upper(), f"S1-{rng.randint(1, 4)}", s["region"].upper(), s["state"],
                     f"{s['id']}_{s['cluster']['name'].upper().replace(' ', '')}", b["fault"], b["impact"],
                     b["symptom"], b["resp"], b["ettr"], int((b["ettr"] - b["created"]).total_seconds() // 3600),
                     b["problem"], b["major"], b["sev"], status, f"CARD-{rng.randint(1, 8)}",
                     "BBU", f"PORT-{rng.randint(1, 12)}"))
    return rows


def ntt5g_incident(rng, ref_dt, inc_events, site, k, created, final, prio=None):
    """Append the CREATE (+ UPDATE) events of one 5G DNB incident to `inc_events`."""
    tm_id = f"INC-{created:%Y%m%d}-{100000 + k:06d}"
    prio = prio or rng.choice(["Critical", "High", "Medium", "Low"])
    end = created + dt.timedelta(hours=rng.uniform(2, 48))
    for j, (tx, st) in enumerate([("CREATE", "Assigned")] + ([("UPDATE", final)] if final != "Assigned" else [])):
        when = created if j == 0 else min(end, ref_dt)
        inc_events.append((when, site, tm_id, k, st, tx, created, end, prio, final))
    return tm_id


def ntt5g_rows(rng, inc_events, first_id=1):
    """ntt_5g_ntt5g rows for `inc_events`, ids from `first_id` in event-time order."""
    inc_events.sort(key=lambda e: e[0])
    rows = []
    for i, (when, site, tm_id, k, st, tx, created, end, prio, final) in enumerate(inc_events, start=first_id):
        closed = st in R.NTT5G_CLOSED
        rows.append((i, rng.choice(["DNB-MS-MY", "ITSM"]), rng.choice(["TM", "DNB"]), f"DNB{10000000 + k}", tm_id,
                     f"ESB-{1000000 + i}", f"5G cell down at {site['id']}", "gNodeB service affecting alarm",
                     f"{site['id']}_gNB", site["id"], "Infrastructure Event",
                     rng.choice(["1-Extensive/Widespread", "2-Significant/Large", "3-Moderate/Limited", "4-Minor/Localized"]),
                     rng.choice(["1-Critical", "2-High", "3-Medium", "4-Low"]), prio, st,
                     rng.choice(["DNB NOC", "TM RAN Ops", "Field Ops"]), "RAN", "Network", "gNodeB",
                     "Hardware" if closed else None, "Replace" if closed else None, "RRU" if closed else None,
                     "Faulty RRU replaced, service restored." if closed else None,
                     f"MY DNB {site['region'].upper()}", tx, created, end if closed else None, created, when,
                     end if closed else None))
    return rows


def build_ntt(ctx):
    rng, ref_dt = ctx.rng, ctx.ref_dt
    events = []
    outage_days = set()

    def ticket(site, created, fault, final, forced_symptom=None):
        ntt_ticket(ctx, rng, events, outage_days, site, created, fault, final, forced_symptom)

    for _ in range(520):
        site = rng.choice(ctx.sites4g)
        created = ref_dt - dt.timedelta(days=rng.uniform(0, 150), hours=rng.uniform(0, 12))
        fault = weighted(rng, R.NTT_FAULTS)
        age = (ref_dt - created).days
        p_open = 0.7 if age < 2 else 0.25 if age < 7 else 0.04
        final = "Open" if rng.random() < p_open else rng.choice(R.NTT_CLOSED_STATUSES)
        ticket(site, created, fault, final)
    # guarantee a handful of live total outages for the demo personas
    for site in rng.sample(ctx.sites4g, 10):
        ticket(site, ref_dt - dt.timedelta(hours=rng.uniform(2, 40)), "Total Outage", "Open", "LTE - 4G Service Down")
        ctx.open_outage_sites.add(site["id"])

    bulk_insert(ctx.con, "ntt_granite", NTT_COLUMNS, ntt_rows(rng, events))
    ctx.con.execute("CREATE TEMP TABLE _outage_days (site_id VARCHAR, dt DATE)")
    bulk_insert(ctx.con, "_outage_days", ["site_id", "dt"], sorted(outage_days))

    # 5G (DNB) incidents
    inc_events = []
    for k in range(170):
        site = rng.choice(ctx.sites5g)
        created = ref_dt - dt.timedelta(days=rng.uniform(0, 150), hours=rng.uniform(0, 12))
        age = (ref_dt - created).days
        p_open = 0.7 if age < 3 else 0.2 if age < 10 else 0.03
        final = rng.choice(R.NTT5G_OPEN) if rng.random() < p_open else weighted(
            rng, [("Resolved", 0.45), ("Closed", 0.45), ("Cancelled", 0.1)])
        ntt5g_incident(rng, ref_dt, inc_events, site, k, created, final)
    bulk_insert(ctx.con, "ntt_5g_ntt5g", NTT5G_COLUMNS, ntt5g_rows(rng, inc_events))


def rfc_row(rng, seq, host, region, created, start, end, status, nca="CA", subnet=None, title=None, reason=None):
    """One Webe_Plan_Maintenance row; `title` defaults to the sub network's standard title."""
    subnet = subnet or rng.choice(R.PM_SUBNET)
    return (f"RFC-WEBE-{created:%y%m%d}-{seq:04d}", created, iso(created.date())[1], status,
            f"{title or R.PM_TITLES[subnet]} - {host}", start, end, rng.choice(R.PERSON_NAMES),
            rng.choice(R.PM_DIVISION), rng.choice(R.PM_RFC_TYPE), reason or rng.choice(R.PM_REASON), nca, subnet,
            region, host)


def rfc_window(rng, ref_dt, created):
    """Night-time maintenance window 2-14 days after creation, with a status that fits its timing."""
    start = (created + dt.timedelta(days=rng.uniform(2, 14))).replace(hour=rng.choice([0, 1, 2, 22, 23]), minute=0, second=0)
    end = start + dt.timedelta(hours=rng.uniform(2, 8))
    if end < ref_dt:
        status = weighted(rng, [("CLOSE", 0.78), ("IMPLEMENTERCANCELLED", 0.08), ("CABREJECT", 0.05),
                                ("ReqCancel", 0.05), ("CCREJECT", 0.04)])
    else:
        status = weighted(rng, [("WIMPLEMENTER", 0.5), ("WCAB", 0.4), ("WCC", 0.1)])
    return start, end, status


def build_plan_maintenance(ctx):
    rng, ref_dt = ctx.rng, ctx.ref_dt
    rows = []

    def rfc(host, region, created, start, end, status, nca="CA", subnet=None):
        rows.append(rfc_row(rng, len(rows) + 1, host, region, created, start, end, status, nca, subnet))

    for _ in range(420):
        if rng.random() < 0.88:
            site = rng.choice(ctx.sites4g)
            host, region, subnet = site["id"], site["region"].upper(), None
        else:
            host, region, subnet = rng.choice(R.CORE_HOSTS), rng.choice(["CENTRAL", "WILAYAH PERSEKUTUAN", "SOUTHERN"]), rng.choice(R.PM_CORE_SUBNET)
        created = ref_dt - dt.timedelta(days=rng.uniform(0, 120))
        start, end, status = rfc_window(rng, ref_dt, created)
        rfc(host, region, created, start, end, status, "CA" if rng.random() < 0.7 else "NCA", subnet)
    # sites under active maintenance right now (WIMPLEMENTER + CA, window covering ref date)
    for site in rng.sample(ctx.sites4g, 12):
        created = ref_dt - dt.timedelta(days=rng.uniform(3, 10))
        start = ref_dt - dt.timedelta(hours=rng.uniform(1, 30))
        end = ref_dt + dt.timedelta(hours=rng.uniform(4, 48))
        rfc(site["id"], site["region"].upper(), created, start, end, "WIMPLEMENTER", "CA")
        ctx.active_pm_sites.add(site["id"])
    bulk_insert(ctx.con, "Webe_Plan_Maintenance", PM_COLUMNS, rows)


def build_congested_cells(ctx):
    con = ctx.con
    con.execute("""INSERT INTO Webe_Congested_Cell
        SELECT row_number() OVER (), w.monday + INTERVAL 1 DAY + INTERVAL 9 HOUR, c.Site_Cell_ID,
               c.Cell_ID::VARCHAR, c.Site_ID, replace(c.Freq_Band, '-LTE', ''),
               c.Site_Name || '_' || split_part(c.Site_Cell_ID, '_', 2), c.Site_Name, upper(c.Region),
               upper(c.State), upper(c.Vendor),
               replace(c.Freq_Band, '-LTE', '') || '_' || c.Bandwidth::VARCHAR,
               e.DL_PRB_Utilization, e.Avg_DL_Throughput,
               CASE WHEN e.Avg_DL_Throughput < 1 THEN '<1Mbps' WHEN e.Avg_DL_Throughput <= 2 THEN '1<Mbps≤2' ELSE '>2Mbps' END,
               e.Avg_UL_Throughput, e.Active_User, e.Active_User * 1.6,
               'CONGESTION',
               CASE WHEN random() < 0.5 THEN 'Add TDD2600 carrier' WHEN random() < 0.5 THEN 'Load balancing tuning' ELSE 'Monitor' END,
               CASE WHEN random() < 0.5 THEN 'Ahmad Faizal' ELSE 'Lim Wei Jie' END,
               CASE WHEN random() < 0.5 THEN 'Planning' WHEN random() < 0.6 THEN 'Monitor' ELSE 'Resolved' END,
               60 + random() * 35, 40 + random() * 40, 20 + random() * 40,
               e.Less_Than_1KM, e.More_Than_1KM, e.TA_Group, e.Distance, e.Week_No, e.Year, '4G'
        FROM (SELECT * FROM HUAWEI_EMS UNION ALL SELECT * FROM ZTE_EMS) e
        JOIN _cellq c ON c.Cell_Name = e.cell_name
        JOIN _weeks w ON w.week = e.Week_No AND w.year = e.Year AND w.idx <= 4
        WHERE e.Congestion_Status = 'Congestion'""")
    base = con.execute("SELECT COALESCE(MAX(id), 0) FROM Webe_Congested_Cell").fetchone()[0]
    for network, sql in (
        ("5G", """SELECT c.Site_Cell_ID, CAST(c.Cell_ID AS INT)::VARCHAR AS cid, c.Site_ID, 'N78' AS rollout, s.Site_Name,
                         s.Region, s.State, 'ERICSSON' AS vendor, 'NR3500_100' AS tech
                  FROM Cell5G c JOIN Site5G s ON s.Site_ID = c.Site_ID"""),
        ("4G_MOCN", """SELECT c.Cell_Name AS Site_Cell_ID, c.Cell_ID AS cid, c.Site_ID, 'FDD1800' AS rollout,
                              s.eNobeB_Name AS Site_Name, s.Region, s.State, upper(s.Vendor) AS vendor,
                              'FDD1800_20' AS tech
                       FROM CellMOCN c JOIN SiteMOCN s ON s.Site_ID = c.Site_ID"""),
    ):
        con.execute(f"""INSERT INTO Webe_Congested_Cell
            SELECT {base} + row_number() OVER (), w.monday + INTERVAL 1 DAY + INTERVAL 9 HOUR, x.Site_Cell_ID, x.cid,
                   x.Site_ID, x.rollout, x.Site_Name || '_' || x.cid, x.Site_Name, upper(x.Region), upper(x.State),
                   x.vendor, x.tech, 85 + random() * 13, 0.8 + random() * 1.5, '<1Mbps', 0.3 + random(),
                   20 + random() * 30, 40 + random() * 40, 'CONGESTION', 'Capacity review', 'NOC Support',
                   'Monitor', 70 + random() * 25, 50 + random() * 30, 30 + random() * 30, 50, 50, '<1KM',
                   '0_078KM_To_0_234KM', w.week, w.year, '{network}'
            FROM ({sql}) x, _weeks w
            WHERE w.idx <= 4 AND hash(x.Site_Cell_ID) % 100 < 6 AND random() < 0.8""")
        base = con.execute("SELECT COALESCE(MAX(id), 0) FROM Webe_Congested_Cell").fetchone()[0]


def update_site_status(ctx):
    con = ctx.con
    con.execute("""UPDATE Site4G SET Status = 'Congested' WHERE Site_ID IN (
        SELECT DISTINCT Site_ID FROM (SELECT * FROM HUAWEI_EMS UNION ALL SELECT * FROM ZTE_EMS) e
        JOIN _weeks w ON w.week = e.Week_No AND w.year = e.Year AND w.idx = 1
        WHERE e.Congestion_Status = 'Congestion')""")
    if ctx.active_pm_sites:
        ids = ",".join(f"'{s}'" for s in ctx.active_pm_sites)
        con.execute(f"UPDATE Site4G SET Status = 'Plan Maintenance' WHERE Site_ID IN ({ids})")
    con.execute("""UPDATE Site4G SET Status = 'Out of Service' WHERE Site_ID IN (
        SELECT split_part(network_element_ne_id, ',', 1) FROM ntt_granite
        WHERE id IN (SELECT max(id) FROM ntt_granite GROUP BY ntt_no)
          AND status = 'Open' AND fault_category = 'Total Outage' AND resp_unit = 'LTE 4G')""")
    con.execute("""UPDATE Site5G SET Status = 'Out of Service' WHERE Site_ID IN (
        SELECT hpd_ci FROM ntt_5g_ntt5g WHERE id IN (SELECT max(id) FROM ntt_5g_ntt5g GROUP BY tm_incident_id)
          AND incident_status IN ('Assigned', 'Pending', 'In Progress') AND incident_priority = 'Critical')""")


def build_dashboards(ctx):
    rng, ref = ctx.rng, ctx.ref
    n4g = len(ctx.sites4g)
    n_mocn = len(ctx.sites_mocn)
    n5g = len(ctx.sites5g)
    ctx.con.execute(f"""INSERT INTO Coverage_Boxes VALUES (1, 81.4, 88.9, 97.6, 82.3, 96.2, 98.1,
                       {n4g + n_mocn}, {n4g}, {n5g})""")

    # CTT tickets (THD) from 2025-01-01 to ref date
    start = dt.datetime(ref.year - 1, 1, 1)
    span = (ctx.ref_dt - start).total_seconds()
    rows, monthly = [], {}
    regions = list(R.REGION_WEIGHTS.items())
    by_region = {}
    for s in ctx.sites4g:
        by_region.setdefault(s["region"], []).append(s)
    for i in range(1, 4201):
        created = start + dt.timedelta(seconds=rng.uniform(0, span))
        region = weighted(rng, regions)
        site = rng.choice(by_region[region])
        lat, lng = geo.offset(site["lat"], site["lng"], rng.uniform(0, 360), rng.uniform(0.05, 1.5))
        case_type = weighted(rng, R.CTT_CASE_TYPES)
        y, w = iso(created.date())
        rows.append((i, created, w, created.month, str(created.year), region, site["cluster"]["name"], site["id"],
                     site["state"][:15], f"CAS-{created:%y%m}{i:06d}", case_type,
                     "VIP" if rng.random() < 0.05 else "Mass",
                     "Closed" if created.date() < ref - dt.timedelta(days=10) or rng.random() < 0.4 else "Open",
                     rng.choice(R.CTT_ROOT_CAUSES), rng.choice(["Network Root Cause", "Other Root Cause"]),
                     rng.choice(["4G", "4G", "4G", "5G"]), round(lat, 6), round(lng, 6)))
    rows += ctx.hotspot_thd
    for r in rows:
        key = (r[1].year, r[1].month)
        monthly[key] = monthly.get(key, 0) + 1
    rows.sort(key=lambda r: r[1])
    rows = [(i, *r[1:]) for i, r in enumerate(rows, start=1)]
    bulk_insert(ctx.con, "THD", ["ThdID", "CreatedOn", "Week", "Month", "Year", "Region", "Cluster", "SiteID",
                                 "StateSite", "CaseNumber", "CaseType", "CaseCategory", "CaseStatus", "RootCause1",
                                 "RootCauseSummarize", "Technology", "ComplaintLocationLatitude",
                                 "ComplaintLocationLongitude"], rows)

    # Subscribers: one row per complete month
    subs_rows = []
    total_subs = 890000
    prev_subs, prev_ctt = None, None
    y, m = ref.year - 1, 1
    sid = 0
    while (y, m) < (ref.year, ref.month):
        total_subs = int(total_subs * rng.uniform(1.002, 1.012))
        ctt = monthly.get((y, m), 0) * 9  # tickets in THD are a sample of all CTT
        cov = int(ctt * rng.uniform(0.2, 0.3))
        sid += 1
        abbr = dt.date(y, m, 1).strftime("%b").upper()
        subs_pct = round((total_subs - prev_subs) / prev_subs * 100, 2) if prev_subs else 0.0
        ctt_pct = round((ctt - prev_ctt) / prev_ctt * 100, 2) if prev_ctt else 0.0
        subs_rows.append((sid, dt.datetime(y, m, 28), f"{abbr}-{str(y)[2:]}", "Month", total_subs, ctt, cov,
                          subs_pct, ctt_pct, iso(dt.date(y, m, 28))[1], m, abbr, y, dt.datetime(y, m, 1)))
        prev_subs, prev_ctt = total_subs, ctt
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    bulk_insert(ctx.con, "Subscribers", ["SubscribersID", "SubscribersCD", "month", "Period", "Total Subscribers",
                                         "Total CTT", "Total Coverage Congestion CTT", "Subscriber", "Ctt",
                                         "week_number", "month_number", "month_abbreviation", "year",
                                         "subscribers_date"], subs_rows)


# ---------------------------------------------------------------------------
# RAN KPI, network KPI, BinKPI, Ookla
# ---------------------------------------------------------------------------
def build_ran_kpi(ctx, days: int = 60):
    con, ref = ctx.con, ctx.ref
    d0 = ref - dt.timedelta(days=days)
    d1 = ref - dt.timedelta(days=1)
    dates = f"(SELECT unnest(generate_series(DATE '{d0}', DATE '{d1}', INTERVAL 1 DAY))::DATE AS dt)"
    for vendor, table in (("Huawei", "KPI_Huawei"), ("ZTE", "KPI_ZTE")):
        con.execute(f"""INSERT INTO {table}
        SELECT dt, TIME '00:00:00', Cell_Name, Site_Cell_ID, round(95 + random() * 5, 2),
            CASE WHEN outage THEN 40 + random() * 50 ELSE least(100, 99.95 - g * 0.9 - random() * (0.15 + g * 0.8)) END,
            least(100, 99.6 - g * 1.6 - random() * (0.6 + g * 1.5)),
            least(100, 99.7 - g * 1.4 - random() * (0.5 + g * 1.2)),
            least(100, 99.8 - g * 1.2 - random() * (0.4 + g)),
            least(100, 99.6 - g * 1.5 - random() * (0.5 + g * 1.3)),
            0.12 + g * 0.6 + random() * (0.25 + g * 0.6),
            0.2 + g * 0.7 + random() * (0.3 + g * 0.7),
            least(100, 99.2 - g * 2.5 - random() * (0.8 + g * 2)),
            least(100, 98.5 - g * 3 - random() * (1 + g * 2)),
            least(100, 97 - g * 3 - random() * (1.5 + g * 2)),
            least(100, 99 - g * 1.5 - random() * (0.7 + g)),
            least(100, 98 - g * 2.5 - random() * (1 + g * 2)),
            greatest(0.5, (16 - g * 5) * wk * (0.7 + random() * 0.6)),
            greatest(0.2, (4 - g) * (0.7 + random() * 0.6)),
            (25 + q % 40) * wk * (0.7 + random() * 0.6),
            (3 + q % 6) * wk * (0.7 + random() * 0.6),
            (30 + g * 60 + random() * 80)::BIGINT,
            (60 + g * 90 + random() * 120)::BIGINT,
            least(99, 30 + g * 22 + random() * 25),
            least(99, 15 + g * 12 + random() * 15),
            least(100, 99.5 - g * 1.8 - random() * (0.4 + g * 1.2)),
            0.08 + g * 0.5 + random() * (0.15 + g * 0.5),
            least(100, 99.8 - g * 0.8 - random() * (0.2 + g * 0.6))
        FROM (
            SELECT c.Cell_Name, c.Site_Cell_ID, d.dt, (hash(c.Site_Cell_ID) % 100)::INT AS q,
                   CASE WHEN hash(c.Site_Cell_ID) % 100 < 5 THEN 2 WHEN hash(c.Site_Cell_ID) % 100 < 15 THEN 1 ELSE 0 END AS g,
                   CASE WHEN dayofweek(d.dt) IN (0, 6) THEN 0.8 ELSE 1.0 END AS wk,
                   o.site_id IS NOT NULL AS outage
            FROM Cell4G c JOIN Site4G s ON s.Site_ID = c.Site_ID CROSS JOIN {dates} d
            LEFT JOIN _outage_days o ON o.site_id = c.Site_ID AND o.dt = d.dt
            WHERE s.Vendor = '{vendor}'
        )""")
    con.execute(f"""INSERT INTO KPI_DNB_5G
        SELECT dt, Cell_Name, Site_Cell_ID, Site_ID, 'Ericsson', round(95 + random() * 5, 2),
            least(100, 99.95 - g * 0.9 - random() * (0.15 + g * 0.8)),
            least(100, 99.8 - g * 1.0 - random() * (0.2 + g)),
            0.1 + g * 0.6 + random() * (0.2 + g * 0.6),
            least(100, 98.8 - g * 3 - random() * (1 + g * 2)),
            least(100, 98 - g * 3 - random() * (1 + g * 2)),
            greatest(20, (320 - g * 120) * wk * (0.7 + random() * 0.6)),
            greatest(5, (40 - g * 12) * (0.7 + random() * 0.6)),
            (60 + q % 80) * wk * (0.7 + random() * 0.6),
            (8 + q % 10) * wk * (0.7 + random() * 0.6),
            least(99, 25 + g * 25 + random() * 25),
            (40 + g * 60 + random() * 100)::BIGINT,
            9 + g * 6 + random() * 6
        FROM (
            SELECT c.Cell_Name, c.Site_Cell_ID, c.Site_ID, d.dt, (hash(c.Site_Cell_ID) % 100)::INT AS q,
                   CASE WHEN hash(c.Site_Cell_ID) % 100 < 5 THEN 2 WHEN hash(c.Site_Cell_ID) % 100 < 15 THEN 1 ELSE 0 END AS g,
                   CASE WHEN dayofweek(d.dt) IN (0, 6) THEN 0.8 ELSE 1.0 END AS wk
            FROM Cell5G c CROSS JOIN {dates} d
        )""")


def build_site_kpis(ctx, days: int = 30):
    """network_kpi (per site/day), BinKPI and Ookla samples."""
    con, ref, rng = ctx.con, ctx.ref, ctx.rng
    d0 = ref - dt.timedelta(days=days)
    d1 = ref - dt.timedelta(days=1)
    dates = f"(SELECT unnest(generate_series(DATE '{d0}', DATE '{d1}', INTERVAL 1 DAY))::DATE AS dt)"
    bad = "CASE WHEN hash(site_id) % 100 < 8 THEN 1 ELSE 0 END"
    con.execute(f"""INSERT INTO network_kpi (site_id, kpi_date, provider, latitude, longitude,
            cell_availability, call_setup_success_rate, volte_setup_success_rate, volte_drop_rate,
            dl_throughput, prb, active_user)
        SELECT site_id, dt, 'TM4G', lat, lng,
            CASE WHEN outage THEN 70 + random() * 25 ELSE least(100, 99.9 - b * 1.2 - random() * 0.4) END,
            least(100, 99.3 - b * 3 - random()), least(100, 99.2 - b * 3 - random()),
            0.3 + b * 1.2 + random() * 0.6, greatest(1, 14 - b * 9 + random() * 10), 10 + random() * 60 + b * 25,
            5 + random() * 40
        FROM (SELECT s.Site_ID AS site_id, s.Latitude AS lat, s.Longitude AS lng, d.dt,
                     {bad.replace('site_id', 's.Site_ID')} AS b, o.site_id IS NOT NULL AS outage
              FROM Site4G s CROSS JOIN {dates} d
              LEFT JOIN _outage_days o ON o.site_id = s.Site_ID AND o.dt = d.dt)""")
    con.execute(f"""INSERT INTO network_kpi (site_id, kpi_date, provider, latitude, longitude,
            cell_availability_lte, cell_availability_5g, volte_redirection_rate_lte, data_session_rate_5g,
            erab_drop_rate_lte, data_session_abnormal_5g, intra_freq_ho_rate_lte, inter_freq_ho_rate_lte,
            inter_freq_offload_ho_rate_lte, intra_sgnb_pscell_change_rate_5g, inter_sgnb_pscell_change_rate_5g, latency)
        SELECT site_id, dt, 'DNB 5G', lat, lng,
            least(100, 99.9 - b - random() * 0.3), least(100, 99.9 - b - random() * 0.3),
            least(100, 97.5 - b * 4 - random() * 2), least(100, 99.8 - b - random() * 0.4),
            0.2 + b + random() * 0.5, 0.2 + b + random() * 0.5,
            least(100, 98 - b * 4 - random() * 2), least(100, 97.5 - b * 4 - random() * 2),
            least(100, 97 - b * 4 - random() * 2), least(100, 98 - b * 4 - random() * 2),
            least(100, 97.5 - b * 4 - random() * 2), 8 + b * 10 + random() * 6
        FROM (SELECT s.Site_ID AS site_id, s.Latitude AS lat, s.Longitude AS lng, d.dt,
                     {bad.replace('site_id', 's.Site_ID')} AS b FROM Site5G s CROSS JOIN {dates} d)""")
    con.execute(f"""INSERT INTO network_kpi (site_id, kpi_date, provider, latitude, longitude,
            data_setup, voice_setup, voice_call_csfb, data_drop, voice_drop, intra_handover, inter_handover)
        SELECT site_id, dt, 'Maxis 4GMOCN', lat, lng,
            least(100, 99.3 - b * 3 - random()), least(100, 99.2 - b * 3 - random()),
            least(100, 97.5 - b * 4 - random() * 2), 0.3 + b * 1.2 + random() * 0.5,
            0.3 + b * 1.2 + random() * 0.5, least(100, 98 - b * 4 - random() * 2),
            least(100, 97.5 - b * 4 - random() * 2)
        FROM (SELECT s.Site_ID AS site_id, s.Latitude AS lat, s.Longitude AS lng, d.dt,
                     {bad.replace('site_id', 's.Site_ID')} AS b FROM SiteMOCN s CROSS JOIN {dates} d)""")

    # BinKPI: per 4G site sector per day, tied to the nearest BIN where one exists
    grid_rows = []
    synthetic_gid = 90_000_000
    for s in ctx.sites4g:
        near = sorted(
            (b for b in ctx.bins.values() if abs(b["lat"] - s["lat"]) < 0.01 and abs(b["lng"] - s["lng"]) < 0.01),
            key=lambda b: geo.haversine_km(s["lat"], s["lng"], b["lat"], b["lng"]),
        )[:3]
        sector_cells = [c for c in s["cells"] if c["suffix"][1] == "1"] or s["cells"]
        for k, cell in enumerate(sector_cells[:3]):
            if k < len(near):
                gid, base = near[k]["grid_id"], near[k]["rsrp"]
            else:
                synthetic_gid += 1
                gid, base = synthetic_gid, rng.uniform(-112, -82)
            grid_rows.append((s["id"], gid, str(cell["sector"]), s["morph"], s["vendor"], cell["name"], s["enb"],
                              cell["cell_id"], base))
    con.execute("""CREATE TEMP TABLE _site_grid (site_id VARCHAR, grid_id INT, sector VARCHAR, morph VARCHAR,
                   vendor VARCHAR, cell_name VARCHAR, enb INT, cell_id INT, base DOUBLE)""")
    bulk_insert(con, "_site_grid", ["site_id", "grid_id", "sector", "morph", "vendor", "cell_name", "enb", "cell_id",
                                    "base"], grid_rows)
    con.execute(f"""INSERT INTO BinKPI
        SELECT row_number() OVER (), dt + INTERVAL 2 HOUR, strftime(dt, '%Y%m%d')::INT, grid_id, site_id, sector,
               morph, vendor, cell_name, enb, cell_id, (20 + random() * 200)::INT, 0.1 + random() * 1.5, 1,
               r, least(-3, -4 - (-r - 70) / 5 + (random() - 0.5) * 2), sinr, greatest(2, least(15, 4 + sinr / 2.5)),
               (5 + random() * 80)::BIGINT, (5 + random() * 60)::INT, 1,
               CASE WHEN outage THEN 'Down' ELSE 'Up' END,
               CASE WHEN random() < 0.08 THEN 'Yes' ELSE 'No' END
        FROM (SELECT g.*, d.dt, g.base + (random() - 0.5) * 6 AS r,
                     (g.base + 112) / 2.2 + (random() - 0.5) * 4 AS sinr, o.site_id IS NOT NULL AS outage
              FROM _site_grid g CROSS JOIN {dates} d
              LEFT JOIN _outage_days o ON o.site_id = g.site_id AND o.dt = d.dt)""")

    # Ookla speed tests near 4G and 5G sites
    con.execute(f"""INSERT INTO ookla_mnpd_daily
        SELECT row_number() OVER (), strftime(dt, '%Y%m%d')::INT, 'Unifi', raw, lat + (random() - 0.5) * 0.01,
               lng + (random() - 0.5) * 0.01, random() * 1.5, lat_ms, lat_ms + random() * 10, dl, dl * (0.15 + random() * 0.2),
               rsrp, least(-3, -4 - (-rsrp - 70) / 5), (rsrp + 112) / 2.2, (random() * 255)::INT, enb,
               (random() * 503)::INT, earfcn, band_type, bands, ctype, ctype, (5 + random() * 10)::INT::VARCHAR
        FROM (
            SELECT s.Latitude AS lat, s.Longitude AS lng, s.eNodeB_ID::INT AS enb, d.dt,
                   CASE WHEN random() < 0.5 THEN 'unifi' ELSE 'webe' END AS raw,
                   greatest(0.3, (CASE WHEN hash(s.Site_ID) % 100 < 10 THEN 4 ELSE 25 END) * (0.3 + random() * 1.4)) AS dl,
                   15 + random() * 30 AS lat_ms, -75 - random() * 35 AS rsrp, 3450 AS earfcn, 'FDD' AS band_type,
                   'B5;B40' AS bands, 'LTE' AS ctype
            FROM Site4G s CROSS JOIN {dates} d CROSS JOIN range(3) r WHERE random() < 0.35
            UNION ALL
            SELECT s.Latitude, s.Longitude, s.eNodeB_ID::INT, d.dt, 'Unifi 5G',
                   greatest(5, (CASE WHEN hash(s.Site_ID) % 100 < 10 THEN 60 ELSE 380 END) * (0.3 + random() * 1.3)),
                   8 + random() * 15, -70 - random() * 30, 636666, 'TDD', 'n78', '5G-NSA'
            FROM Site5G s CROSS JOIN {dates} d CROSS JOIN range(3) r WHERE random() < 0.35
        )""")
