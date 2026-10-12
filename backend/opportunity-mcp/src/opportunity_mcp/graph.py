"""Build the Telco Opportunity Graph from existing synthetic datasets.

Nodes: area, site, transport hub, upcoming event and the area's SME demand segment.
Edges: area -serves-> site (NetOps cluster), site -backhauled_via-> hub, area -hosts-> event, area -has_demand-> sme.
Network, demand and weather signals are attributes aggregated from intel.duckdb (Order 4 network intelligence
build) and ml.duckdb (Order 5 predictive ML data). Both are opened read-only; nothing is reseeded.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import duckdb
import networkx as nx

from opportunity_mcp.paths import INTEL_DB, ML_DB, SME_CSV

KPI_DAYS = 7
INCIDENT_DAYS = 30
EVENT_HORIZON_DAYS = 30
# Malaysia-time evening busy hours 18:00-22:59 are 10:00-14:59 UTC
BUSY_UTC_HOURS = (10, 14)


@dataclass(frozen=True)
class OpportunityGraph:
    graph: nx.Graph
    data_end_utc: datetime
    provenance: dict[str, Any]
    # the databases this graph was built from, so derived queries read the same data
    intel_db: Path = INTEL_DB
    ml_db: Path = ML_DB

    def nodes(self, kind: str) -> list[str]:
        return sorted(node for node, attrs in self.graph.nodes(data=True) if attrs["kind"] == kind)

    def neighbours(self, node: str, kind: str) -> list[str]:
        return sorted(other for other in self.graph.neighbors(node) if self.graph.nodes[other]["kind"] == kind)

    def summary(self) -> dict[str, Any]:
        kinds: dict[str, int] = {}
        for _, attrs in self.graph.nodes(data=True):
            kinds[attrs["kind"]] = kinds.get(attrs["kind"], 0) + 1
        relations: dict[str, int] = {}
        for _, _, attrs in self.graph.edges(data=True):
            relations[attrs["relation"]] = relations.get(attrs["relation"], 0) + 1
        return {"nodes": self.graph.number_of_nodes(), "edges": self.graph.number_of_edges(), "node_kinds": kinds, "edge_relations": relations}


def _rows(con: duckdb.DuckDBPyConnection, sql: str, *params: Any) -> list[dict[str, Any]]:
    cursor = con.execute(sql, list(params))
    names = [column[0] for column in cursor.description]
    return [dict(zip(names, row, strict=True)) for row in cursor.fetchall()]


def build(intel_db: Path = INTEL_DB, ml_db: Path = ML_DB, sme_csv: Path = SME_CSV) -> OpportunityGraph:
    if not intel_db.exists() or not ml_db.exists():
        raise FileNotFoundError("intel.duckdb/ml.duckdb missing: run `python -m netintel_mcp.seed` and `python -m mlpredict_mcp.data` first")
    intel = duckdb.connect(str(intel_db), read_only=True)
    ml = duckdb.connect(str(ml_db), read_only=True)
    meta = dict(intel.execute("SELECT key, value FROM meta").fetchall())
    end = datetime.fromisoformat(meta["window_end_utc"])
    kpi_from, incident_from, event_to = end - timedelta(days=KPI_DAYS), end - timedelta(days=INCIDENT_DAYS), end + timedelta(days=EVENT_HORIZON_DAYS)
    graph = nx.Graph()

    for area in _rows(intel, "SELECT area_id, name, cluster, lat, lng FROM area"):
        graph.add_node(f"area:{area['area_id']}", kind="area", **area)
    cluster_area = {attrs["cluster"]: node for node, attrs in graph.nodes(data=True)}

    kpis = {row["site_id"]: row for row in _rows(intel, f"""
        WITH hourly AS (
          SELECT site_id, ts_utc, avg(prb_dl_pct) AS prb, sum(active_users) AS users, avg(availability_pct) AS availability,
                 hour(ts_utc) BETWEEN {BUSY_UTC_HOURS[0]} AND {BUSY_UTC_HOURS[1]} AS busy
          FROM kpi_hourly WHERE ts_utc > ? GROUP BY site_id, ts_utc)
        SELECT site_id, quantile_cont(prb, 0.95) FILTER (WHERE busy) AS busy_prb_p95, avg(prb) FILTER (WHERE busy) AS busy_prb_mean,
               max(users) AS peak_users, avg(availability) AS availability_pct, count(*) AS kpi_hours
        FROM hourly GROUP BY site_id""", kpi_from)}
    counts = {}
    for table, column in (("outage", "start_utc"), ("complaint", "created_utc"), ("alarm", "raised_utc")):
        for row in _rows(intel, f"SELECT site_id, count(*) AS n FROM {table} WHERE {column} > ? GROUP BY site_id", incident_from):
            counts.setdefault(row["site_id"], {})[table] = row["n"]
    rsrp = {row["site_id"]: row["rsrp_dbm"] for row in _rows(intel, """
        SELECT c.site_id, avg(g.rsrp_dbm) AS rsrp_dbm FROM grid_quality g JOIN cell c ON c.cell_name = g.top_cell GROUP BY c.site_id""")}

    for site in _rows(intel, "SELECT site_id, name, cluster, state, lat, lng, backhaul, morphology FROM site"):
        kpi = kpis.get(site["site_id"], {})
        node = f"site:{site['site_id']}"
        graph.add_node(node, kind="site", **site,
                       busy_prb_p95=kpi.get("busy_prb_p95"), busy_prb_mean=kpi.get("busy_prb_mean"), peak_users=kpi.get("peak_users"),
                       availability_pct=kpi.get("availability_pct"), kpi_hours=kpi.get("kpi_hours", 0),
                       outages_30d=counts.get(site["site_id"], {}).get("outage", 0),
                       complaints_30d=counts.get(site["site_id"], {}).get("complaint", 0),
                       alarms_30d=counts.get(site["site_id"], {}).get("alarm", 0), rsrp_dbm=rsrp.get(site["site_id"]))
        graph.add_edge(cluster_area[site["cluster"]], node, relation="serves")

    for link in _rows(intel, "SELECT site_id, hub_site_id, kind, distance_km FROM transport_link"):
        hub = f"hub:{link['hub_site_id']}"
        graph.add_node(hub, kind="hub", hub_site_id=link["hub_site_id"])
        graph.add_edge(f"site:{link['site_id']}", hub, relation="backhauled_via", link_kind=link["kind"], distance_km=link["distance_km"])

    for event in _rows(intel, """SELECT event_id, name, kind, lat, lng, start_utc, attendance, area_id FROM event
                                 WHERE start_utc > ? AND start_utc <= ? AND area_id IS NOT NULL""", end, event_to):
        node = f"event:{event['event_id']}"
        event_kind = event.pop("kind")
        graph.add_node(node, kind="event", event_kind=event_kind, **{**event, "start_utc": event["start_utc"].isoformat() + "Z"})
        graph.add_edge(f"area:{event['area_id']}", node, relation="hosts")

    footfall = {row["area_id"]: row["visitors"] for row in _rows(ml, f"""
        SELECT area_id, avg(visitors) AS visitors FROM footfall_hourly
        WHERE ts_utc > ? AND hour(ts_utc) BETWEEN {BUSY_UTC_HOURS[0]} AND {BUSY_UTC_HOURS[1]} GROUP BY area_id""", end - timedelta(days=28))}
    rain = {row["area_id"]: row["n"] for row in _rows(ml, "SELECT area_id, count(*) FILTER (WHERE rain_mm >= 20) AS n FROM rain_daily WHERE day_local > ? GROUP BY area_id",
                                                     (end - timedelta(days=INCIDENT_DAYS)).date())}
    booths = {row["area_id"]: row for row in _rows(ml, """
        SELECT area_id, sum(signups) AS signups, sum(footfall_during) AS footfall, count(*) AS booths FROM booth_outcome GROUP BY area_id""")}
    with sme_csv.open(encoding="utf-8") as handle:
        sme_rows = {row["area_id"]: row for row in csv.DictReader(handle)}
    for node in [n for n, a in graph.nodes(data=True) if a["kind"] == "area"]:
        area_id = graph.nodes[node]["area_id"]
        booth = booths.get(area_id, {})
        graph.nodes[node].update(evening_footfall_mean=footfall.get(area_id), heavy_rain_days_30d=rain.get(area_id, 0),
                                 booth_signups_per_1k=(1000 * booth["signups"] / booth["footfall"]) if booth.get("footfall") else None,
                                 booths_observed=booth.get("booths", 0))
        sme = sme_rows[area_id]
        segment = f"sme:{area_id}"
        graph.add_node(segment, kind="sme", area_id=area_id, sme_count=int(sme["sme_count"]),
                       fibre_serviceable_pct=float(sme["fibre_serviceable_pct"]),
                       tm_business_penetration_pct=float(sme["tm_business_penetration_pct"]),
                       mobile_only_sme_pct=float(sme["mobile_only_sme_pct"]), broadband_enquiries_90d=int(sme["broadband_enquiries_90d"]),
                       dominant_sector=sme["dominant_sector"], generator=sme["generator"])
        graph.add_edge(node, segment, relation="has_demand")

    ml_meta = dict(ml.execute("SELECT key, value FROM meta").fetchall())
    intel.close()
    ml.close()
    provenance = {"intel_generator": meta["generator_version"], "ml_generator": ml_meta["generator_version"], "seed": meta["seed"],
                  "netops_ref_date": meta["netops_ref_date"], "sme_generator": next(iter(sme_rows.values()))["generator"],
                  "kpi_window_days": KPI_DAYS, "incident_window_days": INCIDENT_DAYS, "event_horizon_days": EVENT_HORIZON_DAYS,
                  "synthetic": True}
    return OpportunityGraph(graph=graph, data_end_utc=end, provenance=provenance, intel_db=intel_db, ml_db=ml_db)
