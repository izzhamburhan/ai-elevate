"use client";

import { useEffect, useState } from "react";
import { Briefcase, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  COMMERCIAL_APPS, explainCommercialPrompt, formatRm, offerable, parseCommercial,
  type AbsenceResult, type CommercialAppId, type CommercialResult, type EventResult, type LeakResult,
} from "@/lib/commercial/contracts";
import { focusCommercial } from "@/lib/commercial/map-overlay";
import type { makeKeplerStore } from "../kepler-store";

const STATUS_STYLE = {
  feasible: "bg-green-500/15 text-green-700 dark:text-green-300",
  conditional: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  infeasible: "bg-destructive/15 text-destructive",
} as const;
const CLASS_STYLE = {
  verified_gap: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  capacity_constraint: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  insufficient_information: "bg-muted text-muted-foreground",
} as const;

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-md border bg-background/60 p-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
      {note ? <p className="text-[10px] text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function Leaks({ result }: { result: LeakResult }) {
  const [top, ...rest] = result.data.results;
  if (!top) return <p>No repeat-fault areas in the window.</p>;
  return (
    <>
      <div className="grid grid-cols-2 gap-1.5">
        <Kpi label="Repeat field visits, 60 days" value={formatRm(top.avoidable_opex_rm.mid)} note={`${top.evidence.avoidable_field_visits} visits · ${formatRm(top.avoidable_opex_rm.low)}–${formatRm(top.avoidable_opex_rm.high)}`} />
        <Kpi label="One-off preventive fix" value={formatRm(top.preventive_fix_cost_rm.mid)} note={top.fix_payback_days_mid ? `payback ~${top.fix_payback_days_mid} days if the pattern continues` : undefined} />
        <Kpi label="Run-rate if unchanged" value={`${formatRm(top.annualised_avoidable_opex_mid_rm)} / yr`} note="extrapolated, mid assumption" />
        <Kpi label="Revenue exposure, 12 months" value={formatRm(top.revenue_exposure_rm.mid)} note={`${top.evidence.network_complaints_60d_unique} network complaints · not lost revenue`} />
      </div>
      <p className="font-medium">Evidence · {top.area}</p>
      <ul className="list-disc pl-4">
        {top.affected_sites.map((s) => <li key={s.site_id}>{s.site_id}: {s.outages_60d} outages, {s.repeat_equipment_alarms_60d} repeat equipment alarms → {s.avoidable_visits} avoidable visits</li>)}
        {top.evidence.underused_sites_prb_p95_below_35pct.length ? <li>{top.evidence.underused_sites_prb_p95_below_35pct.length} underused site(s) in the area (busy-hour PRB below 35%, no RM value).</li> : null}
      </ul>
      {rest.length ? <p className="text-muted-foreground">Also flagged: {rest.map((r) => `${r.cluster} (${formatRm(r.total_exposure_mid_rm as number)})`).join(", ")}.</p> : null}
      <p className="font-medium">Proposed next business action</p>
      <p>{top.next_action}{top.mitigation[1] ? ` ${top.mitigation[1]}` : ""}</p>
    </>
  );
}

function Absence({ result }: { result: AbsenceResult }) {
  return (
    <>
      {result.data.results.map((r) => (
        <div key={r.area_id as string} className="space-y-1 rounded-md border p-2">
          <p className="flex flex-wrap items-center gap-1.5 font-semibold">{r.area}<span className={`rounded px-1 text-[10px] ${CLASS_STYLE[r.classification]}`}>{r.classification_label}</span></p>
          <p>{r.technical_constraint}</p>
          <p className="text-muted-foreground">{r.why_it_matters.join(" ")}</p>
          <p><span className="font-medium">Next action:</span> {r.recommended_action}</p>
          <p><span className="font-medium">Indicative opportunity:</span> {formatRm(r.indicative_opportunity_rm_month.low)}–{formatRm(r.indicative_opportunity_rm_month.high)} / month <span className="text-muted-foreground">({r.indicative_opportunity_rm_month.condition}; {r.indicative_opportunity_rm_month.basis})</span></p>
        </div>
      ))}
      <p className="text-muted-foreground">{result.data.predictive_service.note}</p>
    </>
  );
}

function EventPackages({ result }: { result: EventResult }) {
  const { event, readiness, packages } = result.data;
  return (
    <>
      <div className="grid grid-cols-2 gap-1.5">
        <Kpi label="Event" value={event.name} note={`${event.start_myt} MYT · ${event.attendance.toLocaleString("en-MY")} expected (synthetic)`} />
        <Kpi label="Peak demand vs headroom" value={`${readiness.attendee_peak_demand_mbps.toLocaleString("en-MY")} / ${readiness.headroom_mbps.toLocaleString("en-MY")} Mbps`} note={`${readiness.nearby_sites} sites within 2 km · ${readiness.demand_covered_pct ?? 0}% covered`} />
      </div>
      <div className="space-y-1.5">
        {packages.map((p) => (
          <div key={p.package_id} className="rounded-md border p-2">
            <p className="flex flex-wrap items-center gap-1.5 font-semibold">{p.name}<span className={`rounded px-1 text-[10px] ${STATUS_STYLE[p.status]}`}>{p.status}</span></p>
            <p className="text-muted-foreground">{p.description}</p>
            <p>Cost {formatRm(p.cost_rm)} · indicative price {formatRm(p.indicative_price_rm)}{offerable(p) ? "" : " (not offered)"}</p>
            <ul className="pl-1">{p.checks.map((c) => <li key={c.condition}>{c.met ? "✓" : "✗"} {c.condition}</li>)}</ul>
            <p className="text-muted-foreground">{p.effect}</p>
          </div>
        ))}
      </div>
      <p className="font-medium">Draft commercial proposal</p>
      <p className="rounded-md border border-dashed p-2">{result.data.proposal}</p>
    </>
  );
}

export function CommercialApplications({ store, disabled, onExplain }: {
  store: ReturnType<typeof makeKeplerStore>; disabled: boolean; onExplain: (prompt: string) => Promise<void>;
}) {
  const [app, setApp] = useState<CommercialAppId>("leaks");
  const [results, setResults] = useState<Partial<Record<CommercialAppId, CommercialResult>>>({});
  const [errors, setErrors] = useState<Partial<Record<CommercialAppId, string>>>({});
  const [attempt, setAttempt] = useState(0);
  const meta = COMMERCIAL_APPS.find((a) => a.id === app)!;
  const result = results[app];
  const error = errors[app] ?? null;
  const loading = !result && !error;
  const setError = (message: string) => setErrors((current) => ({ ...current, [app]: message }));

  useEffect(() => {
    const controller = new AbortController();
    const cached = results[app];
    const show = (value: CommercialResult) => { void focusCommercial(store, value.data.geojson, meta.label, meta.color).catch(() => setError("Loaded, but the map highlight could not be added.")); };
    if (cached) { show(cached); return () => controller.abort(); }
    fetch("/api/menara/call", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal: controller.signal,
      body: JSON.stringify({ tool: meta.tool, args: {} }) })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "The commercial engine is unavailable. Start backend/opportunity-mcp on port 8127.");
        const parsed = parseCommercial(app, payload);
        setResults((current) => ({ ...current, [app]: parsed }));
        show(parsed);
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load this application."); });
    return () => controller.abort();
    // results is a cache; re-running on its change would loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, attempt, store, meta.tool, meta.label, meta.color]);

  return (
    <section aria-label="Commercial applications" className="space-y-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-xs leading-relaxed">
      <div className="flex items-center gap-2"><Briefcase className="size-4 text-emerald-500" /><p className="font-semibold">Commercial applications</p>{loading ? <LoaderCircle className="size-3.5 animate-spin" /> : null}</div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Synthetic data · calculated from stated assumptions · not TM revenue, cost or quotes</p>
      <div role="tablist" aria-label="Commercial application" className="grid grid-cols-3 gap-1">
        {COMMERCIAL_APPS.map((a) => (
          <button key={a.id} role="tab" type="button" aria-selected={app === a.id} onClick={() => setApp(a.id)}
            className={`rounded-md border px-1.5 py-1 text-[11px] leading-tight ${app === a.id ? "border-foreground/40 bg-accent font-semibold" : "text-muted-foreground hover:bg-accent"}`}>
            {a.label}
          </button>
        ))}
      </div>
      {error ? (
        <div role="alert" className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-destructive">
          <p>{error}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => { setErrors((c) => ({ ...c, [app]: undefined })); setResults((c) => ({ ...c, [app]: undefined })); setAttempt((n) => n + 1); }}><RefreshCw />Retry</Button>
        </div>
      ) : null}
      {!result && loading ? <p className="text-muted-foreground">Calculating {meta.label}…</p> : null}
      {result ? <div className="space-y-2">
        <div role="status" aria-label="Executive recommendation" className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Executive recommendation</p>
          <p className="font-semibold">{result.data.headline}</p>
        </div>
        {result.data.application === "revenue_leak_hunter" ? <Leaks result={result as LeakResult} />
          : result.data.application === "opportunity_of_absence" ? <Absence result={result as AbsenceResult} /> : <EventPackages result={result as EventResult} />}
        <details><summary className="cursor-pointer font-medium">Risks, assumptions and method</summary>
          <ul className="mt-1 list-disc pl-4 text-muted-foreground">
            {[...new Set([...("method" in result.data ? (result.data.method as string[]) : []), ...result.data.caveats, ...result.data.limitations])].map((line) => <li key={line}>{line}</li>)}
          </ul>
          {"assumptions" in result.data ? <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] text-muted-foreground">{JSON.stringify(result.data.assumptions, null, 1)}</pre> : null}
        </details>
        <Button type="button" className="w-full" disabled={disabled} onClick={() => void onExplain(explainCommercialPrompt(app))}><Sparkles />Explain with AI (~2 min)</Button>
        <p className="text-muted-foreground">The Business Hypothesis agent explains these computed figures; it cannot change them or add new ones.</p>
      </div> : null}
    </section>
  );
}
