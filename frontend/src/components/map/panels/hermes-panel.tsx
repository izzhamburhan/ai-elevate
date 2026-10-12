"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "react-redux";
import { Bot, History, Layers, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  HERMES_AGENTS, hermesAgentsSchema, hermesJobSchema, hermesSubmissionSchema, isHermesJobActive,
  type HermesAgentId, type HermesAgents,
} from "@/lib/hermes/contracts";
import { requestHermes, wantsFixture } from "@/lib/hermes/adapter";
import { fetchAreaInsights, siteLocations, type AreaInsights } from "@/lib/hermes/area-insights";
import { clearHighlight, highlightEvidence, useMapFocus } from "@/lib/hermes/map-focus";
import {
  AREA_SCOPED_AGENTS, areaAdherence, areaFromPrompt, areaFromShape, areaFromTower, digest, evidenceNear, evidenceRows,
  promptWithoutArea, withAreaContext, type EvidenceRow, type MapArea,
} from "@/lib/hermes/workspace";
import { extractFeatureMetrics, formatBoundaryLabel } from "@/lib/menara/boundary-context";
import {
  DISCOVER_PROMPT, discoveryFromJob, discoverySchema, validationState,
} from "@/lib/opportunities/contracts";
import { loadOpportunityOverlay } from "@/lib/opportunities/map-overlay";
import { cn } from "@/lib/utils";
import { showInvestigationOnMap, SIDE_PANEL_MARGIN } from "../command-deck/investigation-map";
import { useActiveDrawnFeature } from "../drawn-boundary-actions";
import { useSidePanelWidth } from "../side-panel-width";
import { AGENT_META, AgentRoster, AreaContextCard, InvestigationResults, Kind, ProgressTimeline } from "./agents-workspace";
import { CommercialApplications } from "./commercial-applications";
import { DecisionTimeMachine } from "./decision-time-machine";
import { applyPolledJob, useHermesSelection } from "./hermes-selection";
import { InvestigationStoryboard } from "./investigation-storyboard";
import { OpportunityCards } from "./opportunity-cards";
import type { makeKeplerStore } from "../kepler-store";

// Per-browser conveniences for the pitch: the last agent-validated discovery run and recent investigations.
const LAST_RUN_KEY = "elevate.opportunities.lastValidatedRun";
const RECENT_KEY = "elevate.hermes.recentInvestigations";
type Recent = { id: string; agent: HermesAgentId; label: string; at: string };
function readLastRun(): string | null { try { return window.localStorage.getItem(LAST_RUN_KEY); } catch { return null; } }
function saveLastRun(id: string) { try { window.localStorage.setItem(LAST_RUN_KEY, id); } catch { /* storage unavailable */ } }
function readRecent(): Recent[] { try { return JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]") as Recent[]; } catch { return []; } }
function saveRecent(entry: Recent) {
  const next = [entry, ...readRecent().filter((r) => r.id !== entry.id)].slice(0, 8);
  try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  return next;
}
const areaKey = (a: MapArea | null) => (a ? `${a.kind}:${a.center.lat.toFixed(5)},${a.center.lng.toFixed(5)}:${a.radiusKm}` : "");

export function HermesPanel({ uiStateActions }: { uiStateActions?: { toggleSidePanel: (id: string) => void } }) {
  const store = useStore() as ReturnType<typeof makeKeplerStore>;
  const { agentId, prompt, job, investigationId, sessions, discovery, discoveryRunId, discoveryJob, attachArea, areaSource, areaCleared, mappedId } = useHermesSelection();
  const panelWidth = useSidePanelWidth().width + 2 * SIDE_PANEL_MARGIN;
  const [fixture] = useState(wantsFixture);
  const [discovering, setDiscovering] = useState(false);
  const [timeMachineOpen, setTimeMachineOpen] = useState(false);
  const [commercialOpen, setCommercialOpen] = useState(false);
  const [storedRun] = useState(readLastRun);
  const [recent, setRecent] = useState<Recent[]>(readRecent);
  const validation = discovery ? validationState(discoveryJob, discoveryRunId, discovery) : null;
  const validatedId = validation?.state === "validated" ? validation.investigationId : null;
  const lastRun = validatedId ?? storedRun;
  const [agents, setAgents] = useState<HermesAgents | null>(null);
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [mapping, setMapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finished = Boolean(job && !isHermesJobActive(job));
  const active = submitting || Boolean(investigationId && (!job || isHermesJobActive(job)));
  const selectedAgent = agents?.agents.find((agent) => agent.agent_id === agentId);

  // ---------------------------------------------------------------- the selected map area
  const { activeFeature } = useActiveDrawnFeature(store);
  const { tower, highlighted } = useMapFocus();
  const shapeArea = useMemo(() => {
    if (!activeFeature) return null;
    const metrics = extractFeatureMetrics(activeFeature);
    return areaFromShape(metrics.shape, metrics.rings[0] ?? [], `Drawn ${formatBoundaryLabel(metrics)}`);
  }, [activeFeature]);
  const towerArea = useMemo(() => (tower ? areaFromTower(tower.name, tower.lat, tower.lng) : null), [tower]);
  useEffect(() => { if (tower) useHermesSelection.setState({ areaSource: "tower" }); }, [tower]);
  useEffect(() => { if (shapeArea) useHermesSelection.setState({ areaSource: "shape" }); }, [shapeArea]);
  const candidate = areaSource === "tower" ? towerArea ?? shapeArea : shapeArea ?? towerArea;
  const area = candidate && areaKey(candidate) !== areaCleared ? candidate : null;
  const [insights, setInsights] = useState<{ key: string; value: AreaInsights } | null>(null);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const key = areaKey(area);
  useEffect(() => {
    if (!area) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchAreaInsights(area, controller.signal)
        .then((value) => { if (!controller.signal.aborted) setInsights({ key, value }); })
        .catch(() => {})
        .finally(() => { if (!controller.signal.aborted) setSettledKey(key); });
    }, 350); // drawing and dragging change the shape often; wait for it to settle
    return () => { controller.abort(); clearTimeout(timer); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- `key` identifies the area
  const areaInsights = insights?.key === key ? insights.value : null;
  const loadingArea = Boolean(area) && settledKey !== key;
  const areaSiteIds = areaInsights?.sites.ok ? areaInsights.sites.value.sites.map((s) => s.site_id) : [];
  const scopedAgent = (AREA_SCOPED_AGENTS as readonly string[]).includes(agentId);

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
        applyPolledJob(result);
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
    const withArea = attachArea && scopedAgent && area;
    try {
      const response = hermesSubmissionSchema.parse(await requestHermes(new URLSearchParams(), undefined, {
        agent_id: agentId, prompt: withAreaContext(prompt, withArea ? area : null, areaSiteIds),
        ...(sessions[agentId] ? { session_id: sessions[agentId] } : {}),
      }));
      useHermesSelection.setState({ investigationId: response.investigation_id, job: null });
      setRecent(saveRecent({ id: response.investigation_id, agent: agentId, label: `${prompt.trim().slice(0, 60)}${withArea ? ` · ${area.label}` : ""}`, at: new Date().toISOString() }));
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
      setRecent(saveRecent({ id: submitted.investigation_id, agent: "hypothesis", label: "Discover opportunities", at: new Date().toISOString() }));
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

  /** Reopen any saved investigation from the Hermes ledger. */
  async function openRecent(id: string) {
    if (!id) return;
    setError(null);
    try {
      const result = hermesJobSchema.parse(await requestHermes(new URLSearchParams({ action: "investigation", id })));
      useHermesSelection.setState({ job: result, investigationId: result.investigation_id, agentId: result.agent_id });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load that investigation."); }
  }

  useEffect(() => { if (validatedId) saveLastRun(validatedId); }, [validatedId]);

  /** Order 6: the agent explains the exact simulated scenario; its computed numbers stay authoritative. */
  async function explainScenario(explainRequest: string) {
    setError(null);
    try {
      const response = hermesSubmissionSchema.parse(await requestHermes(new URLSearchParams(), undefined, {
        agent_id: "hypothesis", prompt: explainRequest, ...(sessions.hypothesis ? { session_id: sessions.hypothesis } : {}),
      }));
      useHermesSelection.setState({ investigationId: response.investigation_id, job: null, agentId: "hypothesis", prompt: explainRequest });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The explanation could not start."); }
  }

  async function showFindings() {
    if (!job) return;
    setMapping(true); setError(null);
    // the findings layer, then a camera flight that frames them beside the panel
    try { await showInvestigationOnMap(store, "workspace", job, panelWidth); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not add findings to the map."); }
    finally { setMapping(false); }
  }

  // ---------------------------------------------------------------- results of the current investigation
  const jobArea = useMemo(() => (job ? areaFromPrompt(job.prompt) : null), [job]);
  const [looked, setLooked] = useState<Map<string, { lat: number; lng: number }>>(new Map());
  const siteCoords = useMemo(() => new Map([...looked, ...(areaInsights?.sites.ok ? areaInsights.sites.value.sites : []).map((s) => [s.site_id.toUpperCase(), { lat: s.lat, lng: s.lng }] as const)]), [areaInsights, looked]);
  const rows = useMemo(() => (job ? evidenceRows(job, siteCoords) : []), [job, siteCoords]);
  const missing = rows.filter((r) => r.siteId && r.lat === null && !looked.has(r.siteId)).map((r) => r.siteId!).sort().join(",");
  useEffect(() => {
    if (!missing) return;
    const controller = new AbortController();
    siteLocations(missing.split(","), controller.signal)
      .then((found) => { if (!controller.signal.aborted) setLooked((prev) => new Map([...prev, ...found])); })
      .catch(() => {}); // pins stay off; the rows still show
    return () => controller.abort();
  }, [missing]);
  const summary = useMemo(() => (job ? digest(job, rows) : null), [job, rows]);
  const adherence = useMemo(() => (job && jobArea ? areaAdherence(job, jobArea, jobArea.siteIds) : null), [job, jobArea]);
  const focusRows = useMemo(() => (tower && rows.length ? evidenceNear(rows, tower) : null), [tower, rows]);

  async function onEvidence(row: EvidenceRow) {
    if (row.lat === null || row.lng === null) return;
    try { await highlightEvidence(store, row.key, `${row.siteId ?? row.label} · ${row.tool}`, row.lat, row.lng, row.siteId); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not highlight this evidence."); }
  }

  const warnings = [...new Set([...(agents?.warnings ?? []), ...(selectedAgent?.warnings ?? [])])];

  return (
    <section aria-label="Hermes multi-agent investigations" className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-1 font-sans text-foreground [&>*]:shrink-0">
      <header className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-sky-500 text-white shadow-md shadow-violet-500/25"><Bot className="size-4.5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-tight">Hermes agents</h2>
          <p className="text-[11px] text-muted-foreground">{checking ? "Checking local Hermes…" : agents?.ready ? "Local Hermes ready" : `${agents?.agents.filter((a) => a.available).length ?? 0} of 5 agents available`}</p>
        </div>
        <button type="button" aria-label="Refresh Hermes readiness" onClick={() => void checkAgents()} disabled={checking || active} className="rounded p-1 hover:bg-accent disabled:opacity-50"><RefreshCw className={`size-3.5 ${checking ? "animate-spin" : ""}`} /></button>
      </header>

      {fixture ? (
        <p role="note" className="rounded-xl border border-amber/30 bg-amber/10 p-2.5 text-[12px] leading-relaxed">
          <span className="font-medium">Fixture mode.</span> A scripted timeline for UI development: no Hermes agent, model or tool runs, and none of it is
          evidence. Remove <code className="font-mono">?hermes=fixture</code> from the address to use the live service.
        </p>
      ) : null}

      <AgentRoster agents={agents} checking={checking} active={job && isHermesJobActive(job) ? job : null} />

      <AreaContextCard area={area} insights={areaInsights} loading={loadingArea} source={areaSource} hasShape={Boolean(shapeArea)} hasTower={Boolean(towerArea)}
                       onSource={(s) => useHermesSelection.setState({ areaSource: s })}
                       onClear={() => { useHermesSelection.setState({ areaCleared: key }); clearHighlight(store); }} />

      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs leading-relaxed">
        <div className="flex items-center gap-1.5"><p className="font-medium">Telco Opportunity Graph</p><Kind kind="graph" /></div>
        <p className="mt-1 text-muted-foreground">Ranks where TM should act in about 3 seconds from synthetic network, event, footfall and SME data. The Hypothesis agent then has the Engineer validate network feasibility.</p>
        <Button type="button" onClick={() => void discoverOpportunities()} disabled={checking || active || discovering || !agents?.agents.find((a) => a.agent_id === "hypothesis")?.available} className="mt-2 w-full">
          {discovering ? <LoaderCircle className="animate-spin" /> : <Sparkles />}Discover opportunities
        </Button>
        {lastRun ? <Button type="button" size="sm" variant="ghost" onClick={() => void showLastRun()} disabled={discovering || active} className="mt-1 w-full">
          Show last validated run ({lastRun.slice(0, 8)})
        </Button> : null}
        <Button type="button" size="sm" variant="outline" onClick={() => setTimeMachineOpen((open) => !open)} className="mt-1 w-full">
          {timeMachineOpen ? "Close" : "Open"} Decision Time Machine
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setCommercialOpen((open) => !open)} className="mt-1 w-full">
          {commercialOpen ? "Close" : "Open"} commercial applications
        </Button>
      </div>
      {commercialOpen ? <CommercialApplications store={store} disabled={checking || active || !agents?.agents.find((a) => a.agent_id === "hypothesis")?.available}
        onExplain={explainScenario} /> : null}
      {timeMachineOpen ? <DecisionTimeMachine store={store} disabled={checking || active || !agents?.agents.find((a) => a.agent_id === "hypothesis")?.available}
        verdicts={validation?.state === "validated" ? Object.fromEntries(validation.verdicts.map((v) => [v.opportunity_id, v.label])) : undefined}
        onExplain={explainScenario} /> : null}
      {discovery && validation ? <OpportunityCards discovery={discovery} validation={validation} /> : null}

      <form onSubmit={submitInvestigation} className="flex flex-col gap-2.5 rounded-lg border bg-card/40 p-3">
        <p className="text-[12px] font-semibold">Ask an agent</p>
        <div role="radiogroup" aria-label="Hermes agent" className="grid grid-cols-5 gap-1">
          {HERMES_AGENTS.map((id) => {
            const meta = AGENT_META[id];
            const Icon = meta.icon;
            const available = agents?.agents.find((a) => a.agent_id === id)?.available;
            return (
              <button key={id} type="button" role="radio" aria-checked={agentId === id} disabled={active} onClick={() => useHermesSelection.setState({ agentId: id })}
                      title={available ? meta.role : `${meta.label} is unavailable`}
                      className={cn("flex flex-col items-center gap-0.5 rounded-md border px-1 py-1.5 text-[10px] font-medium transition-all",
                                    agentId === id ? "border-violet-500 bg-violet-500/10 shadow-sm" : "hover:bg-accent", !available && "opacity-50")}>
                <Icon className="size-3.5" />{meta.label}
              </button>
            );
          })}
        </div>
        <textarea aria-label="Hermes investigation" value={prompt} onChange={(event) => useHermesSelection.setState({ prompt: event.target.value })} maxLength={3_200} rows={3} disabled={active} className="resize-y rounded-md border bg-background p-2 text-xs leading-relaxed" />
        {area ? (
          <label className={cn("flex items-start gap-2 rounded-md border px-2 py-1.5 text-[11px] leading-relaxed", scopedAgent ? "border-sky-500/40 bg-sky-500/5" : "opacity-70")}>
            <input type="checkbox" className="mt-0.5" checked={attachArea && scopedAgent} disabled={!scopedAgent || active} onChange={(e) => useHermesSelection.setState({ attachArea: e.target.checked })} />
            <span>{scopedAgent
              ? <>Attach the selected area: <span className="font-medium">{area.label}</span>{areaSiteIds.length ? ` (${areaSiteIds.length} NetOps sites)` : ""}. After the run, the recorded tool calls show whether the agents stayed inside it.</>
              : <>{AGENT_META[agentId].label} cannot be limited to a map area, so the area is not attached.</>}</span>
          </label>
        ) : null}
        <Button type="submit" disabled={checking || active || !selectedAgent?.available || !prompt.trim()} className="w-full">{active ? <LoaderCircle className="animate-spin" /> : <Bot />}{active ? "Agents investigating…" : `Start ${AGENT_META[agentId].label} investigation`}</Button>
        {recent.length ? (
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><History className="size-3.5" />
            <select aria-label="Saved investigations" value="" onChange={(e) => void openRecent(e.target.value)} disabled={active} className="h-7 min-w-0 flex-1 rounded-md border bg-background px-1.5 text-[11px]">
              <option value="">Saved investigations ({recent.length})…</option>
              {recent.map((r) => <option key={r.id} value={r.id}>{AGENT_META[r.agent]?.label} · {new Date(r.at).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "short", timeStyle: "short" })} · {r.label}</option>)}
            </select>
          </label>
        ) : null}
      </form>

      {error ? <p role="alert" className="animate-in fade-in rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{error}</p> : null}

      {job && summary ? (
        <div className="space-y-2.5 rounded-lg border p-3" aria-live="polite">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold">{AGENT_META[job.agent_id].label} investigation · <span className={cn(job.status === "completed" ? "text-green-600 dark:text-green-400" : job.status === "failed" ? "text-destructive" : job.status === "partial" ? "text-amber-600" : "text-violet-600")}>{job.status}</span></p>
              <p className="truncate text-[11px] text-muted-foreground" title={promptWithoutArea(job.prompt)}>{promptWithoutArea(job.prompt)}</p>
              <p className="font-mono text-[10px] text-muted-foreground">{job.investigation_id} · updated {new Date(job.updated_at).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })} MYT</p>
            </div>
            {job.status === "completed" || job.status === "partial" ? <Kind kind={job.agent_id === "hypothesis" && validatedId === job.investigation_id ? "validated" : "agent"} /> : null}
          </div>
          <InvestigationStoryboard job={job} rows={rows} store={store} panelWidth={panelWidth} />
          <ProgressTimeline job={job} />
          {job.error ? <p role="alert" className="text-[11px] text-destructive">{job.error}</p> : null}
          <InvestigationResults job={job} digest={summary} rows={rows} adherence={adherence} areaLabel={jobArea?.label ?? null}
                                focusRows={focusRows} focusName={tower?.name ?? null} highlighted={highlighted}
                                onEvidence={(row) => void onEvidence(row)} onShowMap={() => void showFindings()} mapping={mapping} />
          {mappedId === job.investigation_id ? <p role="status" className="text-[11px] text-muted-foreground">Investigation evidence added to the map.</p> : null}
        </div>
      ) : null}

      {warnings.map((warning) => <p key={warning} className="rounded-md bg-amber-500/10 p-2 text-xs leading-relaxed text-amber-800 dark:text-amber-300">{warning}</p>)}
      <Button type="button" size="sm" variant="ghost" onClick={() => uiStateActions?.toggleSidePanel("layer")}><Layers />Map layers</Button>
    </section>
  );
}
