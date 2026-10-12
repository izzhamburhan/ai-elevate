import { callMenaraTool, dataOf } from "./call";

/**
 * The self-healing loop, made visible: detect, diagnose, simulate, approve, apply, verify, rollback, recover.
 * A scripted replay (no model, no key) drives the real MCP servers through the flood story; a human approves
 * risky steps in the panel. `healState` reads the servers for the chart, so it is drawn from data.
 * All data is synthetic.
 */
export const STAGES = ["detect", "diagnose", "simulate", "approve", "apply", "verify", "rollback", "recover"] as const;
export type Stage = (typeof STAGES)[number];

export const THRESHOLD_PRB = 85;
const FLOOD_ANCHOR = "KKRI-0142"; // the scripted flood tower, until an incident names another
const MAX_WINDOW_MIN = 1440; // tower_get_kpi's limit
const LEAD_MIN = 240;
const MAX_POINTS = 200;
const START_CLOCK_MIN = 12; // when the first tickets of the storm have arrived
const APPROVER = "elevate-ui-human";

type Args = Record<string, unknown>;

// ---------------------------------------------------------------- stages

const DETECT = new Set(["ticket_get_ticket", "ticket_cluster_by_location", "tower_get_status", "tower_get_alarms"]);
const DIAGNOSE = new Set(["ontology_blast_radius", "ontology_create_incident"]);
const DIAGNOSE_PREFIXES = ["grid_", "flood_", "weather_"];

export function stageFor(name: string, args: Args): Stage | null {
  if (DETECT.has(name)) return "detect";
  if (DIAGNOSE.has(name) || DIAGNOSE_PREFIXES.some((p) => name.startsWith(p))) return "diagnose";
  if (name.startsWith("twin_")) return "simulate";
  if (name === "policy_check_action") return "approve";
  if (name === "ran_tilt_cells" || name === "drone_dispatch") return "apply";
  if (name === "tower_get_kpi") return "verify";
  if (name === "ran_revert_change") return "rollback";
  if (name === "ontology_update_incident" && args.status === "RESOLVED") return "recover";
  return null;
}

export type StageEvent = { stage: Stage; attempt: number; label: string };

/** Counts the tilt attempts of one run and words each stage event. */
export class StageTracker {
  attempt = 0;

  observe(name: string, args: Args, data: Record<string, unknown>): StageEvent | null {
    const stage = stageFor(name, args);
    if (!stage) return null;
    if (name === "ran_tilt_cells") this.attempt += 1;
    const attempt = name !== "drone_dispatch" && (stage === "apply" || stage === "verify" || stage === "rollback") ? this.attempt : 0;
    return { stage, attempt, label: wording(stage, name, args, data, attempt) };
  }
}

const POLICY_WORDS: Record<string, string> = {
  ask: "Policy: a human must approve",
  allow: "Policy: allowed",
  deny: "Policy: denied",
  approved_by_human: "Policy: a human approved",
  rejected_by_human: "Policy: a human rejected",
};

function wording(stage: Stage, name: string, args: Args, data: Record<string, unknown>, attempt: number): string {
  switch (stage) {
    case "apply": {
      if (name === "ran_tilt_cells") {
        const towers = ((args.changes as { enodeb_name?: string }[] | undefined) ?? []).map((c) => c.enodeb_name ?? "?");
        return `Tilt attempt ${attempt}: ${towers.join(", ") || "neighbours"}`;
      }
      return `Drone sent to ${args.enodeb_name ?? "the tower"}`;
    }
    case "verify": {
      const peak = (data.summary as { max_prb_util?: number } | undefined)?.max_prb_util;
      return peak != null ? `KPI check ${args.enodeb_name ?? "tower"}: peak ${peak}% PRB` : `KPI check ${args.enodeb_name ?? "tower"}`;
    }
    case "rollback":
      return `Rolled back ${args.change_id ?? "the change"}`;
    case "approve":
      return POLICY_WORDS[String(data.decision)] ?? "Policy check";
    case "recover":
      return "Incident resolved";
    case "simulate":
      return `Simulated before acting: ${name.includes("tilt") ? "tilt" : "failure"}`;
    case "diagnose":
      return `Diagnose: ${name.startsWith("ontology") ? "blast radius and incident" : name.split("_", 1)[0]}`;
    default:
      return `Detect: ${args.enodeb_name ?? args.ticket_id ?? name}`;
  }
}

// ---------------------------------------------------------------- the scripted replay

const NEIGHBOURS = ["KKRI-0143", "KKRI-0144"];
const TILT = NEIGHBOURS.map((enodeb_name) => ({ enodeb_name, tilt_delta_deg: 4.0 }));
const TOWER = FLOOD_ANCHOR;

type Results = unknown[];
type Step = [tool: string, build: (r: Results) => Args];

const dig = (value: unknown, ...path: string[]): unknown => {
  let v = value;
  for (const key of path) {
    if (!v || typeof v !== "object") return undefined;
    v = (v as Record<string, unknown>)[key];
  }
  return v;
};
const token = (r: unknown) => String(dig(r, "token") ?? dig(r, "data", "token") ?? "");
const incidentId = (r: Results) =>
  String((dig(r[7], "data", "incidents") as { incident_id: string }[] | undefined)?.[0]?.incident_id ?? "INC-0001");
const ticketIds = (r: Results) => ((dig(r[1], "data", "tickets") as { ticket_id: string }[] | undefined) ?? []).map((t) => t.ticket_id);

// Result indexes (r[n]) refer to earlier steps in this list.
const STEPS: Step[] = [
  ["ticket_get_ticket", () => ({ ticket_id: "TK-88213" })],
  ["ticket_cluster_by_location", () => ({ ticket_id: "TK-88213", radius_km: 15, window_min: 30 })],
  ["tower_get_status", () => ({ enodeb_name: TOWER })],
  ["grid_get_tower_power", () => ({ enodeb_name: TOWER })],
  ["flood_get_gauge", () => ({ gauge_id: "GAUGE-KKRI-01" })],
  ["ontology_blast_radius", () => ({ site: TOWER })],
  [
    "ontology_create_incident",
    (r) => ({
      enodeb_name: TOWER,
      cause: "FLOOD",
      cause_confidence: 0.93,
      summary: "Tower down: feeder tripped, river above danger level, heavy rain. Replay of the scripted story.",
      ticket_ids: ticketIds(r),
    }),
  ],
  ["ontology_list_incidents", () => ({ enodeb_name: TOWER })],
  ["twin_simulate_tilt", () => ({ changes: TILT })],
  ["policy_check_action", () => ({ action: "drone_dispatch", targets: [TOWER], confidence: 0.93, reason: "Check the access road and genset" })],
  ["drone_dispatch", (r) => ({ enodeb_name: TOWER, policy_token: token(r[9]), reason: "Check the access road and genset" })],
  ["demo_advance_clock", () => ({ minutes: 65 })],
  ["drone_get_mission", (r) => ({ mission_id: dig(r[10], "data", "mission_id") ?? "MIS-0001" })],
  ["policy_check_action", () => ({ action: "ran_tilt_cells", targets: NEIGHBOURS, confidence: 0.93, reason: "Simulation recommends it" })],
  ["ran_tilt_cells", (r) => ({ changes: TILT, policy_token: token(r[13]), reason: "Relieve the overloaded neighbours" })],
  ["demo_advance_clock", () => ({ minutes: 10 })], // watch the KPIs for a while before judging the fix
  ["tower_get_kpi", () => ({ enodeb_name: "KKRI-0143", window_min: 5 })],
  ["tower_get_kpi", () => ({ enodeb_name: "KKRI-0144", window_min: 5 })],
  ["policy_check_action", () => ({ action: "ran_revert_tilt", targets: NEIGHBOURS, confidence: 0.99, reason: "KKRI-0143 did not improve" })],
  [
    "ran_revert_change",
    (r) => ({ change_id: dig(r[14], "data", "change_id") ?? "CHG-0001", policy_token: token(r[18]), reason: "Fix did not improve KPIs" }),
  ],
  ["policy_check_action", () => ({ action: "ran_tilt_cells", targets: NEIGHBOURS, confidence: 0.93, reason: "Second attempt" })],
  ["ran_tilt_cells", (r) => ({ changes: TILT, policy_token: token(r[20]), reason: "Second attempt" })],
  ["demo_advance_clock", () => ({ minutes: 10 })],
  ["tower_get_kpi", () => ({ enodeb_name: "KKRI-0143", window_min: 5 })],
  ["ontology_update_incident", (r) => ({ incident_id: incidentId(r), status: "MITIGATING", note: "Neighbours re-tilted, load relieved" })],
  ["demo_advance_clock", () => ({ minutes: 300 })],
  ["tower_get_status", () => ({ enodeb_name: TOWER })],
  ["policy_check_action", () => ({ action: "ran_revert_tilt", targets: NEIGHBOURS, confidence: 0.99, reason: "Power is back; restore the original tilt" })],
  [
    "ran_revert_change",
    (r) => ({ change_id: dig(r[21], "data", "change_id") ?? "CHG-0002", policy_token: token(r[27]), reason: "Power is back" }),
  ],
  ["ontology_update_incident", (r) => ({ incident_id: incidentId(r), status: "RESOLVED", note: "Power restored, tilt rolled back" })],
];

const FINISHED =
  "Replay finished (a fixed script, no model). Flood cut power to KKRI-0142, an incident was recorded, a human-approved drone inspected the site, " +
  "a first tilt of the neighbours failed its KPI check and was rolled back, a second tilt worked, power returned, the tilt was undone and the " +
  "incident resolved. All data is synthetic.";
const REJECTED = "Replay stopped: the human rejected an action, so nothing real-world was done.";

// ---------------------------------------------------------------- run manager (one run at a time)

export type RunEvent =
  | { type: "stage"; step: number | null; stage: Stage; attempt: number; label: string }
  | { type: "approval"; approvalId: string; summary: string }
  | { type: "final"; status: "done" | "cancelled" | "error"; text: string };

type Run = {
  id: string;
  status: "running" | "done" | "cancelled" | "error";
  events: RunEvent[];
  cancelled: boolean;
  pending: ((approve: boolean) => void) | null;
};

// kept on globalThis so dev hot reloads do not lose the run
const holder = globalThis as unknown as { __elevateHealRun?: Run };

export function currentRun(): Run | undefined {
  return holder.__elevateHealRun;
}

export function startReplay(): string {
  if (holder.__elevateHealRun?.status === "running") throw new Error("A self-heal run is already in progress.");
  const run: Run = { id: crypto.randomUUID().slice(0, 8), status: "running", events: [], cancelled: false, pending: null };
  holder.__elevateHealRun = run;
  void execute(run);
  return run.id;
}

export function decide(runId: string, approve: boolean): boolean {
  const run = holder.__elevateHealRun;
  if (!run || run.id !== runId || !run.pending) return false;
  const resolve = run.pending;
  run.pending = null;
  resolve(approve);
  return true;
}

export function cancel(runId: string): boolean {
  const run = holder.__elevateHealRun;
  if (!run || run.id !== runId || run.status !== "running") return false;
  run.cancelled = true;
  if (run.pending) decide(runId, false);
  return true;
}

export function clearRun() {
  if (holder.__elevateHealRun?.status === "running") throw new Error("A self-heal run is in progress.");
  holder.__elevateHealRun = undefined;
}

function finish(run: Run, status: "done" | "cancelled" | "error", text: string) {
  run.events.push({ type: "final", status, text });
  run.status = status;
}

async function execute(run: Run) {
  const tracker = new StageTracker();
  const results: Results = [];
  try {
    await callMenaraTool("demo_set_clock", { t_min: START_CLOCK_MIN });
    for (let i = 0; i < STEPS.length; i++) {
      if (run.cancelled) return finish(run, "cancelled", "Run cancelled.");
      const [name, build] = STEPS[i];
      const args = build(results);
      let result: unknown = await callMenaraTool(name, args);

      if (name === "policy_check_action") {
        const data = dataOf(result);
        if (data.decision === "ask" && data.approval_id) {
          const approvalId = String(data.approval_id);
          const summary = `${args.action} on ${(args.targets as string[]).join(", ")} (confidence ${args.confidence}). Policy says: ${data.reason ?? "approval needed"}`;
          run.events.push({ type: "stage", step: i, ...tracker.observe(name, args, { decision: "ask" })! });
          // human in the loop: the run waits here until a person approves or rejects in the UI
          const approved = await new Promise<boolean>((resolve) => {
            run.pending = resolve;
            run.events.push({ type: "approval", approvalId, summary });
          });
          const key = process.env.MENARA_APPROVER_KEY ?? "dev-only-approver-key";
          if (!approved) {
            await callMenaraTool("policy_reject", { approval_id: approvalId, approver: APPROVER, approver_key: key });
            run.events.push({ type: "stage", step: null, stage: "approve", attempt: 0, label: POLICY_WORDS.rejected_by_human });
            return finish(run, run.cancelled ? "cancelled" : "done", run.cancelled ? "Run cancelled." : REJECTED);
          }
          const granted = await callMenaraTool("policy_approve", { approval_id: approvalId, approver: APPROVER, approver_key: key });
          result = { decision: "approved_by_human", approval_id: approvalId, token: dataOf(granted).token };
          run.events.push({ type: "stage", step: null, stage: "approve", attempt: 0, label: POLICY_WORDS.approved_by_human });
        } else {
          run.events.push({ type: "stage", step: i, ...tracker.observe(name, args, data)! });
        }
        results.push(result);
        continue;
      }

      results.push(result);
      const event = tracker.observe(name, args, dataOf(result));
      if (event) run.events.push({ type: "stage", step: i, ...event });
    }
    finish(run, "done", FINISHED);
  } catch (error) {
    finish(run, "error", error instanceof Error ? error.message : String(error));
  }
}

// ---------------------------------------------------------------- chart state, read from the servers

type Point = { t_min: number; prb: number };

const safe = async (tool: string, args: Args): Promise<Record<string, unknown>> => {
  try {
    return dataOf(await callMenaraTool(tool, args));
  } catch {
    return {};
  }
};

function thin(points: Point[]): Point[] {
  if (points.length <= MAX_POINTS) return points;
  const step = Math.ceil(points.length / MAX_POINTS);
  const kept = points.filter((_, i) => i % step === 0);
  if (kept[kept.length - 1] !== points[points.length - 1]) kept.push(points[points.length - 1]);
  return kept;
}

const minutesFrom = (start: number, stamp: unknown) => (typeof stamp === "string" ? Math.round((Date.parse(stamp) - start) / 60000) : null);

export type HealState = {
  clock_min: number;
  failed_tower: string;
  failed_status: string | null;
  threshold: number;
  watched: string[];
  series: Record<string, Point[]>;
  changes: { change_id: string; status: string; applied_min: number | null; reverted_min: number | null; towers: string[] }[];
  incident: { incident_id: string; status: string } | null;
  run: { id: string; status: Run["status"] } | null;
  /** The failed tower and its neighbours, for drawing the incident on the map. */
  map: {
    towers: { name: string; lat: number; lng: number; role: "failed" | "neighbour"; status: string; prb_now: number | null; tilted: boolean }[];
  };
};

export async function healState(): Promise<HealState> {
  const clock = await safe("demo_get_clock", {});
  const clockMin = Number(clock.t_min ?? 0);
  const now = Date.parse(String(clock.at));
  const start = now - clockMin * 60000;

  const incidents = (((await safe("ontology_list_incidents", {})).incidents as Record<string, string>[] | undefined) ?? []).filter(
    (i) => Date.parse(i.created_at) <= now,
  );
  const latest = [...incidents].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  const failed = latest?.enodeb_name ?? FLOOD_ANCHOR;

  const changes = (((await safe("ran_list_changes", {})).changes as Record<string, unknown>[] | undefined) ?? [])
    .filter((c) => Date.parse(String(c.applied_at)) <= now)
    .sort((a, b) => String(a.applied_at ?? "").localeCompare(String(b.applied_at ?? "")) || String(a.change_id).localeCompare(String(b.change_id)));
  const changed = changes.flatMap((c) => (c.towers as string[] | undefined) ?? []);

  const status = await safe("tower_get_status", { enodeb_name: failed });
  const neighbours = ((status.neighbours as { enodeb_name: string }[] | undefined) ?? []).map((n) => n.enodeb_name);
  const candidates = [...new Set([...neighbours, ...changed])];

  const window = Math.min(MAX_WINDOW_MIN, Math.max(5, clockMin + LEAD_MIN));
  const watched: string[] = [];
  const series: Record<string, Point[]> = {};
  for (const tower of candidates) {
    const kpi = await safe("tower_get_kpi", { enodeb_name: tower, window_min: window });
    const points = ((kpi.points as { t_min?: number; prb_util: number }[] | undefined) ?? [])
      .filter((p) => p.t_min != null)
      .map((p) => ({ t_min: p.t_min as number, prb: p.prb_util }));
    if (points.length && (changed.includes(tower) || Math.max(...points.map((p) => p.prb)) >= THRESHOLD_PRB)) {
      watched.push(tower);
      series[tower] = thin(points);
    }
  }
  // positions and live status of the failed tower and its neighbours
  const at = { lat: Number(status.lat), lng: Number(status.lng) };
  const around = Number.isFinite(at.lat)
    ? (((await safe("tower_list_in_radius", { lat: at.lat, lng: at.lng, radius_km: 10, limit: 60 })).towers as
        | { enodeb_name: string; lat: number; lng: number; status: string }[]
        | undefined) ?? [])
    : [];
  const tiltedNow = new Set(changes.filter((c) => c.status !== "REVERTED").flatMap((c) => (c.towers as string[] | undefined) ?? []));
  const mapTowers = around
    .filter((t) => t.enodeb_name === failed || candidates.includes(t.enodeb_name))
    .map((t) => ({
      name: t.enodeb_name,
      lat: t.lat,
      lng: t.lng,
      role: (t.enodeb_name === failed ? "failed" : "neighbour") as "failed" | "neighbour",
      status: t.status,
      prb_now: series[t.enodeb_name]?.at(-1)?.prb ?? null,
      tilted: tiltedNow.has(t.enodeb_name),
    }));

  const run = currentRun();
  return {
    map: { towers: mapTowers },
    clock_min: clockMin,
    failed_tower: failed,
    failed_status: (status.status as string | undefined) ?? null,
    threshold: THRESHOLD_PRB,
    watched,
    series,
    changes: changes.map((c) => ({
      change_id: String(c.change_id),
      status: String(c.status),
      applied_min: minutesFrom(start, c.applied_at),
      reverted_min: minutesFrom(start, c.reverted_at),
      towers: (c.towers as string[] | undefined) ?? [],
    })),
    incident: latest ? { incident_id: latest.incident_id, status: latest.status } : null,
    run: run ? { id: run.id, status: run.status } : null,
  };
}