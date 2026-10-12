import { z } from "zod";

export const HERMES_AGENTS = ["orchestrator", "forecast", "business", "engineer", "hypothesis"] as const;
export const hermesAgentIdSchema = z.enum(HERMES_AGENTS);
export type HermesAgentId = z.infer<typeof hermesAgentIdSchema>;
const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const timestamp = z.string().datetime({ offset: true });
const status = z.enum(["queued", "running", "completed", "partial", "failed"]);

export const hermesRequestSchema = z.object({
  agent_id: hermesAgentIdSchema,
  prompt: z.string().trim().min(1).max(4_000),
  session_id: identifier.optional(),
}).strict();

export const hermesAgentsSchema = z.object({
  ready: z.boolean(),
  agents: z.array(z.object({
    agent_id: hermesAgentIdSchema, name: z.string(), available: z.boolean(),
    capabilities: z.array(z.string()), warnings: z.array(z.string()).default([]),
  }).passthrough()).max(HERMES_AGENTS.length),
  warnings: z.array(z.string()).default([]),
}).passthrough();
export type HermesAgents = z.infer<typeof hermesAgentsSchema>;

export const hermesSourceSchema = z.object({
  source_id: z.string().optional(), kind: z.string().optional(), label: z.string().optional(),
  tool: z.string().optional(), reference: z.string().optional(), synthetic: z.boolean().optional(),
}).passthrough();

export const hermesGeojsonSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(z.object({
    type: z.literal("Feature"),
    geometry: z.object({
      type: z.literal("Point"),
      coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
    }),
    properties: z.record(z.string(), z.unknown()),
  })).max(25_000),
});
export type HermesGeojson = z.infer<typeof hermesGeojsonSchema>;

export const hermesJobSchema = z.object({
  investigation_id: identifier, agent_id: hermesAgentIdSchema, status,
  prompt: z.string(), created_at: timestamp, updated_at: timestamp,
  session_id: identifier.optional(), summary: z.string().nullable().optional(),
  tasks: z.array(z.object({
    task_id: identifier, agent_id: hermesAgentIdSchema, status,
    summary: z.string().nullable().optional(), warnings: z.array(z.string()).default([]),
    error: z.string().nullable().optional(), active_tool: z.string().nullable().optional(),
    sources: z.array(hermesSourceSchema).default([]),
    tool_calls: z.array(z.object({ tool: z.string(), ok: z.boolean().optional() }).passthrough()).optional(),
  }).passthrough()).max(16),
  geojson: hermesGeojsonSchema.nullable().optional(), warnings: z.array(z.string()).default([]),
  error: z.string().nullable().optional(),
}).passthrough();
export type HermesJob = z.infer<typeof hermesJobSchema>;

export const hermesSubmissionSchema = z.object({ investigation_id: identifier, status }).passthrough();

export function parseHermesQuery(search: URLSearchParams) {
  const action = search.get("action") ?? "agents";
  if (action === "agents") return { action } as const;
  if (action !== "investigation") return null;
  const result = identifier.safeParse(search.get("id"));
  return result.success ? { action, id: result.data } as const : null;
}

/** Browser input can select a known operation, never a host, path, or profile directory. */
export function hermesBackendUrl(base: string, operation: "agents" | "create" | "investigation", id?: string) {
  const url = new URL(base);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid Hermes service configuration");
  if (operation === "investigation" && !identifier.safeParse(id).success) throw new Error("Invalid investigation identifier");
  url.pathname = operation === "agents" ? "/api/agents" : operation === "create" ? "/api/investigations" : `/api/investigations/${id}`;
  url.search = ""; url.hash = "";
  return url;
}

export function isHermesJobActive(job: Pick<HermesJob, "status">) {
  return job.status === "queued" || job.status === "running";
}

/** Coordinates come only from a validated service result; no location is inferred from prose. */
export function hermesMapRows(geojson: HermesGeojson, investigationId: string) {
  return geojson.features.map((feature) => ({
    ...Object.fromEntries(Object.entries(feature.properties).map(([key, value]) => [
      key, value !== null && typeof value === "object" ? JSON.stringify(value) : value,
    ])),
    longitude: feature.geometry.coordinates[0], latitude: feature.geometry.coordinates[1],
    investigation_id: investigationId,
  }));
}
