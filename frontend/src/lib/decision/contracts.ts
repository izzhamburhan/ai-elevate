import { z } from "zod";

// Self-contained (no path aliases) so node --test can import it directly.
const range = z.object({ mean: z.number(), p10: z.number(), p50: z.number(), p90: z.number() });
export const NETWORK_RISKS = ["low", "medium", "high"] as const;
export type NetworkRisk = (typeof NETWORK_RISKS)[number];

export const strategySchema = z.object({
  strategy_id: z.enum(["campaign", "network_first", "phased_pilot"]),
  name: z.string(),
  summary: z.string(),
  expected_spend_rm: z.number(),
  budget_not_deployed_rm: z.number(),
  customers_acquired: z.object({ p10: z.number(), p50: z.number(), p90: z.number() }),
  net_contribution_24m_rm: range,
  probability_of_loss_24m: z.number().min(0).max(1),
  payback_month_p50: z.number().int().nullable(),
  probability_payback_within_24m: z.number().min(0).max(1),
  network_remediation_rm: z.number(),
  monthly_cumulative_p50_rm: z.array(z.number()).min(2),
}).passthrough();
export type Strategy = z.infer<typeof strategySchema>;

/** The opportunity_simulate envelope. Inputs are assumption-based, outputs simulated, data synthetic. */
export const simulationSchema = z.object({
  synthetic: z.literal(true),
  data: z.object({
    summary: z.string(),
    opportunity: z.object({ opportunity_id: z.string(), title: z.string(), kind: z.string(),
      where: z.object({ lat: z.number(), lng: z.number(), area: z.string() }).passthrough() }).passthrough(),
    inputs: z.object({
      opportunity_id: z.string(), budget_rm: z.number(), demand_multiplier: z.number(), capacity_headroom_pct: z.number(),
      network_risk: z.enum(NETWORK_RISKS), network_risk_source: z.string(), horizon_months: z.number(), draws: z.number(),
    }),
    strategies: z.array(strategySchema).length(3),
    recommendation: z.object({ strategy_id: z.string(), name: z.string(), rule: z.string(), computed: z.literal(true) }),
    assumptions: z.record(z.string(), z.unknown()),
    labels: z.object({ inputs: z.literal("assumption-based"), outputs: z.literal("simulated"), data: z.literal("synthetic") }),
    limitations: z.array(z.string()),
    geojson: z.object({
      type: z.literal("FeatureCollection"),
      features: z.array(z.object({
        type: z.literal("Feature"),
        geometry: z.object({ type: z.literal("Point"), coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]) }),
        properties: z.record(z.string(), z.unknown()),
      })),
    }),
  }).passthrough(),
}).passthrough();
export type Simulation = z.infer<typeof simulationSchema>;

export type ScenarioInputs = {
  opportunity_id: string; budget_rm: number; demand_multiplier: number;
  capacity_headroom_pct?: number; network_risk?: NetworkRisk;
};

/** Order 4 computed feasibility verdict -> network risk assumption (unvalidated keeps the graph default). */
export function riskFromVerdict(label: string | undefined): NetworkRisk | undefined {
  return label === "blocked until repaired" ? "high" : label === "supported with risk" ? "medium" : label === "supported" ? "low" : undefined;
}

/** Tool arguments: optional assumptions are omitted so the simulator uses its graph defaults. */
export function simulateArgs(inputs: ScenarioInputs): Record<string, unknown> {
  return Object.fromEntries(Object.entries(inputs).filter(([, value]) => value !== undefined));
}

/** The request "Explain with AI" sends to the Business Hypothesis agent: the exact simulated inputs, nothing else. */
export function explainPrompt(inputs: ScenarioInputs): string {
  const args = Object.entries(simulateArgs(inputs)).map(([key, value]) => `${key}=${value}`).join(", ");
  return `Decision Time Machine: explain the trade-offs and recommend a strategy for ${args}. Call opportunity_simulate once with exactly these inputs.`;
}

/** Signed change against a pinned baseline, for "RM20k vs RM50k" comparisons. */
export function compareToBaseline(current: Simulation, baseline: Simulation) {
  return current.data.strategies.map((strategy) => {
    const before = baseline.data.strategies.find((s) => s.strategy_id === strategy.strategy_id)!;
    return {
      strategy_id: strategy.strategy_id,
      mean_change_rm: strategy.net_contribution_24m_rm.mean - before.net_contribution_24m_rm.mean,
      loss_probability_change: strategy.probability_of_loss_24m - before.probability_of_loss_24m,
    };
  });
}
