"use client";

import { HERMES_AGENTS, hermesAgentsSchema, hermesJobSchema, hermesRequestSchema, type HermesAgentId, type HermesJob } from "./contracts";

/**
 * DEVELOPMENT FIXTURE — not Hermes. A scripted timeline in the documented job shape, so the
 * investigation UI can be built and demonstrated without the service. No model runs and no MCP tool
 * is called. Every agent, task, site and source it returns says "Fixture", and the panel shows a
 * fixture banner while this adapter is in use. Selected only by `?hermes=fixture` (see adapter.ts).
 * Its tool calls carry fixture `data` records so the evidence table has rows to show.
 */

const WARNING = "Fixture adapter: scripted UI data. No Hermes agent, model or MCP tool was run.";

const SITES = [
  { site_id: "FIXTURE-KB-014", site_name: "Fixture site · Kota Bharu Central", town: "Kota Bharu", state: "Kelantan", status: "DOWN", lng: 102.2386, lat: 6.1254 },
  { site_id: "FIXTURE-KB-022", site_name: "Fixture site · Pengkalan Chepa", town: "Kota Bharu", state: "Kelantan", status: "DEGRADED", lng: 102.2931, lat: 6.1667 },
  { site_id: "FIXTURE-KB-031", site_name: "Fixture site · Wakaf Che Yeh", town: "Kota Bharu", state: "Kelantan", status: "DEGRADED", lng: 102.2189, lat: 6.0989 },
  { site_id: "FIXTURE-TM-007", site_name: "Fixture site · Tumpat", town: "Tumpat", state: "Kelantan", status: "OPEN", lng: 102.1711, lat: 6.1978 },
];

const FIXTURE_SOURCE = { service: "fixture", reference: "fixture", synthetic: true };
const source = (label: string, tool: string) => ({ kind: "fixture", label: `Fixture · ${label}`, tool, synthetic: true });

type Step = { at: number; build: (base: HermesJob) => Partial<HermesJob> };
type Task = HermesJob["tasks"][number];

const task = (agent: HermesAgentId, status: Task["status"], extra: Partial<Task> = {}): Task => ({
  task_id: `fixture-${agent}`, agent_id: agent, status, warnings: [WARNING], sources: [], ...extra,
});

const ENGINEER_DONE = task("engineer", "completed", {
  summary: "Fixture: one site in outage and two degraded around Kota Bharu; one open trouble ticket in Tumpat.",
  tool_calls: [
    { tool: "search_sites", ok: true, source: FIXTURE_SOURCE, data: { sites: SITES.map(({ site_id, lat, lng }) => ({ site_id, lat, lng })) } },
    {
      tool: "get_ran_kpi_summary", ok: true, source: FIXTURE_SOURCE,
      data: { sites: [
        { site_id: "FIXTURE-KB-014", availability_pct: 0, status: "DOWN" },
        { site_id: "FIXTURE-KB-022", availability_pct: 97.1, prb_util_pct: 91 },
        { site_id: "FIXTURE-KB-031", availability_pct: 98.4, prb_util_pct: 88 },
      ] },
    },
    { tool: "get_ntt_tickets", ok: true, source: FIXTURE_SOURCE, data: { tickets: [{ ticket_id: "FIXTURE-NTT-0193", site_id: "FIXTURE-TM-007", status: "OPEN" }] } },
  ],
  sources: [source("RAN KPI summary, Kota Bharu cluster", "get_ran_kpi_summary"), source("Open trouble tickets, Kelantan", "get_ntt_tickets"), source("Site inventory search", "search_sites")],
});
const BUSINESS_DONE = task("business", "completed", {
  summary: "Fixture: the affected sites serve the Kota Bharu town centre and the airport road.",
  tool_calls: [{ tool: "get_sites", ok: true, source: FIXTURE_SOURCE }, { tool: "lookup_admin_area", ok: true, source: FIXTURE_SOURCE }],
  sources: [source("Sites within Kota Bharu district", "get_sites")],
});
const FORECAST_FAILED = task("forecast", "failed", {
  error: "Fixture: the weather service was unavailable, so no rainfall evidence was gathered.",
  tool_calls: [{ tool: "get_weather_model_status", ok: false }],
});

/** Seconds after submission at which the fixture job changes, in the order a real run reports. */
const TIMELINE: Step[] = [
  { at: 0, build: () => ({ status: "queued", tasks: [] }) },
  { at: 1.5, build: () => ({ status: "running", tasks: [task("orchestrator", "running", { active_tool: "delegate_specialist" })] }) },
  { at: 3.5, build: () => ({ status: "running", tasks: [task("orchestrator", "running", { active_tool: "delegate_specialist" }), task("engineer", "running", { active_tool: "search_sites" })] }) },
  {
    at: 6,
    build: () => ({
      status: "running",
      tasks: [task("orchestrator", "running", { active_tool: "delegate_specialist" }), task("engineer", "running", { active_tool: "get_ran_kpi_summary", tool_calls: [{ tool: "search_sites", ok: true }] })],
    }),
  },
  {
    at: 9,
    build: () => ({
      status: "running",
      tasks: [task("orchestrator", "running", { active_tool: "delegate_specialist" }), task("engineer", "running", { active_tool: "get_ntt_tickets", tool_calls: [{ tool: "search_sites", ok: true }, { tool: "get_ran_kpi_summary", ok: true }] })],
    }),
  },
  { at: 11.5, build: () => ({ status: "running", tasks: [task("orchestrator", "running", { active_tool: "delegate_specialist" }), ENGINEER_DONE, task("business", "running", { active_tool: "get_sites" })] }) },
  { at: 14, build: () => ({ status: "running", tasks: [task("orchestrator", "running", { active_tool: "delegate_specialist" }), ENGINEER_DONE, BUSINESS_DONE, task("forecast", "running", { active_tool: "get_weather_model_status" })] }) },
  {
    at: 16.5,
    build: () => ({
      status: "partial",
      tasks: [task("orchestrator", "completed", { tool_calls: [{ tool: "delegate_specialist", ok: true }] }), ENGINEER_DONE, BUSINESS_DONE, FORECAST_FAILED],
      summary: [
        "## Fixture recommendation",
        "Send the first field team to Fixture site · Kota Bharu Central, which is in outage, then check the two degraded sites at Pengkalan Chepa and Wakaf Che Yeh.",
        "",
        "- Kota Bharu Central: outage, highest priority.",
        "- Pengkalan Chepa and Wakaf Che Yeh: degraded throughput, check backhaul.",
        "- Tumpat: one open trouble ticket, follow up remotely.",
        "",
        "Weather evidence is missing because the Forecast step failed, so rain is not ruled in or out.",
      ].join("\n"),
      geojson: {
        type: "FeatureCollection",
        features: SITES.map(({ lng, lat, ...properties }) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [lng, lat] as [number, number] },
          properties: { ...properties, source: "fixture", synthetic: true },
        })),
      },
      warnings: [WARNING, "Fixture: partial result because the Forecast step failed."],
    }),
  },
];

const started = new Map<string, { at: number; prompt: string; agent: HermesAgentId }>();

function agents() {
  return hermesAgentsSchema.parse({
    ready: true,
    warnings: [WARNING],
    agents: HERMES_AGENTS.map((id) => ({ agent_id: id, name: id, available: true, capabilities: ["fixture"], warnings: [] })),
  });
}

function investigation(id: string): HermesJob {
  const run = started.get(id);
  if (!run) throw new Error("This fixture investigation was not found. A reload starts a fresh fixture session.");
  const elapsed = (Date.now() - run.at) / 1000;
  const step = [...TIMELINE].reverse().find((s) => elapsed >= s.at) ?? TIMELINE[0];
  const base: HermesJob = {
    investigation_id: id, agent_id: run.agent, status: "queued", prompt: run.prompt,
    created_at: new Date(run.at).toISOString(), updated_at: new Date(run.at + step.at * 1000).toISOString(),
    tasks: [], warnings: [WARNING], summary: null, geojson: null, error: null,
  };
  const built = step.build(base);
  // a question put straight to a specialist has no orchestrator step
  const tasks = (built.tasks ?? []).filter((t) => run.agent === "orchestrator" || t.agent_id !== "orchestrator");
  return hermesJobSchema.parse({ ...base, ...built, tasks });
}

/** Answers the same three requests `/api/hermes` does, from the script above. */
export async function fixtureRequest(search: URLSearchParams, body?: unknown) {
  if (body) {
    const request = hermesRequestSchema.parse(body);
    const id = `fixture-${Date.now().toString(36)}`;
    started.set(id, { at: Date.now(), prompt: request.prompt, agent: request.agent_id });
    return { investigation_id: id, status: "queued" };
  }
  if (search.get("action") === "investigation") return investigation(search.get("id") ?? "");
  return agents();
}
