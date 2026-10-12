import assert from "node:assert/strict";
import test from "node:test";
import { discoveryBounds, discoveryFromJob, discoveryRows, discoverySchema, validationState } from "../src/lib/opportunities/contracts.ts";

// Fabricated contract fixture, never actual opportunity-graph output.
function discovery() {
  const opportunity = (rank, lng, lat) => ({
    rank, opportunity_id: `OPP-FIXTURE-${rank}`, kind: "sme_fibre", title: `Fixture ${rank}`,
    where: { area: "Fixture town centre", cluster: "Fixture", state: null, lat, lng, supporting_site_ids: ["FX0001"] },
    why: ["fixture signal"], what_tm_should_do: "fixture action", hypothesis: "fixture hypothesis",
    scores: { overall: 0.8, demand: 0.9, feasibility: 0.7 },
    commercial_potential: { indicative_monthly_recurring_rm: [1000, 2000], label: "Not verified revenue", assumption_basis: "fixture" },
    confidence: 0.7, confidence_label: "Medium", risks: ["fixture risk"], validation_checks: ["fixture check"], synthetic: true,
  });
  const feature = (kind, lng, lat) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: { kind, synthetic: true, meta: { a: 1 } } });
  return {
    synthetic: true, as_of: "2026-10-11T16:00:00Z",
    data: {
      summary: "fixture", limitations: ["synthetic"],
      opportunities: [opportunity(1, 103.7, 1.5), opportunity(2, 100.3, 5.4)],
      geojson: { type: "FeatureCollection", features: [feature("opportunity", 103.7, 1.5), feature("supporting_site", 103.71, 1.51)] },
    },
  };
}

test("discovery envelopes must be synthetic and carry valid ranked opportunities", () => {
  assert.ok(discoverySchema.safeParse(discovery()).success);
  assert.equal(discoverySchema.safeParse({ ...discovery(), synthetic: false }).success, false);
  const bad = discovery();
  bad.data.opportunities[0].synthetic = false;
  assert.equal(discoverySchema.safeParse(bad).success, false);
  const outside = discovery();
  outside.data.geojson.features[0].geometry.coordinates = [190, 1];
  assert.equal(discoverySchema.safeParse(outside).success, false);
});

test("map rows come only from tool geometry and bounds cover every ranked area", () => {
  const parsed = discoverySchema.parse(discovery());
  const rows = discoveryRows(parsed);
  assert.deepEqual(rows.map((r) => [r.longitude, r.latitude, r.kind]), [[103.7, 1.5, "opportunity"], [103.71, 1.51, "supporting_site"]]);
  assert.equal(rows[0].meta, JSON.stringify({ a: 1 }));
  const [minLng, minLat, maxLng, maxLat] = discoveryBounds(parsed);
  assert.ok(minLng < 100.3 && maxLng > 103.7 && minLat < 1.5 && maxLat > 5.4);
});

function job(overrides = {}) {
  const verdicts = [1, 2].map((rank) => ({ opportunity_id: `OPP-FIXTURE-${rank}`, rank, label: "supported with risk", reasons: ["fixture"] }));
  return {
    investigation_id: "fixture-run", agent_id: "hypothesis", status: "completed", updated_at: "2026-10-12T15:00:00Z", feasibility: verdicts,
    tasks: [{ task_id: "h", agent_id: "hypothesis", tool_calls: [{ tool: "opportunity_discover", ok: true, data: discovery() }] }],
    ...overrides,
  };
}

test("findings are never labelled validated before a real completed run with computed verdicts", () => {
  const parsed = discoverySchema.parse(discovery());
  assert.equal(validationState(null, null, parsed).state, "not_started");
  assert.equal(validationState(null, "fixture-run", parsed).state, "running");
  assert.equal(validationState(job({ status: "running" }), "fixture-run", parsed).state, "running");
  assert.equal(validationState(job(), "another-run", parsed).state, "running");
  assert.equal(validationState(job({ feasibility: undefined }), "fixture-run", parsed).state, "failed");
  assert.equal(validationState(job({ status: "failed" }), "fixture-run", parsed).state, "failed");
  assert.equal(validationState(job({ feasibility: [{ opportunity_id: "OPP-OTHER", rank: 1, label: "supported", reasons: [] }] }), "fixture-run", parsed).state, "failed");
  const done = validationState(job(), "fixture-run", parsed);
  assert.equal(done.state, "validated");
  assert.equal(done.completedAt, "2026-10-12T15:00:00Z");
  assert.equal(validationState(job({ feasibility: [{ ...job().feasibility[0], label: "probably fine" }] }), "fixture-run", parsed).state, "failed");
});

test("a completed run reopens with the discovery its agent actually retrieved", () => {
  assert.equal(discoveryFromJob(job()).data.opportunities[0].opportunity_id, "OPP-FIXTURE-1");
  const failedCall = job({ tasks: [{ task_id: "h", agent_id: "hypothesis", tool_calls: [{ tool: "opportunity_discover", ok: false, data: discovery() }] }] });
  assert.equal(discoveryFromJob(failedCall), null);
});
