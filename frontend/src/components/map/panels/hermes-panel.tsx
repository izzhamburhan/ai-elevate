"use client";

import { useEffect, useState } from "react";
import { useStore } from "react-redux";
import { create } from "zustand";
import { Bot, Layers, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  HERMES_AGENTS, hermesAgentsSchema, hermesJobSchema, hermesSubmissionSchema, isHermesJobActive,
  type HermesAgentId, type HermesAgents, type HermesJob,
} from "@/lib/hermes/contracts";
import { loadHermesOverlay } from "@/lib/hermes/map-overlay";
import {
  DISCOVER_PROMPT, discoveryFromJob, discoverySchema, validationState, type Discovery,
} from "@/lib/opportunities/contracts";
import { loadOpportunityOverlay } from "@/lib/opportunities/map-overlay";
import { OpportunityCards } from "./opportunity-cards";
import type { makeKeplerStore } from "../kepler-store";

const AGENT_LABELS: Record<HermesAgentId, string> = {
  orchestrator: "Orchestrator", forecast: "Forecast", business: "Business", engineer: "Engineer / Troubleshooting",
  hypothesis: "Business Hypothesis",
};
type Selection = {
  agentId: HermesAgentId; prompt: string; job: HermesJob | null;
  investigationId: string | null; sessions: Partial<Record<HermesAgentId, string>>; discovery: Discovery | null;
  /** The Business Hypothesis run validating `discovery`, kept apart from later investigations. */
  discoveryRunId: string | null; discoveryJob: HermesJob | null;
};
// Per-browser convenience for the pitch: reopen the last completed, agent-validated discovery run.
const LAST_RUN_KEY = "elevate.opportunities.lastValidatedRun";
function readLastRun(): string | null { try { return window.localStorage.getItem(LAST_RUN_KEY); } catch { return null; } }
function saveLastRun(id: string) { try { window.localStorage.setItem(LAST_RUN_KEY, id); } catch { /* storage unavailable */ } }
// Tab switches retain the investigation. Persistent agent memory remains exclusively in Hermes profiles.
const useHermesSelection = create<Selection>(() => ({
  agentId: "orchestrator", prompt: "Investigate telecom sites in Selangor that may be exposed to heavy rainfall.",
  job: null, investigationId: null, sessions: {}, discovery: null, discoveryRunId: null, discoveryJob: null,
}));

async function requestHermes(search: URLSearchParams, signal?: AbortSignal, body?: unknown) {
  const response = await fetch(`/api/hermes?${search}`, {
    cache: "no-store", signal, ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Hermes is unavailable.");
  return payload;
}

export function HermesPanel({ uiStateActions }: { uiStateActions?: { toggleSidePanel: (id: string) => void } }) {
  const store = useStore() as ReturnType<typeof makeKeplerStore>;
  const { agentId, prompt, job, investigationId, sessions, discovery, discoveryRunId, discoveryJob } = useHermesSelection();
  const [discovering, setDiscovering] = useState(false);
  const [storedRun] = useState(readLastRun);
  const validation = discovery ? validationState(discoveryJob, discoveryRunId, discovery) : null;
  const validatedId = validation?.state === "validated" ? validation.investigationId : null;
  const lastRun = validatedId ?? storedRun;
  const [agents, setAgents] = useState<HermesAgents | null>(null);
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [mapping, setMapping] = useState(false);
  const [mappedId, setMappedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const finished = Boolean(job && !isHermesJobActive(job));
  const active = submitting || Boolean(investigationId && (!job || isHermesJobActive(job)));
  const selectedAgent = agents?.agents.find((agent) => agent.agent_id === agentId);

  async function checkAgents() {
    setChecking(true); setError(null);
    try { setAgents(hermesAgentsSchema.parse(await requestHermes(new URLSearchParams({ action: "agents" })))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Agent status unavailable."); }
    finally { setChecking(false); }
  }

  useEffect(() => {
    const controller = new AbortController();
    requestHermes(new URLSearchParams({ action: "agents" }), controller.signal)
      .then((value) => setAgents(hermesAgentsSchema.parse(value)))
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Agent status unavailable."); })
      .finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!investigationId || finished) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const result = hermesJobSchema.parse(await requestHermes(new URLSearchParams({ action: "investigation", id: investigationId! }), controller.signal));
        if (controller.signal.aborted) return;
        useHermesSelection.setState((state) => ({
          job: result, sessions: result.session_id ? { ...state.sessions, [result.agent_id]: result.session_id } : state.sessions,
          ...(result.investigation_id === state.discoveryRunId ? { discoveryJob: result } : {}),
        }));
        setError(null);
        if (!isHermesJobActive(result)) return;
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Could not read the investigation. No completed result is implied.");
      }
      timer = setTimeout(poll, 1_500);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [investigationId, finished]);

  async function submitInvestigation(event: React.FormEvent) {
    event.preventDefault(); setSubmitting(true); setError(null);
    try {
      const response = hermesSubmissionSchema.parse(await requestHermes(new URLSearchParams(), undefined, {
        agent_id: agentId, prompt, ...(sessions[agentId] ? { session_id: sessions[agentId] } : {}),
      }));
      useHermesSelection.setState({ investigationId: response.investigation_id, job: null });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Investigation could not start."); }
    finally { setSubmitting(false); }
  }

  /** Order 4 demo: rank opportunities from the graph (instant), map them, then have the Hypothesis agent validate them. */
  async function discoverOpportunities() {
    setDiscovering(true); setError(null);
    try {
      const response = await fetch("/api/menara/call", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ tool: "opportunity_discover", args: { top_k: 3 } }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The opportunity graph is unavailable. Start backend/opportunity-mcp on port 8127.");
      const result = discoverySchema.parse(payload);
      useHermesSelection.setState({ discovery: result, discoveryRunId: null, discoveryJob: null, agentId: "hypothesis", prompt: DISCOVER_PROMPT });
      await loadOpportunityOverlay(store, result).catch(() => setError("Opportunities ranked, but the map layer could not be added."));
      const submitted = hermesSubmissionSchema.parse(await requestHermes(new URLSearchParams(), undefined, {
        agent_id: "hypothesis", prompt: DISCOVER_PROMPT, ...(sessions.hypothesis ? { session_id: sessions.hypothesis } : {}),
      }));
      useHermesSelection.setState({ investigationId: submitted.investigation_id, job: null, discoveryRunId: submitted.investigation_id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Opportunity discovery failed.");
    } finally { setDiscovering(false); }
  }

  /** Reopen a completed run exactly as its agent retrieved and validated it (clearly identified by ID and time). */
  async function showLastRun() {
    if (!lastRun) return;
    setDiscovering(true); setError(null);
    try {
      const result = hermesJobSchema.parse(await requestHermes(new URLSearchParams({ action: "investigation", id: lastRun })));
      const recorded = discoveryFromJob(result);
      if (!recorded || validationState(result, result.investigation_id, recorded).state !== "validated") throw new Error("That run has no completed agent validation.");
      useHermesSelection.setState({ discovery: recorded, discoveryRunId: result.investigation_id, discoveryJob: result,
                                    job: result, investigationId: result.investigation_id, agentId: "hypothesis" });
      await loadOpportunityOverlay(store, recorded).catch(() => setError("The run loaded, but the map layer could not be added."));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load the last validated run."); }
    finally { setDiscovering(false); }
  }

  useEffect(() => { if (validatedId) saveLastRun(validatedId); }, [validatedId]);

  async function showFindings() {
    if (!job) return;
    setMapping(true); setError(null);
    try { await loadHermesOverlay(store, job); setMappedId(job.investigation_id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not add findings to the map."); }
    finally { setMapping(false); }
  }

  const warnings = [...new Set([...(agents?.warnings ?? []), ...(selectedAgent?.warnings ?? []), ...(job?.warnings ?? [])])];

  return (
    <section aria-label="Hermes multi-agent investigations" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-1 font-sans text-foreground [&>*]:shrink-0">
      <div className="flex items-center gap-2"><Bot className="size-5 text-violet-500" /><h2 className="text-base font-semibold">Hermes agents</h2></div>
      <p className="text-xs leading-relaxed text-muted-foreground">Independent local Hermes profiles with persistent memory. The Orchestrator delegates to specialists and gathers MCP evidence.</p>
      <div className="rounded-lg border bg-muted/30 p-3 text-xs">
        <div className="flex items-center justify-between"><p className="font-medium">{checking ? "Checking Hermes…" : agents?.ready ? "Local Hermes ready" : "Hermes unavailable or not ready"}</p><button type="button" aria-label="Refresh Hermes readiness" onClick={() => void checkAgents()} disabled={checking || active} className="rounded p-1 hover:bg-accent disabled:opacity-50"><RefreshCw className={`size-3.5 ${checking ? "animate-spin" : ""}`} /></button></div>
        <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1">{HERMES_AGENTS.map((id) => <span key={id} className="flex items-center gap-1.5"><span className={`size-1.5 rounded-full ${agents?.agents.find((agent) => agent.agent_id === id)?.available ? "bg-green-500" : "bg-muted-foreground"}`} />{AGENT_LABELS[id]}</span>)}</div>
      </div>
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs leading-relaxed">
        <p className="font-medium">Telco Opportunity Graph</p>
        <p className="mt-1 text-muted-foreground">Connects sites, KPIs, incidents, events, footfall and SME demand to rank where TM should act. The Business Hypothesis agent then has the Engineer validate network feasibility.</p>
        <Button type="button" onClick={() => void discoverOpportunities()} disabled={checking || active || discovering || !agents?.agents.find((a) => a.agent_id === "hypothesis")?.available} className="mt-2 w-full">
          {discovering ? <LoaderCircle className="animate-spin" /> : <Sparkles />}Discover opportunities
        </Button>
        {lastRun ? <Button type="button" size="sm" variant="ghost" onClick={() => void showLastRun()} disabled={discovering || active} className="mt-1 w-full">
          Show last validated run ({lastRun.slice(0, 8)})
        </Button> : null}
      </div>
      {discovery && validation ? <OpportunityCards discovery={discovery} validation={validation} /> : null}
      <form onSubmit={submitInvestigation} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium">Agent
          <select aria-label="Hermes agent" value={agentId} onChange={(event) => useHermesSelection.setState({ agentId: event.target.value as HermesAgentId })} disabled={active} className="h-9 rounded-md border bg-background px-2 text-xs">
            {HERMES_AGENTS.map((id) => <option key={id} value={id}>{AGENT_LABELS[id]}</option>)}
          </select>
        </label>
        {selectedAgent ? <p className="text-xs leading-relaxed text-muted-foreground">{selectedAgent.capabilities.join(" · ")}</p> : null}
        <label className="flex flex-col gap-1 text-xs font-medium">Investigation
          <textarea aria-label="Hermes investigation" value={prompt} onChange={(event) => useHermesSelection.setState({ prompt: event.target.value })} maxLength={4_000} rows={4} disabled={active} className="resize-y rounded-md border bg-background p-2 text-xs leading-relaxed" />
        </label>
        <Button type="submit" disabled={checking || active || !selectedAgent?.available || !prompt.trim()} className="w-full">{active ? <LoaderCircle className="animate-spin" /> : <Bot />}{active ? "Agents investigating…" : "Start investigation"}</Button>
      </form>
      {error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{error}</p> : null}
      {job ? <>
        <div aria-live="polite" className="rounded-lg border p-3 text-xs leading-relaxed">
          <p className="font-semibold">Investigation · {job.status}</p>
          <p className="mt-1 break-all text-muted-foreground">{job.investigation_id}</p>
          <p className="mt-1 text-muted-foreground">Updated {new Date(job.updated_at).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })} MYT</p>
          {job.summary ? <p className="mt-3 whitespace-pre-wrap">{job.summary}</p> : null}
          {job.error ? <p role="alert" className="mt-2 text-destructive">{job.error}</p> : null}
        </div>
        <div className="space-y-2" aria-label="Specialist activity">{job.tasks.map((task) => <div key={task.task_id} className="rounded-lg border p-3 text-xs leading-relaxed">
          <p className="font-semibold">{AGENT_LABELS[task.agent_id]} · {task.status}</p>
          {task.status === "running" && task.active_tool ? <p className="mt-2 break-words text-muted-foreground">Current tool: {task.active_tool}</p> : null}
          {task.summary ? <p className="mt-2 whitespace-pre-wrap">{task.summary}</p> : null}
          {task.error ? <p role="alert" className="mt-2 whitespace-pre-wrap text-destructive">{task.error}</p> : null}
          {task.tool_calls?.some((call) => call.ok === true) ? <p className="mt-2 break-words text-muted-foreground">Successful MCP calls: {[...new Set(task.tool_calls.filter((call) => call.ok === true).map((call) => call.tool))].join(", ")}</p> : null}
          {task.tool_calls?.some((call) => call.ok === false) ? <p className="mt-2 break-words text-destructive">Failed MCP calls: {[...new Set(task.tool_calls.filter((call) => call.ok === false).map((call) => call.tool))].join(", ")}</p> : null}
          {task.tool_calls?.some((call) => call.ok === undefined) ? <p className="mt-2 break-words text-muted-foreground">Tool activity without confirmed success: {[...new Set(task.tool_calls.filter((call) => call.ok === undefined).map((call) => call.tool))].join(", ")}</p> : null}
          {task.sources.length ? <details className="mt-2"><summary className="cursor-pointer font-medium">Evidence sources ({task.sources.length})</summary><ul className="mt-1 space-y-1 pl-4">{task.sources.map((source, index) => <li key={`${source.source_id ?? source.tool}-${index}`} className="list-disc break-words text-muted-foreground">{source.label ?? source.tool ?? source.reference ?? source.kind ?? source.source_id}{source.synthetic ? " · SYNTHETIC" : ""}{source.tool && source.label ? ` · ${source.tool}` : ""}</li>)}</ul></details> : null}
          {[...new Set(task.warnings)].map((warning) => <p key={warning} className="mt-2 text-amber-800 dark:text-amber-300">{warning}</p>)}
        </div>)}</div>
        {job.geojson?.features.length ? <div className="space-y-2"><Button type="button" variant="outline" disabled={mapping || active} onClick={() => void showFindings()} className="w-full">{mapping ? <LoaderCircle className="animate-spin" /> : <Layers />}Show findings on map ({job.geojson.features.length})</Button>{mappedId === job.investigation_id ? <p role="status" className="text-xs text-muted-foreground">Investigation evidence added to the map.</p> : null}<p className="text-xs leading-relaxed text-muted-foreground">Map properties preserve source provenance. Synthetic telecom records, historical weather replay, ML predictions and agent recommendations are distinct evidence types.</p></div> : null}
      </> : null}
      {warnings.map((warning) => <p key={warning} className="rounded-md bg-amber-500/10 p-2 text-xs leading-relaxed text-amber-800 dark:text-amber-300">{warning}</p>)}
      <Button type="button" size="sm" variant="ghost" onClick={() => uiStateActions?.toggleSidePanel("layer")}><Layers />Map layers</Button>
    </section>
  );
}
