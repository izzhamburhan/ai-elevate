"""A small fake netops.duckdb with just the tables and shapes the generators read (for tests of netintel and mlpredict)."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path

import duckdb

END = date(2026, 10, 11)
STADIUM = (3.0839, 101.5465)


def _site(sid, cluster, lat, lng, backhaul="Fiber", morphology="Sub Urban", exchange="Shah Alam Exchange"):
    return (sid, f"{sid}_SITE", cluster, "Central", "Selangor", lat, lng, backhaul, exchange, "TNB", morphology, 100000 + int(sid[2:]))


def build_fake_netops(path: Path) -> None:
    sites = [
        # Shah Alam: six suburban sites 0.6-2 km around the stadium
        *[_site(f"SA{100 + i}", "Shah Alam", STADIUM[0] + dy, STADIUM[1] + dx)
          for i, (dy, dx) in enumerate([(0.006, 0.0), (-0.008, 0.004), (0.0, 0.012), (0.012, -0.01), (-0.015, -0.006), (0.004, -0.018)])],
        # Putrajaya: one fibre hub and four microwave sites around it
        _site("PJ200", "Putrajaya", 2.9264, 101.6964, exchange="Putrajaya Exchange", morphology="Urban"),
        *[_site(f"PJ{201 + i}", "Putrajaya", 2.9264 + dy, 101.6964 + dx, backhaul="Microwave", exchange="Putrajaya Exchange", morphology="Urban")
          for i, (dy, dx) in enumerate([(0.01, 0.0), (0.0, 0.012), (-0.011, 0.002), (0.02, 0.02)])],
        # Kepong: urban fibre sites (outage, maintenance, VSWR candidates)
        *[_site(f"KP{300 + i}", "Kepong", 3.21 + 0.01 * i, 101.64, exchange="Kepong Exchange", morphology="Urban") for i in range(5)],
    ]
    cells = []
    for s in sites:
        for k, az in enumerate((0, 120, 240)):
            cells.append((f"{s[0]}_{s[2]}_0{k + 1}1", s[0], k + 1, float(az), "FDD-LTE850"))
    days = [END - timedelta(days=d) for d in range(40)]
    kpi = [(d, c[0], 45.0, 120, 18.0) for d in days for c in cells]
    con = duckdb.connect(str(path))
    try:
        con.execute('CREATE TABLE "Site4G" ("Site_ID" VARCHAR, "Site_Name" VARCHAR, "Cluster_Name" VARCHAR, "Region" VARCHAR, "State" VARCHAR, '
                    '"Latitude" DOUBLE, "Longitude" DOUBLE, "Backhaul" VARCHAR, "TM_Exchange" VARCHAR, "Power" VARCHAR, "RFP_Morphology" VARCHAR, '
                    '"eNodeB_ID" BIGINT)')
        con.executemany('INSERT INTO "Site4G" VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', sites)
        con.execute('CREATE TABLE "Cell4G" ("Cell_Name" VARCHAR, "Site_ID" VARCHAR, "Sector_ID" DOUBLE, "Azimuth" DOUBLE, "Freq_Band" VARCHAR)')
        con.executemany('INSERT INTO "Cell4G" VALUES (?, ?, ?, ?, ?)', cells)
        con.execute('CREATE TABLE ran_kpi_4g ("Date" DATE, "Cell" VARCHAR, "Webe_DL_Resource_Block_Utilization" DOUBLE, '
                    '"Webe_Maximum_Cell_RRC_Connected_User_Number" BIGINT, "Webe_Average_DL_User_Throughput_MB" DOUBLE)')
        con.executemany("INSERT INTO ran_kpi_4g VALUES (?, ?, ?, ?, ?)", kpi)
        con.execute("CREATE TABLE ntt_granite (id BIGINT, ntt_no VARCHAR, network_element_ne_id VARCHAR, created_date TIMESTAMP, ettr TIMESTAMP, "
                    "fault_category VARCHAR, problem_desc VARCHAR)")
        con.executemany("INSERT INTO ntt_granite VALUES (?, ?, ?, ?, ?, ?, ?)", [
            (1, "NTT-1", "KP300", datetime(2026, 10, 5, 10), datetime(2026, 10, 5, 14), "Total Outage", "All LTE cells down at site."),
            (2, "NTT-2", "KP300", datetime(2026, 10, 8, 2), datetime(2026, 10, 8, 4), "Partial Outage", "One sector down."),
        ])
        con.execute('CREATE TABLE "Webe_Plan_Maintenance" ("RFC ID" VARCHAR, "Planned Start" TIMESTAMP, "Planned End" TIMESTAMP, '
                    '"Sub Network" VARCHAR, "Hostname" VARCHAR, "Title" VARCHAR)')
        con.execute('INSERT INTO "Webe_Plan_Maintenance" VALUES (?, ?, ?, ?, ?, ?)',
                    ["RFC-1", datetime(2026, 10, 3, 1), datetime(2026, 10, 3, 3), "RAN-Power cabinet", "KP301", "Rectifier swap - KP301"])
        con.execute('CREATE TABLE "THD" ("CaseNumber" VARCHAR, "CreatedOn" TIMESTAMP, "SiteID" VARCHAR, "CaseType" VARCHAR, "RootCause1" VARCHAR, '
                    '"Technology" VARCHAR, "ComplaintLocationLatitude" DOUBLE, "ComplaintLocationLongitude" DOUBLE)')
        con.execute('INSERT INTO "THD" VALUES (?, ?, ?, ?, ?, ?, ?, ?)', ["THD-1", datetime(2026, 10, 1, 9), "KP302", "Coverage", "Coverage", "4G", 3.23, 101.64])
        con.execute('CREATE TABLE "Bin_Information" ("Grid_ID" BIGINT, latitude DOUBLE, longitude DOUBLE)')
        con.execute('CREATE TABLE "BinKPI" ("Grid_ID" BIGINT, "DateID" BIGINT, avg_rsrp DOUBLE, avg_rsrq DOUBLE, sinr DOUBLE, cqi DOUBLE, '
                    '"SampleNO" BIGINT, "CellName" VARCHAR)')
        grids = [(1, STADIUM[0] + 0.009, STADIUM[1] + 0.002), (2, 3.23, 101.64)]
        con.executemany('INSERT INTO "Bin_Information" VALUES (?, ?, ?)', grids)
        con.executemany('INSERT INTO "BinKPI" VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                        [(1, 20261001, -88.0, -8.0, 12.0, 9.0, 50, cells[0][0]), (2, 20261001, -112.0, -14.0, 2.0, 5.0, 40, cells[-1][0])])
    finally:
        con.close()