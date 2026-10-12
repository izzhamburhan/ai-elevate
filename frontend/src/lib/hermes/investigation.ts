import type { HermesAgentId, HermesJob } from "./contracts";

/**
 * The investigation storyboard (question → agents → sites → evidence → recommendation), derived
 * only from fields the Hermes service returned. Nothing here infers progress the service did not
 * report: an empty step says so, and a missing summary is no recommendation.
 * Runtime imports stay out of this file so `node --test` can load it without the app's aliases.
 */

export const AGENT_NAMES: Record<HermesAgentId, string> = {
  orchestrator: "Orchestrator",
  forecast: "Forecast",
  business: "Business",
  engineer: "Engineer",
  hypothesis: "Hypothesis",
};

type Job = Pick<HermesJob, "status" | "agent_id" | "tasks" | "summary" | "geojson" | "error"> & { sources?: unknown };
type Source = HermesJob["tasks"][number]["sources"][number];

const isActive = (status: string) => status === "queued" || status === "running";

// ---------------------------------------------------------------------------------------------
// Stages

export type StageId = "question" | "agents" | "sites" | "evidence" | "recommendation";
/** waiting: not reached · active: in progress · done · empty: reached, nothing returned · failed */
export type StageState = "waiting" | "active" | "done" | "empty" | "failed";
export type Stage = { id: StageId; title: string; state: StageState; detail: string };

/**
 * `evidence` is the number of evidence items the caller shows for the job (the Agents tab counts
 * records from successful tool calls); without it, the job's source references are counted.
 */
export function investigationStages(job: Job | null, { submitting = false, evidence }: { submitting?: boolean; evidence?: number } = {}): Stage[] {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (!job) {
    return [
      { id: "question", title: "Question", state: submitting ? "active" : "waiting", detail: submitting ? "Sending to Hermes" : "Ask a question" },
      { id: "agents", title: "Agents", state: "waiting", detail: "Not started" },
      { id: "sites", title: "Sites", state: "waiting", detail: "Not started" },
      { id: "evidence", title: "Evidence", state: "waiting", detail: "Not started" },
      { id: "recommendation", title: "Recommendation", state: "waiting", detail: "Not started" },
    ];
  }
  const active = isActive(job.status);
  const tasks = job.tasks;
  const sites = siteCount(job);
  const evidenceCount = evidence ?? investigationEvidence(job).length;
  const failed = job.status === "failed";

  const agentsState: StageState = active
    ? "active"
    : failed && !tasks.some((t) => t.status === "completed" || t.status === "partial")
      ? "failed"
      : "done";
  const agentsDetail = active
    ? job.status === "queued" ? "Queued" : `${plural(tasks.filter((t) => isActive(t.status)).length || 1, "agent")} working`
    : plural(new Set([job.agent_id, ...tasks.map((t) => t.agent_id)]).size, "agent");

  const finishedState = (count: number): StageState => (count ? "done" : active ? "waiting" : failed ? "failed" : "empty");

  return [
    { id: "question", title: "Question", state: "done", detail: "Sent" },
    { id: "agents", title: "Agents", state: agentsState, detail: agentsDetail },
    { id: "sites", title: "Sites", state: finishedState(sites), detail: sites ? plural(sites, "site") : active ? "Waiting" : "None mapped" },
    { id: "evidence", title: "Evidence", state: finishedState(evidenceCount), detail: evidenceCount ? plural(evidenceCount, evidence === undefined ? "source" : "record") : active ? "Waiting" : "None returned" },
    {
      id: "recommendation",
      title: "Recommendation",
      state: job.summary?.trim() && !active ? "done" : active ? "waiting" : failed ? "failed" : "empty",
      detail: job.summary?.trim() && !active ? (job.status === "partial" ? "Partial" : "Ready") : active ? "Waiting" : failed ? "Failed" : "None returned",
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Sites

export type SiteTone = "red" | "amber" | "green" | "blue" | "neutral";
export type InvestigationSite = {
  key: string;
  name: string;
  siteId?: string;
  detail?: string;
  tone: SiteTone;
  /** The word that goes with the tone, so color is never the only signal. */
  toneLabel?: string;
  lat: number;
  lng: number;
  synthetic: boolean;
};

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : undefined);

/** Reads the first property, in order, that a service set as a plain string or number. */
function prop(properties: Record<string, unknown>, ...names: string[]) {
  for (const name of names) {
    const value = text(properties[name]);
    if (value) return value;
  }
  return undefined;
}

/** A tone only from an explicit status/severity property; no severity is guessed from prose. */
function toneOf(properties: Record<string, unknown>): { tone: SiteTone; label?: string } {
  const raw = prop(properties, "status", "severity", "exposure", "risk", "kpi_status")?.toUpperCase();
  if (!raw) return { tone: "neutral" };
  if (["DOWN", "OUTAGE", "CRITICAL", "HIGH", "FAILED"].includes(raw)) return { tone: "red", label: raw === "DOWN" ? "Outage" : sentence(raw) };
  if (["DEGRADED", "WARNING", "ELEVATED", "MEDIUM", "MAJOR", "OPEN", "CONGESTED", "MAINTENANCE"].includes(raw)) return { tone: "amber", label: sentence(raw) };
  if (["UP", "OK", "HEALTHY", "LOW", "NORMAL", "RESOLVED", "CLOSED", "OPERATIONAL", "ACTIVE", "ON_AIR"].includes(raw)) return { tone: "green", label: sentence(raw) };
  return { tone: "neutral", label: sentence(raw) };
}

const sentence = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replaceAll("_", " ");

function siteCount(job: Job) {
  return job.geojson?.features.length ?? 0;
}

export function investigationSites(job: Job | null): InvestigationSite[] {
  const features = job?.geojson?.features ?? [];
  return features.map((feature, index) => {
    const p = feature.properties;
    const siteId = prop(p, "site_id", "enodeb_name", "cell_id", "id");
    const name = prop(p, "site_name", "name", "label", "location_name", "town") ?? siteId ?? `Site ${index + 1}`;
    const { tone, label } = toneOf(p);
    const place = [prop(p, "town", "district"), prop(p, "state")].filter((part) => part && part !== name).join(", ");
    return {
      key: `${siteId ?? name}-${index}`,
      name,
      siteId: siteId && siteId !== name ? siteId : undefined,
      detail: place || prop(p, "kind", "category", "type"),
      tone,
      toneLabel: label,
      lng: feature.geometry.coordinates[0],
      lat: feature.geometry.coordinates[1],
      synthetic: p.synthetic === true || p.synthetic_network_data === true,
    };
  });
}

/** [minLng, minLat, maxLng, maxLat] around the sites, or null without any. */
export function sitesBounds(sites: Pick<InvestigationSite, "lat" | "lng">[]): [number, number, number, number] | null {
  if (!sites.length) return null;
  const lngs = sites.map((s) => s.lng);
  const lats = sites.map((s) => s.lat);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

// ---------------------------------------------------------------------------------------------
// Evidence

export type EvidenceItem = {
  key: string;
  agent?: HermesAgentId;
  label: string;
  tool?: string;
  kind?: string;
  reference?: string;
  synthetic: boolean;
};

function isSource(value: unknown): value is Source {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Every source reference the job and its tasks returned, de-duplicated, in the order reported. */
export function investigationEvidence(job: Job | null): EvidenceItem[] {
  if (!job) return [];
  const jobSources = Array.isArray(job.sources) ? job.sources.filter(isSource) : [];
  const all: { agent?: HermesAgentId; source: Source }[] = [
    ...job.tasks.flatMap((task) => task.sources.map((source) => ({ agent: task.agent_id, source }))),
    ...jobSources.map((source) => ({ agent: undefined, source })),
  ];
  const seen = new Set<string>();
  const items: EvidenceItem[] = [];
  for (const { agent, source } of all) {
    const label = text(source.label) ?? text(source.tool) ?? text(source.reference) ?? text(source.kind) ?? text(source.source_id);
    if (!label) continue;
    const key = [text(source.source_id), label, text(source.tool), text(source.reference)].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      key,
      agent,
      label,
      tool: text(source.tool),
      kind: text(source.kind),
      reference: text(source.reference),
      synthetic: source.synthetic === true,
    });
  }
  return items;
}

// ---------------------------------------------------------------------------------------------
// Summary

/** Seconds between two ISO times (or until now while running), never negative. */
export function elapsedSeconds(from: string, to: string | number) {
  const end = typeof to === "number" ? to : Date.parse(to);
  return Math.max(0, Math.round((end - Date.parse(from)) / 1000));
}

export function formatElapsed(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}
