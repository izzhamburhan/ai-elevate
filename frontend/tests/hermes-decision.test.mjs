import assert from "node:assert/strict";
import test from "node:test";
import { compareToBaseline, explainPrompt, riskFromVerdict, simulateArgs, simulationSchema } from "../src/lib/decision/contracts.ts";

// Fabricated contract fixture, never actual simulator output.
function simulation(budget = 20000, means = [100, -50, 40], losses = [0.1, 0.8, 0.2]) {
  const ids = ["campaign", "network_first", "phased_pilot"];
  return {
    synthetic: true,
    data: {
      summary: "fixture",
      opportunity: { opportunity_id: "OPP-FIXTURE", title: "Fixture", kind: "sme_fibre", where: { lat: 1.5, lng: 103.7, area: "Fixture" } },
      inputs: { opportunity_id: "OPP-FIXTURE", budget_rm: budget, demand_multiplier: 1, capacity_headroom_pct: 30, network_risk: "medium",
                network_risk_source: "graph default", horizon_months: 24, draws: 4000 },
      strategies: ids.map((id, i) => ({ strategy_id: id, name: id, summary: "fixture", expected_spend_rm: budget, budget_not_deployed_rm: 0,
        customers_acquired: { p10: 1, p50: 2, p90: 3 }, net_contribution_24m_rm: { mean: means[i], p10: means[i] - 10, p50: means[i], p90: means[i] + 10 },
        probability_of_loss_24m: losses[i], payback_month_p50: 12, probability_payback_within_24m: 0.9, network_remediation_rm: 0,
        monthly_cumulative_p50_rm: [-budget, 0] })),
      recommendation: { strategy_id: "campaign", name: "campaign", rule: "fixture", computed: true },
      assumptions: {}, labels: { inputs: "assumption-based", outputs: "simulated", data: "synthetic" }, limitations: ["synthetic"],
      geojson: { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [103.7, 1.5] }, properties: { kind: "opportunity" } }] },
    },
  };
}

test("simulations must be synthetic, labelled and carry a computed recommendation", () => {
  assert.ok(simulationSchema.safeParse(simulation()).success);
  assert.equal(simulationSchema.safeParse({ ...simulation(), synthetic: false }).success, false);
  const unlabelled = simulation(); unlabelled.data.labels.outputs = "forecast";
  assert.equal(simulationSchema.safeParse(unlabelled).success, false);
  const agentPick = simulation(); agentPick.data.recommendation.computed = false;
  assert.equal(simulationSchema.safeParse(agentPick).success, false);
});

test("the AI is asked about exactly the simulated inputs and graph defaults stay omitted", () => {
  const inputs = { opportunity_id: "OPP-SME-FIBRE-JOHORB", budget_rm: 50000, demand_multiplier: 1, capacity_headroom_pct: undefined, network_risk: undefined };
  assert.deepEqual(simulateArgs(inputs), { opportunity_id: "OPP-SME-FIBRE-JOHORB", budget_rm: 50000, demand_multiplier: 1 });
  assert.equal(explainPrompt(inputs), "Decision Time Machine: explain the trade-offs and recommend a strategy for opportunity_id=OPP-SME-FIBRE-JOHORB, budget_rm=50000, demand_multiplier=1. Call opportunity_simulate once with exactly these inputs.");
  assert.deepEqual([riskFromVerdict("blocked until repaired"), riskFromVerdict("supported with risk"), riskFromVerdict("supported"), riskFromVerdict("not validated")], ["high", "medium", "low", undefined]);
});

test("baseline comparison reports signed changes per strategy", () => {
  const before = simulationSchema.parse(simulation(20000, [100, -50, 40], [0.1, 0.8, 0.2]));
  const after = simulationSchema.parse(simulation(50000, [250, 10, 90], [0.05, 0.4, 0.2]));
  assert.deepEqual(compareToBaseline(after, before).map((d) => [d.strategy_id, d.mean_change_rm, Math.round(d.loss_probability_change * 100)]),
    [["campaign", 150, -5], ["network_first", 60, -40], ["phased_pilot", 50, 0]]);
});
