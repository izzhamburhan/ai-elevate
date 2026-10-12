"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle, BrainCircuit, Briefcase, ChevronDown, CloudRain, Crosshair, FileText, Gauge, Lightbulb, ListTree,
  LoaderCircle, MapPin, Network, Radio, ShieldCheck, Sparkles, Store, TrendingUp, Wrench,
} from "lucide-react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { HermesAgentId, HermesAgents, HermesJob } from "@/lib/hermes/contracts";
import type { AreaInsights } from "@/lib/hermes/area-insights";
import { plain, type Adherence, type EvidenceRow, type JobDigest, type MapArea } from "@/lib/hermes/workspace";
import { cn } from "@/lib/utils";

/** Order 5.5 building blocks of the Agents tab. Every value shown comes from a tool result or the Hermes ledger. */

export const AGENT_META: Record<HermesAgentId, { label: string; role: string; icon: typeof Network; tint: string; area: string }> = {
  orchestrator: { label: "Orchestrator", role: "Plans the investigation and delegates to the specialists.", icon: ListTree,
                  tint: "text-violet-500 bg-violet-500/10", area: "Passes the selected area to the specialists it delegates to." },
  forecast: { label: "Forecast", role: "Weather replay and forecasts for sites (Weather ML).", icon: CloudRain,
              tint: "text-sky-500 bg-sky-500/10", area: "Can be limited to the area's sites or centre." },
  engineer: { label: "Engineer", role: "NetOps KPIs, tickets, congestion and maintenance for sites.", icon: Wrench,
              tint: "text-emerald-500 bg-emerald-500/10", area: "Can be limited to the area's Site_IDs or a radius." },
  business: { label: "Business", role: "Locations, admin areas and site geography for business questions.", icon: Briefcase,
              tint: "text-amber-500 bg-amber-500/10", area: "Can be limited to the area's sites." },
  hypothesis: { label: "Hypothesis", role: "Forms hypotheses from the Opportunity Graph; the Engineer validates feasibility.", icon: Lightbulb,
                tint: "text-fuchsia-500 bg-fuchsia-500/10", area: "Reads the national graph; it cannot be limited to a map area." },
};

/** Provenance chips: what kind of result a block is, so judges never confuse them. */
export function Kind({ kind }: { kind: "synthetic" | "predicted" | "graph" | "validated" | "agent" | "weather" }) {
  const style = {
    synthetic: "border-slate-400/40 text-slate-600 dark:text-slate-300",
    predicted: "border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    graph: "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300",
    validated: "border-green-500/50 bg-green-500/10 text-green-800 dark:text-green-300",
    agent: "border-violet-500/50 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    weather: "border-cyan-500/50 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  }[kind];
  const text = { synthetic: "Synthetic", predicted: "ML predicted", graph: "Graph-ranked", validated: "Agent-validated", agent: "Hermes finding", weather: "Synthetic weather" }[kind];
  return <span className={cn("inline-flex h-4.5 shrink-0 items-center rounded-full border px-1.5 text-[10px] font-semibold uppercase tracking-wide", style)}>{text}</span>;
}

// ---------------------------------------------------------------- agents

export function AgentRoster({ agents, checking, active }: { agents: HermesAgents | null; checking: boolean; active: HermesJob | null }) {
  const busy = new Map((active?.tasks ?? []).filter((t) => t.status === "running" || t.status === "queued").map((t) => [t.agent_id, t.active_tool ?? "thinking"]));
  return (
    <div className="space-y-1.5" aria-label="Hermes agents">
      {(Object.keys(AGENT_META) as HermesAgentId[]).map((id) => {
        const meta = AGENT_META[id];
        const live = agents?.agents.find((a) => a.agent_id === id);
        const working = busy.get(id);
        const Icon = meta.icon;
        return (
          <Collapsible key={id} className="group/agent rounded-lg border bg-card/50 transition-colors data-[state=open]:bg-card">
            <CollapsibleTrigger className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left">
              <span className={cn("grid size-7 shrink-0 place-items-center rounded-md", meta.tint)}><Icon className="size-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[13px] font-semibold">{meta.label}
                  {working ? <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-1.5 text-[10px] font-medium text-violet-600 dark:text-violet-300"><LoaderCircle className="size-3 animate-spin" />{working}</span> : null}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">{meta.role}</span>
              </span>
              <span className={cn("size-2 shrink-0 rounded-full", checking ? "animate-pulse bg-muted-foreground" : live?.available ? "bg-green-500 shadow-[0_0_8px] shadow-green-500/60" : "bg-red-500/70")}
                    title={checking ? "Checking" : live?.available ? "Available" : "Unavailable"} />
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/agent:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
              <div className="space-y-1.5 border-t px-2.5 py-2 text-[11px] leading-relaxed">
                <p><span className="font-medium">Map area:</span> {meta.area}</p>
                <p className="break-words text-muted-foreground"><span className="font-medium text-foreground">Tools:</span> {live?.capabilities.join(", ") || "—"}</p>
                {typeof live?.session_count === "number" ? <p className="text-muted-foreground">Saved sessions: {String(live.session_count)} · persistent memory in its Hermes profile</p> : null}
                {(live?.warnings ?? []).map((w) => <p key={w} className="text-amber-700 dark:text-amber-300">{w}</p>)}
                {!live && !checking ? <p className="text-destructive">Hermes did not report this agent.</p> : null}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- selected area

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "bad" | "warn" | "good" }) {
  return (
    <div className="min-w-0 rounded-md border bg-background/60 px-2 py-1.5">
      <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("text-sm font-semibold tabular-nums", tone === "bad" && "text-red-500", tone === "warn" && "text-amber-500", tone === "good" && "text-green-600 dark:text-green-400")}>{value}</p>
      {sub ? <p className="truncate text-[10px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function Failed({ what, error }: { what: string; error: string }) {
  return <p className="rounded-md border border-dashed px-2 py-1.5 text-[11px] text-muted-foreground"><AlertTriangle className="mr-1 inline size-3 text-amber-500" />{what} unavailable: {error}</p>;
}

export function AreaContextCard({ area, insights, loading, onClear, source, onSource, hasShape, hasTower }: {
  area: MapArea | null; insights: AreaInsights | null; loading: boolean; onClear: () => void;
  source: "shape" | "tower"; onSource: (s: "shape" | "tower") => void; hasShape: boolean; hasTower: boolean;
}) {
  if (!area) {
    return (
      <div className="rounded-lg border border-dashed p-3 text-[11px] leading-relaxed text-muted-foreground">
        <p className="flex items-center gap-1.5 font-medium text-foreground"><Crosshair className="size-3.5 text-sky-500" />No map area selected</p>
        <p className="mt-1">Draw a polygon, rectangle or circle on the map, or click a tower. The area&apos;s network, weather, commercial and predicted data appear here, and you can hand the area to an agent.</p>
      </div>
    );
  }
  const s = insights;
  return (
    <div className="animate-in fade-in slide-in-from-top-1 space-y-2 rounded-lg border border-sky-500/40 bg-sky-500/5 p-3 duration-300" aria-label="Selected map area">
      <div className="flex items-start gap-2">
        <MapPin className="mt-0.5 size-4 shrink-0 text-sky-500" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{area.label}</p>
          <p className="text-[11px] text-muted-foreground">{area.kind} · centre {area.center.lat.toFixed(4)}, {area.center.lng.toFixed(4)} · within {area.radiusKm} km of the centre</p>
        </div>
        <button type="button" onClick={onClear} className="rounded px-1.5 text-[11px] text-muted-foreground hover:bg-accent">Clear</button>
      </div>
      {hasShape && hasTower ? (
        <div role="tablist" className="grid grid-cols-2 gap-1 rounded-md bg-muted/60 p-0.5 text-[11px]">
          {(["shape", "tower"] as const).map((k) => (
            <button key={k} role="tab" aria-selected={source === k} type="button" onClick={() => onSource(k)}
                    className={cn("rounded px-2 py-1 font-medium transition-colors", source === k ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {k === "shape" ? "Drawn shape" : "Clicked tower"}
            </button>
          ))}
        </div>
      ) : null}
      {loading && !s ? (
        <div className="grid grid-cols-3 gap-1.5">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />)}</div>
      ) : s ? (
        <>
          <div className="flex items-center gap-1.5 pt-1"><Network className="size-3.5 text-emerald-500" /><p className="text-[11px] font-semibold">Network</p><Kind kind="synthetic" /></div>
          {s.sites.ok && s.network.ok ? (
            <div className="grid grid-cols-3 gap-1.5">
              <Stat label="NetOps sites" value={String(s.sites.value.sites.length)} sub="inside the area" />
              <Stat label="Congested" value={String(s.network.value.total)} sub="cells ≥85% PRB, 7 d" tone={s.network.value.total ? "warn" : "good"} />
              <Stat label="Critical" value={String(s.network.value.cells.filter((c) => c.severity === "CRITICAL").length)} sub="cells" tone={s.network.value.cells.some((c) => c.severity === "CRITICAL") ? "bad" : "good"} />
            </div>
          ) : <Failed what="Network data" error={!s.sites.ok ? s.sites.error : !s.network.ok ? s.network.error : ""} />}
          <div className="flex items-center gap-1.5 pt-1"><CloudRain className="size-3.5 text-cyan-500" /><p className="text-[11px] font-semibold">Weather</p><Kind kind="weather" /></div>
          {s.weather.ok ? (
            <p className="text-[11px]">{s.weather.value.station} ({s.weather.value.distanceKm} km): <span className="font-semibold">{s.weather.value.rain24h} mm</span> in 24 h, {s.weather.value.intensity.toLowerCase().replace("_", " ")}.</p>
          ) : <Failed what="Weather" error={s.weather.error} />}
          <div className="flex items-center gap-1.5 pt-1"><Store className="size-3.5 text-amber-500" /><p className="text-[11px] font-semibold">Commercial demand</p><Kind kind="predicted" /></div>
          {s.demand.ok ? (
            <div className="rounded-md border bg-background/60 p-2 text-[11px] leading-relaxed">
              <p className="font-medium">{s.demand.value.signal.name} <span className="font-normal text-muted-foreground">({s.demand.value.inside ? "inside the area" : `nearest commercial area, ${s.demand.value.distanceKm} km away`})</span></p>
              <p className="mt-0.5"><span className="font-semibold">{s.demand.value.signal.signal.replaceAll("_", " ")}</span> · priority {s.demand.value.signal.investigation_priority.toFixed(2)} · {s.demand.value.signal.window.day_myt}</p>
              <p className="text-muted-foreground">footfall ~{s.demand.value.signal.indicators.footfall_p50.toLocaleString("en-MY")}{s.demand.value.signal.indicators.event_attendance_in_reach ? ` · ${s.demand.value.signal.indicators.event_attendance_in_reach.toLocaleString("en-MY")} event attendees in reach` : ""}</p>
            </div>
          ) : <Failed what="Demand signals" error={s.demand.error} />}
          <div className="flex items-center gap-1.5 pt-1"><TrendingUp className="size-3.5 text-sky-500" /><p className="text-[11px] font-semibold">Predicted risk</p><Kind kind="predicted" /></div>
          <div className="grid grid-cols-2 gap-1.5">
            {s.sites.ok ? (
              <Stat label="Outage risk, 24 h" value={s.sites.value.sites[0] ? `${s.sites.value.sites[0].site_id} ${s.sites.value.sites[0].risk_level.toLowerCase()}` : "no sites"}
                    sub={`${s.sites.value.sites.filter((x) => x.risk_level !== "LOW").length} of ${s.sites.value.sites.length} sites medium/high`}
                    tone={s.sites.value.sites[0]?.risk_level === "HIGH" ? "bad" : s.sites.value.sites[0]?.risk_level === "MEDIUM" ? "warn" : "good"} />
            ) : <Failed what="Outage risk" error={s.sites.error} />}
            {s.forecast.ok ? (
              <Stat label="Congestion forecast" value={s.forecast.value.worst ? `${s.forecast.value.worst.peak}% peak` : "—"}
                    sub={`${s.forecast.value.hot} of ${s.forecast.value.cells} cells high · weekend`} tone={s.forecast.value.hot ? "warn" : "good"} />
            ) : <Failed what="Congestion forecast" error={s.forecast.error} />}
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground">Predictions come from local models (Order 5) on synthetic data. They are separate from agent findings and are not validated by Hermes.</p>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- results

const RISK_STYLE = { high: "text-red-500", medium: "text-amber-500", low: "text-green-600 dark:text-green-400", unknown: "text-muted-foreground" };
const ADHERENCE_STYLE: Record<Adherence["verdict"], string> = {
  respected: "border-green-500/40 bg-green-500/10 text-green-800 dark:text-green-300",
  "partly respected": "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  "not area-scoped": "border-destructive/40 bg-destructive/10 text-destructive",
  "no tool calls": "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
};
const myt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "medium", timeStyle: "short" }) : "—");

export function AdherenceBanner({ adherence, areaLabel, pending }: { adherence: Adherence | null; areaLabel: string | null; pending?: boolean }) {
  if (!areaLabel) return <p className="rounded-md border px-2 py-1.5 text-[11px] text-muted-foreground">No map area was attached to this investigation.</p>;
  if (pending) return <p className="rounded-md border border-sky-500/40 bg-sky-500/5 px-2 py-1.5 text-[11px]"><ShieldCheck className="mr-1 inline size-3.5 text-sky-500" />Area scope for “{areaLabel}” is checked against the recorded tool calls when the run finishes.</p>;
  if (!adherence) return null;
  const text = {
    respected: `Every successful tool call stayed inside “${areaLabel}”.`,
    "partly respected": `${adherence.inArea} of ${adherence.calls.length} tool calls stayed strictly inside “${areaLabel}”.${adherence.beyond ? ` ${adherence.beyond} radius search(es) were centred inside but reached beyond the area.` : ""}${adherence.outside ? ` ${adherence.outside} queried outside it.` : ""}${adherence.unscoped ? ` ${adherence.unscoped} used no location (wider network).` : ""} Findings are not strictly limited to the area.`,
    "not area-scoped": `The agents' tool calls did not filter by “${areaLabel}”. Do not read the findings as an analysis of this area.`,
    "no tool calls": `No successful tool calls were recorded, so nothing about “${areaLabel}” was analysed.`,
  }[adherence.verdict];
  return (
    <div className={cn("rounded-md border px-2 py-1.5 text-[11px] leading-relaxed", ADHERENCE_STYLE[adherence.verdict])} role="status">
      <p className="flex items-center gap-1 font-semibold"><ShieldCheck className="size-3.5" />Area scope: {adherence.verdict}</p>
      <p>{text}</p>
    </div>
  );
}

type Tab = "summary" | "evidence" | "report";

export function InvestigationResults({ job, digest, rows, adherence, areaLabel, focusRows, focusName, highlighted, onEvidence, onShowMap, mapping }: {
  job: HermesJob; digest: JobDigest; rows: EvidenceRow[]; adherence: Adherence | null; areaLabel: string | null;
  focusRows: EvidenceRow[] | null; focusName: string | null; highlighted: string | null;
  onEvidence: (row: EvidenceRow) => void; onShowMap: () => void; mapping: boolean;
}) {
  const [tab, setTab] = useState<Tab>("summary");
  const [onlyFocus, setOnlyFocus] = useState(true);
  const shown = focusRows?.length && onlyFocus ? focusRows : rows; // an empty filter would hide every row
  const tabs: { id: Tab; label: string; icon: typeof FileText }[] = [
    { id: "summary", label: "Summary", icon: Sparkles }, { id: "evidence", label: `Evidence (${rows.length})`, icon: Gauge }, { id: "report", label: "Report", icon: FileText },
  ];
  const finished = job.status !== "queued" && job.status !== "running";
  const sources = useMemo(() => [...new Map(rows.map((r) => [`${r.service}:${r.tool}`, r])).values()], [rows]);
  return (
    <div className="animate-in fade-in space-y-2 duration-300" aria-label="Investigation results">
      <div role="tablist" className="grid grid-cols-3 gap-1 rounded-lg bg-muted/60 p-0.5">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={cn("flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-all", tab === id ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            <Icon className="size-3.5" />{label}
          </button>
        ))}
      </div>

      {focusRows ? (
        <div className="animate-in fade-in slide-in-from-top-1 rounded-md border border-cyan-500/40 bg-cyan-500/5 px-2 py-1.5 text-[11px]" role="status">
          <p className="font-semibold"><Radio className="mr-1 inline size-3.5 text-cyan-500" />{focusName}: {focusRows.length ? `${focusRows.length} evidence row(s) from this run within 1.5 km` : "no evidence from this run near this tower"}</p>
          {focusRows.length ? <button type="button" className="mt-0.5 underline" onClick={() => { setTab("evidence"); setOnlyFocus(true); }}>Show them in Evidence</button> : null}
        </div>
      ) : null}

      {tab === "summary" ? (
        <div className="space-y-2">
          <AdherenceBanner adherence={adherence} areaLabel={areaLabel} pending={!finished} />
          <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center gap-1.5"><BrainCircuit className="size-4 text-violet-500" /><p className="text-[12px] font-semibold">Executive summary</p>{job.status === "completed" || job.status === "partial" ? <Kind kind="agent" /> : null}</div>
            <p className="mt-1.5 text-[12px] leading-relaxed">{digest.headline}</p>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <Stat label="Risk" value={digest.risk} sub={digest.riskBasis} tone={digest.risk === "high" ? "bad" : digest.risk === "medium" ? "warn" : digest.risk === "low" ? "good" : undefined} />
            <Stat label="MCP calls" value={`${digest.okCalls} ok`} sub={digest.failedCalls ? `${digest.failedCalls} failed` : "none failed"} tone={digest.failedCalls || !digest.okCalls ? "warn" : "good"} />
            <Stat label="Sites in evidence" value={String(digest.sites.length)} sub={digest.sites.slice(0, 3).join(", ") || "—"} />
          </div>
          <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-2.5 text-[12px] leading-relaxed">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300">Recommendation (agent wording)</p>
            <p className="mt-0.5">{digest.recommendation ?? (finished ? "The agents gave no explicit recommendation; see the Report." : "Waiting for the agents…")}</p>
          </div>
          <p className={cn("text-[11px]", RISK_STYLE[digest.risk])}>Risk is derived from recorded verdicts or mapped severities, never from prose.</p>
          {job.geojson?.features.length ? (
            <button type="button" onClick={onShowMap} disabled={mapping} className="flex w-full items-center justify-center gap-1.5 rounded-md border py-1.5 text-[12px] font-medium hover:bg-accent disabled:opacity-50">
              {mapping ? <LoaderCircle className="size-3.5 animate-spin" /> : <MapPin className="size-3.5" />}Show findings on map ({job.geojson.features.length})
            </button>
          ) : null}
        </div>
      ) : null}

      {tab === "evidence" ? (
        <div className="space-y-1.5">
          {focusRows?.length ? (
            <label className="flex items-center gap-1.5 text-[11px]"><input type="checkbox" checked={onlyFocus} onChange={(e) => setOnlyFocus(e.target.checked)} />Only rows near {focusName}</label>
          ) : null}
          {shown.length ? (
            <div className="max-h-[22rem] overflow-auto rounded-lg border">
              <table className="w-full border-collapse text-[11px]">
                <thead className="sticky top-0 z-10 bg-muted/95 text-left backdrop-blur">
                  <tr>{["Site / item", "Metrics", "MCP source · time"].map((h) => <th key={h} className="px-2 py-1.5 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.key} onClick={() => onEvidence(r)} title={r.lat !== null ? "Highlight on the map" : "No location recorded for this row"}
                        className={cn("border-t align-top transition-colors", r.lat !== null ? "cursor-pointer hover:bg-cyan-500/10" : "opacity-80",
                                      highlighted === r.key && "bg-cyan-500/15")}>
                      <td className={cn("px-2 py-1.5 font-medium", r.siteId ? "whitespace-nowrap font-mono" : "break-words")}>{r.siteId ?? r.label}{r.lat !== null ? <MapPin className="ml-1 inline size-3 text-cyan-500" /> : null}</td>
                      <td className="px-2 py-1.5">{r.metrics.length ? r.metrics.map((m) => <span key={m.name} className="block whitespace-nowrap"><span className="text-muted-foreground">{m.name}</span> {String(m.value)}</span>) : <span className="text-muted-foreground">{r.label}</span>}</td>
                      <td className="px-2 py-1.5"><span className="font-mono">{r.tool}</span><span className="block text-muted-foreground">{r.service} · {r.agent}{r.synthetic ? " · synthetic" : ""}</span><span className="block whitespace-nowrap text-muted-foreground">{/^\d{4}-\d{2}-\d{2}$/.test(r.at ?? "") ? r.at : myt(r.at)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="rounded-md border border-dashed p-2 text-[11px] text-muted-foreground">{finished ? "No per-site records were returned by successful MCP calls." : "Evidence appears as the agents' MCP calls complete."}</p>}
          <p className="text-[10px] text-muted-foreground">Rows come only from successful, recorded MCP calls (Hermes ledger). Click a row with a pin to highlight it on the map.</p>
        </div>
      ) : null}

      {tab === "report" ? (
        <div className="space-y-2 text-[12px] leading-relaxed">
          <section className="rounded-lg border p-2.5">
            <p className="font-semibold">Findings</p>
            {job.tasks.filter((t) => t.summary).map((t) => (
              <div key={t.task_id} className="mt-1.5">
                <p className="text-[11px] font-semibold text-muted-foreground">{AGENT_META[t.agent_id].label} · {t.status}</p>
                <p className="whitespace-pre-wrap">{plain(t.summary ?? "")}</p>
              </div>
            ))}
            {!job.tasks.some((t) => t.summary) ? <p className="text-muted-foreground">{job.summary ?? "No findings yet."}</p> : null}
          </section>
          <section className="rounded-lg border p-2.5">
            <p className="font-semibold">Methodology</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px]">
              <li>Agents: {digest.agents.map((a) => AGENT_META[a as HermesAgentId]?.label ?? a).join(", ")} (local Hermes profiles, persistent memory).</li>
              <li>Tools that returned data: {digest.tools.join(", ") || "none"}.</li>
              <li>Sources: {sources.map((s) => `${s.service}/${s.tool}${s.synthetic ? " (synthetic)" : ""}`).join("; ") || "none"}.</li>
              <li>Area: {areaLabel ? `${areaLabel}; scope ${adherence?.verdict ?? "—"} (${adherence?.inArea ?? 0} strictly inside, ${adherence?.beyond ?? 0} reaching beyond, ${adherence?.outside ?? 0} outside, ${adherence?.unscoped ?? 0} unscoped calls).` : "none attached."}</li>
              <li>Investigation {job.investigation_id} · started {myt(job.created_at)} · updated {myt(job.updated_at)} MYT.</li>
            </ul>
          </section>
          <section className="rounded-lg border p-2.5">
            <p className="font-semibold">Limitations</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-amber-800 dark:text-amber-300">
              {[...new Set([...(job.warnings ?? []), ...job.tasks.flatMap((t) => t.warnings ?? [])])].map((w) => <li key={w}>{w}</li>)}
              <li>All telecom, commercial and demand data is synthetic. Agent prose can be imprecise; the tool results above are authoritative.</li>
            </ul>
          </section>
          <section className="rounded-lg border p-2.5">
            <p className="font-semibold">Next actions</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px]">
              {digest.recommendation ? <li>{digest.recommendation}</li> : null}
              {adherence && adherence.verdict !== "respected" && areaLabel ? <li>Re-run with the Engineer and ask it to query only the area&apos;s Site_IDs, so the findings cover “{areaLabel}”.</li> : null}
              {digest.failedCalls ? <li>Retry the {digest.failedCalls} failed MCP call(s) once their services are up.</li> : null}
              <li>Compare with the ML predictions for the area (above) before acting; they are not validated by the agents.</li>
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export function ProgressTimeline({ job }: { job: HermesJob }) {
  const active = job.status === "queued" || job.status === "running";
  return (
    <ol className="space-y-1" aria-label="Investigation progress">
      {[{ id: "root", label: `${AGENT_META[job.agent_id].label} received the request`, status: "completed" as string, detail: "" },
        ...job.tasks.map((t) => ({ id: t.task_id, label: `${AGENT_META[t.agent_id].label}`, status: t.status,
                                   detail: t.status === "running" ? `using ${t.active_tool ?? "the model"}` : `${(t.tool_calls ?? []).filter((c) => c.ok === true).length} successful MCP call(s)` }))]
        .map((step) => (
          <li key={step.id} className="flex items-center gap-2 text-[11px]">
            <span className={cn("grid size-4 place-items-center rounded-full", step.status === "completed" ? "bg-green-500/20 text-green-600" : step.status === "running" || step.status === "queued" ? "bg-violet-500/20 text-violet-600" : step.status === "partial" ? "bg-amber-500/20 text-amber-600" : "bg-red-500/20 text-red-600")}>
              {step.status === "running" || step.status === "queued" ? <LoaderCircle className="size-3 animate-spin" /> : <span className="size-1.5 rounded-full bg-current" />}
            </span>
            <span className="font-medium">{step.label}</span>
            <span className="truncate text-muted-foreground">{step.status}{step.detail ? ` · ${step.detail}` : ""}</span>
          </li>
        ))}
      {active ? <li className="pl-6 text-[10px] text-muted-foreground">Local model runs take a few minutes; you can keep using the map.</li> : null}
    </ol>
  );
}
