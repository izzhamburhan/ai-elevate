import assert from "node:assert/strict";
import test from "node:test";
import {
  AREA_MARKER, areaAdherence, areaContains, areaFromPrompt, areaFromShape, areaFromTower, callScope, digest,
  evidenceNear, evidenceRows, promptWithoutArea, sitesInArea, withAreaContext,
} from "../src/lib/hermes/workspace.ts";

// Fabricated fixtures shaped like the Hermes ledger; never actual telemetry or agent output.
const square = [[101.50, 3.06], [101.53, 3.06], [101.53, 3.09], [101.50, 3.09], [101.50, 3.06]];
const sites = [
  { site_id: "IN1", lat: 3.07, lng: 101.51 }, { site_id: "IN2", lat: 3.08, lng: 101.52 }, { site_id: "OUT1", lat: 3.20, lng: 101.60 },
];

function job(calls, extra = {}) {
  return {
    investigation_id: "fixture", agent_id: "engineer", status: "completed", prompt: "Fixture", updated_at: "2026-10-12T00:00:00Z",
    summary: "Two sites are healthy. CB1 shows high PRB. We recommend a capacity check on CB1 before the weekend.",
    tasks: [{ task_id: "t1", agent_id: "engineer", status: "completed", tool_calls: calls }], geojson: null, ...extra,
  };
}

test("drawn shapes and towers become areas that contain the right sites", () => {
  const area = areaFromShape("Rectangle", square, "Fixture rectangle");
  assert.equal(area.kind, "rectangle");
  assert.deepEqual(sitesInArea(area, sites).map((s) => s.site_id), ["IN1", "IN2"]);
  const circle = areaFromShape("Circle", square, "Fixture circle");
  assert.equal(circle.kind, "circle");
  assert.equal(circle.ring, undefined);
  const tower = areaFromTower("BANG-0001", 3.07, 101.51, 2);
  assert.ok(areaContains(tower, 3.075, 101.515) && !areaContains(tower, 3.2, 101.6));
  assert.equal(areaFromShape("Polygon", [[1, 1], [2, 2]], "too small"), null);
});

test("the area travels in the prompt, stays under the limit, and can be read back", () => {
  const area = areaFromTower("BANG-0001", 3.07, 101.51, 2);
  const prompt = withAreaContext("Check the sites.", area, ["IN1", "IN2"]);
  assert.ok(prompt.includes(AREA_MARKER) && prompt.length <= 4000);
  const back = areaFromPrompt(prompt);
  assert.deepEqual(back.siteIds, ["IN1", "IN2"]);
  assert.equal(back.kind, "tower");
  assert.equal(promptWithoutArea(prompt), "Check the sites.");
  assert.ok(withAreaContext("x".repeat(5000), area, []).length <= 4000);
  assert.equal(withAreaContext(" Plain ", null, []), "Plain");
  assert.equal(areaFromPrompt("No area here"), null);
});

test("tool calls are judged by the sites or the radius they actually queried", () => {
  const area = areaFromTower("T", 3.07, 101.51, 2);
  const ids = new Set(["IN1", "IN2"]);
  assert.equal(callScope({ tool: "get_ran_kpi", arguments: { site_id: "IN1,IN2" } }, area, ids), "in_area");
  assert.equal(callScope({ tool: "get_ran_kpi", arguments: { site_id: "IN1,OUT1" } }, area, ids), "outside");
  assert.equal(callScope({ tool: "get_ntt_tickets", arguments: { current_lat: 3.071, current_long: 101.511, radius: 1 } }, area, ids), "in_area");
  assert.equal(callScope({ tool: "get_ntt_tickets", arguments: { current_lat: 3.071, current_long: 101.511, radius: 25 } }, area, ids), "outside");
  assert.equal(callScope({ tool: "get_worst_cells", arguments: { region: "Central" } }, area, ids), "unscoped");
});

test("the area verdict never claims more than the recorded calls show", () => {
  const area = areaFromTower("T", 3.07, 101.51, 2);
  const ok = (args) => ({ tool: "get_ran_kpi", ok: true, arguments: args });
  assert.equal(areaAdherence(job([ok({ site_id: "IN1" })]), area, ["IN1"]).verdict, "respected");
  assert.equal(areaAdherence(job([ok({ site_id: "IN1" }), ok({ region: "Central" })]), area, ["IN1"]).verdict, "partly respected");
  assert.equal(areaAdherence(job([ok({ region: "Central" })]), area, ["IN1"]).verdict, "not area-scoped");
  // failed calls and delegation do not count as analysis
  assert.equal(areaAdherence(job([{ tool: "get_ran_kpi", ok: false, arguments: { site_id: "IN1" } }, { tool: "delegate_specialist", ok: true }]), area, ["IN1"]).verdict, "no tool calls");
});

test("evidence rows come only from successful calls and carry locations when known", () => {
  const calls = [
    { tool: "get_ran_kpi", ok: true, arguments: { site_id: "IN1" }, executed_at: "2026-10-12T01:00:00Z",
      source: { service: "netops", reference: "mcp:fixture:t1:1", synthetic: true },
      data: { items: [{ site_id: "IN1", date: "2026-10-11", availability_pct: 99.1, prb_dl_pct: 85.234, lat: 3.07, lng: 101.51 }, { site_id: "IN2", date: "2026-10-11", availability_pct: 100 }] } },
    { tool: "get_ntt_tickets", ok: false, arguments: {}, data: { items: [{ site_id: "X" }] } },
  ];
  const rows = evidenceRows(job(calls), new Map([["IN2", { lat: 3.08, lng: 101.52 }]]));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].metrics, [{ name: "availability_pct", value: 99.1 }, { name: "prb_dl_pct", value: 85.23 }]);
  assert.equal(rows[0].at, "2026-10-11");
  assert.equal(rows[0].service, "netops");
  assert.deepEqual([rows[1].lat, rows[1].lng], [3.08, 101.52]);
  assert.deepEqual(evidenceNear(rows, { lat: 3.0801, lng: 101.5201 }, 0.5).map((r) => r.siteId), ["IN2"]);
  assert.deepEqual(evidenceNear(rows, { lat: 0, lng: 0, name: "in1" }).map((r) => r.siteId), ["IN1"]);
});

test("the summary digest uses recorded verdicts and severities, not prose, for risk", () => {
  const d = digest(job([{ tool: "get_ran_kpi", ok: true }, { tool: "get_ntt_tickets", ok: false }]), []);
  assert.equal(d.okCalls, 1);
  assert.equal(d.failedCalls, 1);
  assert.equal(d.risk, "unknown");
  assert.match(d.recommendation, /recommend a capacity check/);
  const severe = { geojson: { features: [{ geometry: { coordinates: [101.5, 3.0] }, properties: { severity: "HIGH" } }] } };
  assert.equal(digest(job([], severe), []).risk, "high");
  const verdicts = { feasibility: [{ label: "supported with risk" }] };
  assert.equal(digest(job([], verdicts), []).risk, "medium");
});

test("the headline drops markdown, headings and ID lines from the agent report", () => {
  const report = "## Network Health\n\n**Investigation ID:** abc\n**Task ID:** def\n### Findings\n- **CB7552** availability fell to 62.5%. It needs a site visit.\n- Others are healthy.";
  const d = digest(job([], { summary: report }), []);
  assert.equal(d.headline, "CB7552 availability fell to 62.5%. It needs a site visit.");
  assert.equal(d.recommendation, null);
});

test("NetOps KPI series and empty ticket searches become readable evidence", () => {
  const calls = [
    { tool: "get_ran_kpi", ok: true, source: { service: "netops", reference: "r1", synthetic: true },
      data: { level: "site", kpis: [{ kpi: "dl_prb_utilization", threshold: 80 }], series: [{ period: "2026-09-25", site_id: "CB5348", cells: 9, dl_prb_utilization: 44.947, dl_user_throughput: 14.221, cell_availability: 99.69 }] } },
    { tool: "get_ntt_tickets", ok: true, source: { service: "netops", reference: "r2", synthetic: true },
      data: { open_count: 0, closed_count: 0, total: 0, page: 1, page_size: 20, total_pages: 0, items: [] } },
  ];
  const [kpi, tickets] = evidenceRows(job(calls));
  assert.equal(kpi.siteId, "CB5348");
  assert.equal(kpi.at, "2026-09-25");
  assert.deepEqual(kpi.metrics.map((m) => m.name), ["dl_prb_utilization", "dl_user_throughput", "cell_availability"]);
  assert.equal(tickets.label, "No matching records");
  assert.deepEqual(tickets.metrics.map((m) => m.name), ["open_count", "closed_count", "total"]);
});

test("risk comes from recorded KPI values against NetOps thresholds", () => {
  const kpiCall = (availability) => ({ tool: "get_ran_kpi", ok: true, data: {
    kpis: [{ kpi: "dl_prb_utilization", threshold: 80, direction: "lower" }, { kpi: "cell_availability", threshold: 99.5, direction: "higher" }],
    series: [{ site_id: "A", dl_prb_utilization: 45, cell_availability: 99.9 }, { site_id: "B", dl_prb_utilization: 50, cell_availability: availability }] } });
  assert.equal(digest(job([kpiCall(99.8)]), []).risk, "low");
  assert.match(digest(job([kpiCall(99.8)]), []).riskBasis, /0 of 4/);
  assert.equal(digest(job([kpiCall(99.4)]), []).risk, "medium");
  assert.equal(digest(job([kpiCall(62.5)]), []).risk, "high");
});
