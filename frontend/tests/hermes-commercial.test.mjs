import assert from "node:assert/strict";
import test from "node:test";
import { COMMERCIAL_APPS, explainCommercialPrompt, offerable, parseCommercial } from "../src/lib/commercial/contracts.ts";

// Fabricated contract fixtures, never actual engine output.
const common = (application) => ({
  application, title: "fixture", summary: "fixture", headline: "fixture headline",
  geojson: { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [102.2, 2.2] }, properties: { kind: "x" } }] },
  labels: { data: "synthetic", figures: "calculated from stated assumptions", money: "indicative, not TM revenue or cost" },
  limitations: ["synthetic"], caveats: ["not lost revenue"],
});
function event(statuses = ["feasible", "conditional", "infeasible"]) {
  return { synthetic: true, data: { ...common("connectivity_as_a_product"), proposal: "DRAFT (synthetic, indicative, not a quote).", economics_note: "event-specific",
    event: { event_id: "EVT-FIXTURE", name: "Fixture match", start_myt: "25 Oct 2026, 18:00", attendance: 1000, lat: 2.2, lng: 102.2 },
    readiness: { nearby_sites: 3, headroom_mbps: 100, attendee_peak_demand_mbps: 120, demand_covered_pct: 83, min_availability_pct: 99.1, fibre_backhauled_sites: 2 },
    packages: statuses.map((status, i) => ({ package_id: `p${i}`, name: `Package ${i}`, description: "fixture", status, cost_rm: 100, indicative_price_rm: 135,
      cost_items_rm: [{ item: "fixture", rm: 100 }], checks: [{ condition: "fixture", met: status !== "infeasible" }], effect: "fixture" })) } };
}

test("commercial results must be labelled synthetic and well formed", () => {
  assert.ok(parseCommercial("event", event()));
  assert.throws(() => parseCommercial("event", { ...event(), synthetic: false }));
  const relabelled = event(); relabelled.data.labels.data = "real";
  assert.throws(() => parseCommercial("event", relabelled));
  assert.throws(() => parseCommercial("event", event(["guaranteed"])));
  assert.throws(() => parseCommercial("leaks", event()));
});

test("infeasible packages are never offerable", () => {
  const parsed = parseCommercial("event", event());
  assert.deepEqual(parsed.data.packages.map((p) => offerable(p)), [true, true, false]);
});

test("the AI is asked to explain exactly one computed tool result", () => {
  assert.deepEqual(COMMERCIAL_APPS.map((a) => a.tool), ["opportunity_revenue_leaks", "opportunity_absence_gaps", "opportunity_event_packages"]);
  assert.equal(explainCommercialPrompt("event"), "Commercial application: explain opportunity_event_packages for a business audience. Call opportunity_event_packages once with no arguments and use only its computed figures.");
});
