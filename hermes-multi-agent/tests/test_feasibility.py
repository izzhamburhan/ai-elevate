"""Deterministic Order 4 feasibility verdicts. Fixtures are explicitly synthetic, not runtime evidence."""
import copy

from elevate_hermes.feasibility import classify, contradictions, from_tasks


def discovery():
    def opportunity(rank, sites, lat, lng):
        return {"rank": rank, "opportunity_id": f"OPP-FIXTURE-{rank}", "where": {"lat": lat, "lng": lng, "supporting_site_ids": sites}}
    sites = {"A1": (1.50, 103.70), "A2": (1.51, 103.71), "B1": (2.20, 102.25), "C1": (5.41, 100.33)}
    features = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [lng, lat]}, "properties": {"kind": "supporting_site", "site_id": sid}}
                for sid, (lat, lng) in sites.items()]
    return {"synthetic": True, "data": {"opportunities": [opportunity(1, ["A1", "A2"], 1.50, 103.70), opportunity(2, ["B1"], 2.20, 102.25),
                                                          opportunity(3, ["C1"], 5.41, 100.33)],
                                        "geojson": {"type": "FeatureCollection", "features": features}}}


def kpi(rows):
    return {"ok": True, "tool": "get_ran_kpi", "arguments": {"site_id": ",".join(rows)},
            "data": {"series": [{"site_id": sid, "cell_availability": a, "dl_prb_utilization": p} for sid, (a, p) in rows.items()]}}


def ntt(arguments, items=()):
    return {"ok": True, "tool": "get_ntt_tickets", "arguments": arguments, "data": {"items": list(items)}}


RADIUS = [ntt({"current_lat": 1.50, "current_long": 103.70, "radius": 3}), ntt({"current_lat": 2.20, "current_long": 102.25, "radius": 3}),
          ntt({"current_lat": 5.41, "current_long": 100.33, "radius": 3})]


def test_numeric_thresholds_give_fixed_verdicts():
    calls = [kpi({"A1": (99.8, 50.0), "A2": (99.6, 60.0), "B1": (99.2, 50.0), "C1": (62.5, 49.0)}), *RADIUS]
    verdicts = {v["rank"]: v for v in classify(discovery(), calls)}
    assert (verdicts[1]["label"], verdicts[2]["label"], verdicts[3]["label"]) == ("supported", "supported with risk", "blocked until repaired")
    assert "B1: availability 99.20% < 99.5%" in verdicts[2]["reasons"] and "C1: availability 62.50% < 95.0%" in verdicts[3]["reasons"]
    assert classify(discovery(), calls) == classify(copy.deepcopy(discovery()), copy.deepcopy(calls))


def test_boundaries_congestion_and_tickets():
    calls = [kpi({"A1": (99.5, 80.0), "A2": (99.5, 79.9), "B1": (95.0, 10.0), "C1": (99.9, 10.0)}), *RADIUS[:2],
             ntt({"current_lat": 5.41, "current_long": 100.33, "radius": 3}, [{"site_id": "C1", "ntt_num": "NTT-FX-1", "ntt_status": "Open"},
                                                                              {"site_id": "B1", "ntt_num": "NTT-FX-2", "ntt_status": "Network Resolved"}])]
    verdicts = {v["rank"]: v for v in classify(discovery(), calls)}
    assert verdicts[1]["label"] == "supported with risk" and "A1: PRB 80.0% >= 80.0%" in verdicts[1]["reasons"]  # 99.5% itself passes
    assert verdicts[2]["label"] == "supported with risk" and "B1: resolved NTT NTT-FX-2" in verdicts[2]["reasons"]  # 95.0% is not blocking
    assert verdicts[3]["label"] == "blocked until repaired" and "C1: open NTT NTT-FX-1" in verdicts[3]["reasons"]


def test_comma_list_ntt_query_or_missing_kpi_is_not_validated():
    comma = ntt({"site_id": "A1,A2,B1,C1"})
    verdicts = classify(discovery(), [kpi({"A1": (99.9, 10.0), "A2": (99.9, 10.0), "B1": (99.9, 10.0), "C1": (99.9, 10.0)}), comma])
    assert {v["label"] for v in verdicts} == {"not validated"}
    exact = [ntt({"site_id": "A1"}), ntt({"site_id": "A2"}), *RADIUS[1:]]
    verdicts = {v["rank"]: v for v in classify(discovery(), [kpi({"A1": (99.9, 10.0), "B1": (99.9, 10.0), "C1": (99.9, 10.0)}), *exact])}
    assert verdicts[1]["label"] == "not validated" and "A2: no KPI data" in verdicts[1]["reasons"]
    assert verdicts[2]["label"] == "supported"


def test_failed_calls_never_count_and_tasks_are_linked_to_their_discovery():
    failed_kpi = {**kpi({"A1": (99.9, 10.0), "A2": (99.9, 10.0), "B1": (99.9, 10.0), "C1": (99.9, 10.0)}), "ok": False}
    tasks = [{"task_id": "h", "agent_id": "hypothesis", "tool_calls": [{"ok": True, "tool": "opportunity_discover", "data": discovery()}]},
             {"task_id": "e", "agent_id": "engineer", "tool_calls": [failed_kpi, *RADIUS]}]
    assert {v["label"] for v in from_tasks(tasks, "h")} == {"not validated"}
    assert from_tasks([{"task_id": "h", "agent_id": "hypothesis", "tool_calls": []}], "h") is None


def test_report_contradicting_the_computed_verdict_is_detected():
    verdicts = [{"rank": 1, "verdict": "blocked", "label": "blocked until repaired"}, {"rank": 2, "verdict": "at_risk", "label": "supported with risk"}]
    report = ("### #1 Fibre — Johor\n- **Network feasibility**: **supported with risk**. NK4130 62.5%.\n"
              "### #2 Event — Melaka\n- **Network feasibility**: supported with risk (SM3043 99.2%).\n")
    assert contradictions(report, verdicts) == ["#1 report says 'supported with risk', computed 'blocked until repaired'"]
    assert contradictions(report.replace("**supported with risk**. NK4130", "blocked until repaired. NK4130"), verdicts) == []
