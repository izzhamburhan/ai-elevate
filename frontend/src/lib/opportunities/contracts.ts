import { z } from "zod";

// Self-contained (no path aliases) so node --test can import it directly.
const pointCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(z.object({
    type: z.literal("Feature"),
    geometry: z.object({ type: z.literal("Point"), coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]) }),
    properties: z.record(z.string(), z.unknown()),
  })).max(500),
});

/** Order 4: the Business Hypothesis agent request sent by "Discover opportunities" (same text as verify_runtime.py). */
export const DISCOVER_PROMPT =
  "Discover the top three TM business opportunities from the Telco Opportunity Graph, form a testable hypothesis for each, " +
  "have the Engineer validate network feasibility for their supporting sites, and report where, why and what TM should do.";

export const opportunitySchema = z.object({
  rank: z.number().int().min(1),
  opportunity_id: z.string(),
  kind: z.string(),
  title: z.string(),
  where: z.object({
    area: z.string(), cluster: z.string(), state: z.string().nullable().optional(),
    lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
    supporting_site_ids: z.array(z.string()),
  }).passthrough(),
  why: z.array(z.string()),
  what_tm_should_do: z.string(),
  hypothesis: z.string(),
  scores: z.object({ overall: z.number(), demand: z.number(), feasibility: z.number() }),
  commercial_potential: z.object({
    indicative_monthly_recurring_rm: z.tuple([z.number(), z.number()]),
    label: z.string(),
    assumption_basis: z.string(),
  }).passthrough(),
  confidence: z.number().min(0).max(1),
  confidence_label: z.string(),
  risks: z.array(z.string()),
  validation_checks: z.array(z.string()),
  synthetic: z.literal(true),
}).passthrough();
export type Opportunity = z.infer<typeof opportunitySchema>;

/** The opportunity_discover envelope (Menara shape). Everything in it is synthetic and says so. */
export const discoverySchema = z.object({
  synthetic: z.literal(true),
  as_of: z.string(),
  data: z.object({
    summary: z.string(),
    opportunities: z.array(opportunitySchema).min(1).max(5),
    geojson: pointCollectionSchema,
    limitations: z.array(z.string()).default([]),
  }).passthrough(),
}).passthrough();
export type Discovery = z.infer<typeof discoverySchema>;

/** Flat Kepler rows from the tool's own GeoJSON; nothing is placed from agent prose. */
export function discoveryRows(discovery: Discovery): Record<string, unknown>[] {
  return discovery.data.geojson.features.map((feature) => ({
    ...Object.fromEntries(Object.entries(feature.properties).map(([key, value]) => [
      key, value !== null && typeof value === "object" ? JSON.stringify(value) : value,
    ])),
    longitude: feature.geometry.coordinates[0], latitude: feature.geometry.coordinates[1],
  }));
}

/** [minLng, minLat, maxLng, maxLat] around the ranked opportunities, padded so the markers are not on the edge. */
export function discoveryBounds(discovery: Discovery, pad = 0.6): [number, number, number, number] {
  const points = discovery.data.opportunities.map((o) => [o.where.lng, o.where.lat]);
  const lngs = points.map((p) => p[0]), lats = points.map((p) => p[1]);
  return [Math.min(...lngs) - pad, Math.min(...lats) - pad, Math.max(...lngs) + pad, Math.max(...lats) + pad];
}

/** Feasibility verdicts Hermes computes from the Engineer's NetOps results (authoritative; agent prose only explains them). */
export const feasibilityVerdictSchema = z.object({
  opportunity_id: z.string(),
  rank: z.number().int(),
  label: z.enum(["supported", "supported with risk", "blocked until repaired", "not validated"]),
  reasons: z.array(z.string()),
}).passthrough();
export type FeasibilityVerdict = z.infer<typeof feasibilityVerdictSchema>;

export type ValidationState =
  | { state: "not_started" }
  | { state: "running"; investigationId: string }
  | { state: "failed"; investigationId: string; error?: string | null }
  | { state: "validated"; investigationId: string; completedAt: string; verdicts: FeasibilityVerdict[] };

type JobLike = {
  investigation_id: string; agent_id: string; status: string; updated_at: string; error?: string | null;
  feasibility?: unknown; tasks: { task_id: string; agent_id: string; tool_calls?: { tool: string; ok?: boolean; data?: unknown }[] }[];
};

/** The graph discovery the Hypothesis agent itself retrieved in a run (from the ledger), or null. */
export function discoveryFromJob(job: JobLike): Discovery | null {
  const calls = job.tasks.filter((t) => t.agent_id === "hypothesis").flatMap((t) => t.tool_calls ?? []);
  const call = calls.filter((c) => c.tool === "opportunity_discover" && c.ok === true).at(-1);
  const parsed = discoverySchema.safeParse(call?.data);
  return parsed.success ? parsed.data : null;
}

/** "validated" only after a real Business Hypothesis run has finished and Hermes computed verdicts for these opportunities. */
export function validationState(job: JobLike | null, investigationId: string | null, discovery: Discovery): ValidationState {
  if (!investigationId) return { state: "not_started" };
  if (!job || job.investigation_id !== investigationId || job.status === "queued" || job.status === "running") {
    return { state: "running", investigationId };
  }
  const verdicts = z.array(feasibilityVerdictSchema).safeParse(job.feasibility);
  const ids = new Set(discovery.data.opportunities.map((o) => o.opportunity_id));
  if (job.agent_id !== "hypothesis" || job.status === "failed" || !verdicts.success || !verdicts.data.length
      || !verdicts.data.every((v) => ids.has(v.opportunity_id))) {
    return { state: "failed", investigationId, error: job.error };
  }
  return { state: "validated", investigationId, completedAt: job.updated_at, verdicts: verdicts.data };
}
