import assert from "node:assert/strict";
import test from "node:test";
import {
  hermesAgentsSchema, hermesBackendUrl, hermesGeojsonSchema, hermesJobSchema,
  hermesMapRows, hermesRequestSchema, isHermesJobActive, parseHermesQuery,
} from "../src/lib/hermes/contracts.ts";

// Fabricated contract fixtures, never actual telemetry, weather, or Hermes execution evidence.
const point = {
  type: "Feature", geometry: { type: "Point", coordinates: [101.5183, 3.0733] },
  properties: { site_id: "fixture-site", source: "fabricated test fixture", synthetic_network_data: true, mode: "replay" },
};
function job() {
  return {
    investigation_id: "fixture-investigation", agent_id: "orchestrator", status: "partial",
    prompt: "Fixture investigation", created_at: "2026-10-12T00:00:00Z", updated_at: "2026-10-12T00:01:00Z",
    tasks: [
      { task_id: "forecast-task", agent_id: "forecast", status: "completed", summary: "Fabricated fixture", sources: [{ kind: "fixture", label: "Fabricated fixture", tool: "predict_rainfall", synthetic: true }], warnings: ["Test fixture"] },
      { task_id: "engineer-task", agent_id: "engineer", status: "failed", sources: [], warnings: ["Unavailable fixture service"] },
    ],
    geojson: { type: "FeatureCollection", features: [structuredClone(point)] }, warnings: ["Partial fixture result"],
  };
}

test("only configured identities and bounded prompts may be submitted", () => {
  assert.deepEqual(hermesRequestSchema.parse({ agent_id: "orchestrator", prompt: " Investigate " }), { agent_id: "orchestrator", prompt: "Investigate" });
  for (const value of [
    { agent_id: "admin", prompt: "Investigation" },
    { agent_id: "forecast", prompt: " " },
    { agent_id: "forecast", prompt: "x".repeat(4_001) },
    { agent_id: "engineer", prompt: "Investigate", tools: ["shell"] },
    { agent_id: "engineer", prompt: "Investigate", profile_path: "/private" },
    { agent_id: "engineer", prompt: "Investigate", session_id: "../../other-profile" },
  ]) assert.equal(hermesRequestSchema.safeParse(value).success, false);
});

test("investigation query identifiers cannot escape the fixed service path", () => {
  assert.deepEqual(parseHermesQuery(new URLSearchParams("action=investigation&id=job_123")), { action: "investigation", id: "job_123" });
  for (const value of ["action=delete", "action=investigation", "action=investigation&id=../../private", "action=investigation&id=https://external.test"]) {
    assert.equal(parseHermesQuery(new URLSearchParams(value)), null);
  }
  const query = parseHermesQuery(new URLSearchParams("action=investigation&id=job_123&url=https://external.test"));
  assert.equal(hermesBackendUrl("http://127.0.0.1:8011/ignored?token=private", query.action, query.id).href, "http://127.0.0.1:8011/api/investigations/job_123");
  assert.throws(() => hermesBackendUrl("file:///private", "agents"));
  assert.throws(() => hermesBackendUrl("http://user:credential@localhost", "agents"));
  assert.throws(() => hermesBackendUrl("http://localhost:8011", "investigation", "../secret"));
});

test("availability requires explicit real service booleans", () => {
  const value = { ready: false, agents: [{ agent_id: "forecast", name: "Forecast", available: false, capabilities: ["Weather analysis"], warnings: ["Model unavailable"] }], warnings: [] };
  assert.equal(hermesAgentsSchema.parse(value).agents[0].available, false);
  delete value.agents[0].available;
  assert.equal(hermesAgentsSchema.safeParse(value).success, false);
});

test("partial failures and actual task identities remain explicit", () => {
  const parsed = hermesJobSchema.parse(job());
  assert.equal(parsed.status, "partial");
  assert.equal(parsed.tasks[1].status, "failed");
  assert.equal(isHermesJobActive(parsed), false);
  assert.equal(isHermesJobActive({ status: "running" }), true);
  assert.equal(isHermesJobActive({ status: "queued" }), true);
  assert.equal(isHermesJobActive({ status: "failed" }), false);
  const failedTask = job();
  failedTask.tasks[1].error = "Native process failed in fabricated fixture";
  failedTask.tasks[1].active_tool = null;
  failedTask.tasks[1].tool_calls = [{ tool: "get_ran_kpi", ok: false }];
  const failure = hermesJobSchema.parse(failedTask).tasks[1];
  assert.equal(failure.error, "Native process failed in fabricated fixture");
  assert.equal(failure.tool_calls[0].ok, false);
  const invalid = job(); invalid.tasks[0].agent_id = "simulated-specialist";
  assert.equal(hermesJobSchema.safeParse(invalid).success, false);
  invalid.tasks[0].agent_id = "forecast"; invalid.updated_at = "invalid";
  assert.equal(hermesJobSchema.safeParse(invalid).success, false);
});

test("GeoJSON rejects invalid WGS84 coordinates and unsupported geometry", () => {
  for (const geometry of [
    { type: "Point", coordinates: [181, 3] }, { type: "Point", coordinates: [101, -91] },
    { type: "Point", coordinates: [NaN, 3] }, { type: "Point", coordinates: [101, Infinity] },
    { type: "Polygon", coordinates: [] },
  ]) assert.equal(hermesGeojsonSchema.safeParse({ type: "FeatureCollection", features: [{ ...point, geometry }] }).success, false);
});

test("map rows preserve provenance and use only validated explicit geography", () => {
  const value = job();
  value.geojson.features[0].properties.longitude = 999;
  value.geojson.features[0].properties.investigation_id = "untrusted-property";
  value.geojson.features[0].properties.evidence = { type: "fabricated fixture" };
  const parsed = hermesJobSchema.parse(value);
  const rows = hermesMapRows(parsed.geojson, parsed.investigation_id);
  assert.equal(rows[0].longitude, 101.5183);
  assert.equal(rows[0].latitude, 3.0733);
  assert.equal(rows[0].investigation_id, "fixture-investigation");
  assert.equal(rows[0].synthetic_network_data, true);
  assert.equal(rows[0].mode, "replay");
  assert.equal(rows[0].source, "fabricated test fixture");
  assert.deepEqual(JSON.parse(rows[0].evidence), { type: "fabricated fixture" });
  assert.deepEqual(hermesMapRows({ type: "FeatureCollection", features: [] }, "empty"), []);
});
