import { z } from "zod";

// Self-contained (no path aliases) so node --test can import it directly.
export const COMMERCIAL_APPS = [
  { id: "leaks", tool: "opportunity_revenue_leaks", label: "Revenue Leak Hunter", color: "#ef4444" },
  { id: "absence", tool: "opportunity_absence_gaps", label: "Opportunity of Absence", color: "#f59e0b" },
  { id: "event", tool: "opportunity_event_packages", label: "Connectivity as a Product", color: "#06b6d4" },
] as const;
export type CommercialAppId = (typeof COMMERCIAL_APPS)[number]["id"];

const range = z.object({ low: z.number(), mid: z.number(), high: z.number() });
const geojson = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(z.object({
    type: z.literal("Feature"),
    geometry: z.object({ type: z.literal("Point"), coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]) }),
    properties: z.record(z.string(), z.unknown()),
  })).max(500),
});
const base = {
  application: z.string(), title: z.string(), summary: z.string(), headline: z.string(), geojson,
  labels: z.object({ data: z.literal("synthetic"), figures: z.string(), money: z.string() }),
  limitations: z.array(z.string()), caveats: z.array(z.string()),
};

export const leakSchema = z.object({ synthetic: z.literal(true), data: z.object({
  ...base, application: z.literal("revenue_leak_hunter"), method: z.array(z.string()), window_days: z.number(),
  results: z.array(z.object({
    rank: z.number(), area: z.string(), cluster: z.string(), state: z.string().nullable(), lat: z.number(), lng: z.number(),
    affected_sites: z.array(z.object({ site_id: z.string(), outages_60d: z.number(), repeat_equipment_alarms_60d: z.number(), avoidable_visits: z.number() }).passthrough()),
    evidence: z.object({ outages_60d: z.number(), repeat_equipment_alarms_60d: z.number(), avoidable_field_visits: z.number(),
      network_complaints_60d_unique: z.number(), complaint_causes: z.record(z.string(), z.number()), underused_sites_prb_p95_below_35pct: z.array(z.string()) }).passthrough(),
    avoidable_opex_rm: range, preventive_fix_cost_rm: range, revenue_exposure_rm: range,
    annualised_avoidable_opex_mid_rm: z.number(), fix_payback_days_mid: z.number().nullable(),
    mitigation: z.array(z.string()), recommendation: z.string(), next_action: z.string(),
  }).passthrough()),
}).passthrough() }).passthrough();

export const absenceSchema = z.object({ synthetic: z.literal(true), data: z.object({
  ...base, application: z.literal("opportunity_of_absence"), classification_rules: z.record(z.string(), z.string()),
  predictive_service: z.object({ available: z.boolean(), note: z.string() }).passthrough(),
  results: z.array(z.object({
    rank: z.number(), area: z.string(), cluster: z.string(), state: z.string().nullable(), lat: z.number(), lng: z.number(),
    classification: z.enum(["verified_gap", "capacity_constraint", "insufficient_information"]), classification_label: z.string(),
    all_classes: z.array(z.string()), why_it_matters: z.array(z.string()), technical_constraint: z.string(),
    evidence: z.record(z.string(), z.unknown()), recommended_action: z.string(),
    indicative_opportunity_rm_month: z.object({ low: z.number(), high: z.number(), addressable_smes: z.number(), basis: z.string(), condition: z.string() }),
  }).passthrough()),
}).passthrough() }).passthrough();

export const eventSchema = z.object({ synthetic: z.literal(true), data: z.object({
  ...base, application: z.literal("connectivity_as_a_product"), proposal: z.string(), economics_note: z.string(),
  event: z.object({ event_id: z.string(), name: z.string(), start_myt: z.string(), attendance: z.number(), lat: z.number(), lng: z.number() }).passthrough(),
  readiness: z.object({ nearby_sites: z.number(), headroom_mbps: z.number(), attendee_peak_demand_mbps: z.number(), demand_covered_pct: z.number().nullable(),
    min_availability_pct: z.number().nullable(), fibre_backhauled_sites: z.number() }),
  packages: z.array(z.object({
    package_id: z.string(), name: z.string(), description: z.string(), status: z.enum(["feasible", "conditional", "infeasible"]),
    cost_rm: z.number(), indicative_price_rm: z.number(), cost_items_rm: z.array(z.object({ item: z.string(), rm: z.number() })),
    checks: z.array(z.object({ condition: z.string(), met: z.boolean() })), effect: z.string(),
  }).passthrough()).min(1),
}).passthrough() }).passthrough();

export type LeakResult = z.infer<typeof leakSchema>;
export type AbsenceResult = z.infer<typeof absenceSchema>;
export type EventResult = z.infer<typeof eventSchema>;
export type CommercialResult = LeakResult | AbsenceResult | EventResult;

export function parseCommercial(app: CommercialAppId, payload: unknown): CommercialResult {
  return app === "leaks" ? leakSchema.parse(payload) : app === "absence" ? absenceSchema.parse(payload) : eventSchema.parse(payload);
}

/** A package may be offered only when every one of its own conditions holds (vendor connectivity: when bundled). */
export function offerable(pkg: EventResult["data"]["packages"][number]) {
  return pkg.status === "feasible" || pkg.status === "conditional";
}

/** "Explain with AI" request: the agent runs exactly this tool with no extra arguments and explains its computed result. */
export function explainCommercialPrompt(app: CommercialAppId): string {
  const tool = COMMERCIAL_APPS.find((a) => a.id === app)!.tool;
  return `Commercial application: explain ${tool} for a business audience. Call ${tool} once with no arguments and use only its computed figures.`;
}

export function formatRm(value: number) {
  return `RM ${Math.round(value).toLocaleString("en-MY")}`;
}
