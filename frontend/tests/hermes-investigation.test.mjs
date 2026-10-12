import assert from "node:assert/strict";
import test from "node:test";
import {
  elapsedSeconds, formatElapsed, investigationEvidence, investigationSites, investigationStages, sitesBounds,
} from "../src/lib/hermes/investigation.ts";

// Fabricated contract fixtures, never actual telemetry or Hermes execution evidence.
const feature = (lng, lat, properties) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties });
function job(overrides = {}) {
  return {
    investigation_id: "fixture", agent_id: "orchestrator", status: "running", prompt: "Fixture",
    created_at: "2026-10-13T00:00:00Z", updated_at: "2026-10-13T00:01:00Z", summary: null, geojson: null, error: null,
    tasks: [], warnings: [], ...overrides,
  };
}

test("before submission every step waits; nothing is marked done", () => {
  const stages = investigationStages(null);
  assert.deepEqual(stages.map((s) => s.state), ["waiting", "waiting", "waiting", "waiting", "waiting"]);
  assert.equal(investigationStages(null, { submitting: true })[0].state, "active");
});

test("a running job lights only the question and the agents", () => {
  const stages = investigationStages(job({ tasks: [{ task_id: "e", agent_id: "engineer", status: "running", sources: [], warnings: [] }] }));
  assert.deepEqual(stages.map((s) => s.state), ["done", "active", "waiting", "waiting", "waiting"]);
});

test("a finished job without sites, sources or summary says so instead of implying them", () => {
  const stages = investigationStages(job({ status: "completed" }));
  assert.deepEqual(stages.map((s) => s.state), ["done", "done", "empty", "empty", "empty"]);
  const failed = investigationStages(job({ status: "failed", error: "boom" }));
  assert.equal(failed.find((s) => s.id === "recommendation").state, "failed");
  assert.equal(failed.find((s) => s.id === "agents").state, "failed");
});

test("a partial job with sites, evidence and a summary completes every step and says partial", () => {
  const stages = investigationStages(job({
    status: "partial", summary: "Send a team to site A.",
    geojson: { type: "FeatureCollection", features: [feature(102.2, 6.1, { site_id: "A" })] },
  }), { evidence: 3 });
  assert.deepEqual(stages.map((s) => s.state), ["done", "done", "done", "done", "done"]);
  assert.equal(stages[3].detail, "3 records");
  assert.equal(stages[4].detail, "Partial");
});

test("sites come from GeoJSON properties; tone only from an explicit status", () => {
  const sites = investigationSites(job({
    geojson: { type: "FeatureCollection", features: [
      feature(102.24, 6.13, { site_id: "KB-1", site_name: "Kota Bharu Central", state: "Kelantan", status: "DOWN", synthetic: true }),
      feature(102.29, 6.17, { site_id: "KB-2", severity: "medium" }),
      feature(102.2, 6.1, { note: "a long prose finding that says the site is down" }),
      // statuses seen in a real NetOps get_sites result
      feature(101.6, 3.1, { site_id: "BL0297", status: "Congested" }),
      feature(101.7, 3.2, { site_id: "BL1651", status: "Operational" }),
    ] },
  }));
  assert.equal(sites[0].name, "Kota Bharu Central");
  assert.equal(sites[0].siteId, "KB-1");
  assert.equal(sites[0].tone, "red");
  assert.equal(sites[0].toneLabel, "Outage");
  assert.equal(sites[0].synthetic, true);
  assert.equal(sites[1].tone, "amber");
  assert.equal(sites[2].tone, "neutral");
  assert.equal(sites[2].name, "Site 3");
  assert.deepEqual([sites[3].tone, sites[3].toneLabel, sites[4].tone, sites[4].toneLabel], ["amber", "Congested", "green", "Operational"]);
  assert.deepEqual(sitesBounds(sites.slice(0, 3)), [102.2, 6.1, 102.29, 6.17]);
  assert.equal(sitesBounds([]), null);
});

test("evidence is de-duplicated across tasks and job, and keeps the synthetic label", () => {
  const evidence = investigationEvidence(job({
    tasks: [
      { task_id: "e", agent_id: "engineer", status: "completed", warnings: [], sources: [{ label: "KPI", tool: "get_ran_kpi", synthetic: true }, { label: "KPI", tool: "get_ran_kpi", synthetic: true }] },
    ],
    sources: [{ tool: "get_sites" }, "not a source"],
  }));
  assert.equal(evidence.length, 2);
  assert.equal(evidence[0].agent, "engineer");
  assert.equal(evidence[0].synthetic, true);
  assert.equal(evidence[1].label, "get_sites");
});

test("elapsed time never goes negative and reads as minutes and seconds", () => {
  assert.equal(elapsedSeconds("2026-10-13T00:00:00Z", "2026-10-13T00:02:05Z"), 125);
  assert.equal(elapsedSeconds("2026-10-13T00:00:10Z", "2026-10-13T00:00:00Z"), 0);
  assert.equal(formatElapsed(125), "2m 05s");
  assert.equal(formatElapsed(9), "9s");
});
