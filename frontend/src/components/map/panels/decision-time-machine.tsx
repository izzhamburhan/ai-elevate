"use client";

import { useEffect, useRef, useState } from "react";
import { History, LoaderCircle, Pin, PinOff, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  NETWORK_RISKS, compareToBaseline, explainPrompt, simulateArgs, simulationSchema,
  type NetworkRisk, type ScenarioInputs, type Simulation, type Strategy,
} from "@/lib/decision/contracts";
import { focusSimulation } from "@/lib/decision/map-overlay";
import type { makeKeplerStore } from "../kepler-store";

const COLORS: Record<Strategy["strategy_id"], string> = { campaign: "#f59e0b", network_first: "#8b5cf6", phased_pilot: "#06b6d4" };
const rm = (value: number) => `${value < 0 ? "−" : ""}RM ${Math.abs(value).toLocaleString("en-MY", { maximumFractionDigits: 0 })}`;
const pct = (value: number) => `${Math.round(value * 100)}%`;

type Option = { opportunity_id: string; title: string; verdict?: string };

async function callTool(tool: string, args: Record<string, unknown>, signal?: AbortSignal) {
  const response = await fetch("/api/menara/call", {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal, body: JSON.stringify({ tool, args }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "The opportunity simulator is unavailable. Start backend/opportunity-mcp on port 8127.");
  return payload;
}

/** p10–p90 bars with p50 tick and mean dot per strategy; a pinned baseline shows as a faint bar underneath. */
function RangeChart({ simulation, baseline }: { simulation: Simulation; baseline: Simulation | null }) {
  const all = [simulation, ...(baseline ? [baseline] : [])].flatMap((s) => s.data.strategies.flatMap((x) => [x.net_contribution_24m_rm.p10, x.net_contribution_24m_rm.p90]));
  const min = Math.min(0, ...all), max = Math.max(0, ...all), span = max - min || 1;
  const x = (value: number) => 8 + ((value - min) / span) * 304;
  return (
    <svg viewBox="0 0 320 112" className="w-full" role="img" aria-label="Simulated 24-month contribution, p10 to p90, per strategy">
      <line x1={x(0)} x2={x(0)} y1={4} y2={92} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="3 3" />
      {x(0) - 8 > 70 && 312 - x(0) > 70 ? <text x={x(0)} y={106} fontSize={9} textAnchor="middle" fill="currentColor" opacity={0.7}>RM 0</text> : null}
      <text x={8} y={106} fontSize={9} fill="currentColor" opacity={0.7}>{rm(min)}</text>
      <text x={312} y={106} fontSize={9} textAnchor="end" fill="currentColor" opacity={0.7}>{rm(max)}</text>
      {simulation.data.strategies.map((s, i) => {
        const y = 14 + i * 28, net = s.net_contribution_24m_rm;
        const before = baseline?.data.strategies.find((b) => b.strategy_id === s.strategy_id)?.net_contribution_24m_rm;
        return (
          <g key={s.strategy_id}>
            {before ? <rect x={x(before.p10)} y={y + 5} width={Math.max(1, x(before.p90) - x(before.p10))} height={4} fill={COLORS[s.strategy_id]} opacity={0.25} /> : null}
            <rect x={x(net.p10)} y={y - 5} width={Math.max(1, x(net.p90) - x(net.p10))} height={9} rx={2} fill={COLORS[s.strategy_id]} opacity={0.55} />
            <line x1={x(net.p50)} x2={x(net.p50)} y1={y - 8} y2={y + 7} stroke={COLORS[s.strategy_id]} strokeWidth={2} />
            <circle cx={x(net.mean)} cy={y - 0.5} r={2.5} fill="currentColor" />
          </g>
        );
      })}
    </svg>
  );
}

/** Median cumulative contribution over 24 months: when each strategy crosses zero (payback). */
function CumulativeChart({ simulation }: { simulation: Simulation }) {
  const series = simulation.data.strategies.map((s) => s.monthly_cumulative_p50_rm);
  const values = series.flat(), min = Math.min(0, ...values), max = Math.max(0, ...values), span = max - min || 1;
  const months = series[0].length - 1;
  const point = (value: number, month: number) => `${8 + (month / months) * 304},${6 + (1 - (value - min) / span) * 76}`;
  return (
    <svg viewBox="0 0 320 96" className="w-full" role="img" aria-label="Median cumulative simulated contribution by month">
      <line x1={8} x2={312} y1={6 + (1 - (0 - min) / span) * 76} y2={6 + (1 - (0 - min) / span) * 76} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="3 3" />
      {simulation.data.strategies.map((s) => (
        <polyline key={s.strategy_id} fill="none" stroke={COLORS[s.strategy_id]} strokeWidth={2}
          points={s.monthly_cumulative_p50_rm.map((value, month) => point(value, month)).join(" ")} />
      ))}
      <text x={8} y={94} fontSize={9} fill="currentColor" opacity={0.7}>month 0</text>
      <text x={312} y={94} fontSize={9} textAnchor="end" fill="currentColor" opacity={0.7}>month {months}</text>
    </svg>
  );
}

export function DecisionTimeMachine({ store, verdicts, disabled, onExplain }: {
  store: ReturnType<typeof makeKeplerStore>;
  /** Order 4 computed feasibility labels by opportunity_id, when a validated run is shown. */
  verdicts?: Record<string, string>;
  disabled: boolean;
  onExplain: (prompt: string) => Promise<void>;
}) {
  const [options, setOptions] = useState<Option[]>([]);
  const [inputs, setInputs] = useState<ScenarioInputs | null>(null);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [baseline, setBaseline] = useState<Simulation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focused = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    callTool("opportunity_discover", { top_k: 3 }, controller.signal)
      .then((payload) => {
        const list: Option[] = payload.data.opportunities.map((o: { opportunity_id: string; title: string }) => ({ opportunity_id: o.opportunity_id, title: o.title }));
        setOptions(list);
        setInputs({ opportunity_id: list[0].opportunity_id, budget_rm: 20_000, demand_multiplier: 1 });
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Opportunities unavailable."); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!inputs) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      callTool("opportunity_simulate", simulateArgs(inputs), controller.signal)
        .then((payload) => {
          const result = simulationSchema.parse(payload);
          setSimulation(result); setError(null);
          if (focused.current !== result.data.opportunity.opportunity_id) {
            focused.current = result.data.opportunity.opportunity_id;
            void focusSimulation(store, result).catch(() => setError("Simulated, but the map highlight could not be added."));
          }
        })
        .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Simulation failed."); })
        .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [inputs, store]);

  if (!inputs) return error ? <p role="alert" className="text-xs text-destructive">{error}</p> : <p className="text-xs text-muted-foreground">Loading opportunities…</p>;
  const update = (patch: Partial<ScenarioInputs>) => setInputs((current) => (current ? { ...current, ...patch } : current));
  const verdict = verdicts?.[inputs.opportunity_id];
  const headroom = inputs.capacity_headroom_pct ?? simulation?.data.inputs.capacity_headroom_pct ?? 30;
  // A result belongs to the current sliders only once the simulator has answered for exactly these inputs.
  const stale = Boolean(simulation) && (simulation!.data.inputs.opportunity_id !== inputs.opportunity_id || simulation!.data.inputs.budget_rm !== inputs.budget_rm
    || simulation!.data.inputs.demand_multiplier !== inputs.demand_multiplier
    || (inputs.capacity_headroom_pct !== undefined && simulation!.data.inputs.capacity_headroom_pct !== inputs.capacity_headroom_pct)
    || (inputs.network_risk !== undefined && simulation!.data.inputs.network_risk !== inputs.network_risk));
  const sameScenario = baseline && simulation && baseline.data.inputs.opportunity_id === simulation.data.inputs.opportunity_id;
  const differs = sameScenario && JSON.stringify(baseline.data.inputs) !== JSON.stringify(simulation.data.inputs);
  const deltas = differs && !stale ? compareToBaseline(simulation, baseline) : null;

  return (
    <section aria-label="Decision Time Machine" className="space-y-3 rounded-lg border border-cyan-500/40 bg-cyan-500/5 p-3 text-xs leading-relaxed">
      <div className="flex items-center gap-2"><History className="size-4 text-cyan-500" /><p className="font-semibold">Decision Time Machine</p>{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}</div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Synthetic data · assumption-based inputs · simulated outcomes</p>
      <label className="flex flex-col gap-1 font-medium">Opportunity
        <select aria-label="Opportunity to simulate" value={inputs.opportunity_id} onChange={(e) => update({ opportunity_id: e.target.value, capacity_headroom_pct: undefined, network_risk: undefined })} className="h-8 rounded-md border bg-background px-2">
          {options.map((o) => <option key={o.opportunity_id} value={o.opportunity_id}>{o.title}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 font-medium">Investment budget: RM {inputs.budget_rm.toLocaleString("en-MY")}
        <input type="range" aria-label="Investment budget (RM)" min={5_000} max={150_000} step={5_000} value={inputs.budget_rm} onChange={(e) => update({ budget_rm: Number(e.target.value) })} />
      </label>
      <label className="flex flex-col gap-1 font-medium">Demand assumption: ×{inputs.demand_multiplier.toFixed(2)} of the Order 4 base
        <input type="range" aria-label="Demand multiplier" min={0.5} max={1.5} step={0.05} value={inputs.demand_multiplier} onChange={(e) => update({ demand_multiplier: Number(e.target.value) })} />
      </label>
      <label className="flex flex-col gap-1 font-medium">Spare network capacity: {headroom}%{inputs.capacity_headroom_pct === undefined ? " (graph default)" : ""}
        <input type="range" aria-label="Spare network capacity (%)" min={0} max={80} step={1} value={headroom} onChange={(e) => update({ capacity_headroom_pct: Number(e.target.value) })} />
      </label>
      <label className="flex flex-col gap-1 font-medium">Network risk
        <select aria-label="Network risk assumption" value={inputs.network_risk ?? ""} onChange={(e) => update({ network_risk: (e.target.value || undefined) as NetworkRisk | undefined })} className="h-8 rounded-md border bg-background px-2">
          <option value="">Graph default{simulation && !inputs.network_risk ? ` (${simulation.data.inputs.network_risk})` : ""}</option>
          {NETWORK_RISKS.map((risk) => <option key={risk} value={risk}>{risk}</option>)}
        </select>
        {verdict ? <span className="font-normal text-muted-foreground">Order 4 validated feasibility: {verdict}.</span> : null}
      </label>
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      {simulation ? <div aria-busy={stale} className={stale ? "space-y-3 opacity-50" : "space-y-3"}>
        {stale ? <p role="status" aria-label="Simulation updating" className="text-muted-foreground">Updating for the new assumptions…</p> : null}
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" className="flex-1" onClick={() => setBaseline(simulation)}><Pin />Pin as baseline</Button>
          {baseline ? <Button type="button" size="sm" variant="ghost" onClick={() => setBaseline(null)}><PinOff />Clear</Button> : null}
        </div>
        {baseline ? <p className="text-muted-foreground">Baseline: RM {baseline.data.inputs.budget_rm.toLocaleString("en-MY")}, demand ×{baseline.data.inputs.demand_multiplier.toFixed(2)}, risk {baseline.data.inputs.network_risk} (faint bars).</p> : null}
        <p className="font-medium">24-month simulated contribution (p10–p90 bar, p50 line, mean dot)</p>
        <RangeChart simulation={simulation} baseline={sameScenario ? baseline : null} />
        <div className="space-y-1.5">
          {simulation.data.strategies.map((s) => {
            const delta = deltas?.find((d) => d.strategy_id === s.strategy_id);
            return (
              <div key={s.strategy_id} className="rounded-md border p-2">
                <p className="flex items-center gap-1.5 font-semibold"><span className="size-2 rounded-full" style={{ background: COLORS[s.strategy_id] }} />{s.name}{simulation.data.recommendation.strategy_id === s.strategy_id ? <span className="rounded bg-green-500/15 px-1 text-[10px] text-green-700 dark:text-green-300">computed pick</span> : null}</p>
                <p className="text-muted-foreground">{s.summary}</p>
                <p>Spend {rm(s.expected_spend_rm)}{s.budget_not_deployed_rm > 0 ? ` (${rm(s.budget_not_deployed_rm)} ${s.strategy_id === "phased_pilot" ? "held back on average" : "not deployable: demand or capacity limit"})` : ""} · customers ~{s.customers_acquired.p50} · mean {rm(s.net_contribution_24m_rm.mean)} ({rm(s.net_contribution_24m_rm.p10)} to {rm(s.net_contribution_24m_rm.p90)})</p>
                <p>Loss probability {pct(s.probability_of_loss_24m)} · payback {s.payback_month_p50 ? `month ${s.payback_month_p50}` : "not within 24 months"}{delta ? ` · vs baseline ${delta.mean_change_rm >= 0 ? "+" : ""}${rm(delta.mean_change_rm)}, loss ${delta.loss_probability_change >= 0 ? "+" : ""}${pct(delta.loss_probability_change)}` : ""}</p>
              </div>
            );
          })}
        </div>
        <p className="font-medium">Median cumulative contribution, months 0–24</p>
        <CumulativeChart simulation={simulation} />
        <div role="status" aria-label="Computed recommendation" className="rounded-md border border-green-500/40 bg-green-500/10 p-2">
          <p className="font-semibold">Computed recommendation: {simulation.data.recommendation.name}</p>
          <p>{simulation.data.recommendation.rule}</p>
          <p className="text-muted-foreground">Deterministic rule over the simulated numbers. The AI explanation can only explain it, never change it.</p>
        </div>
        <Button type="button" className="w-full" disabled={disabled || stale} onClick={() => void onExplain(explainPrompt(inputs))}><Sparkles />Explain with AI (~2 min)</Button>
        <p className="text-muted-foreground">The Business Hypothesis agent explains this exact scenario; its numbers and recommendation come from the simulation above.</p>
        <details><summary className="cursor-pointer font-medium">Assumptions and limitations</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] text-muted-foreground">{JSON.stringify(simulation.data.assumptions, null, 1)}</pre>
          <ul className="mt-1 list-disc pl-4 text-muted-foreground">{simulation.data.limitations.map((line) => <li key={line}>{line}</li>)}</ul>
          <p className="mt-1 text-muted-foreground">{simulation.data.inputs.draws.toLocaleString("en-MY")} seeded Monte Carlo draws over {simulation.data.inputs.horizon_months} months; the same inputs always give the same numbers.</p>
        </details>
      </div> : null}
    </section>
  );
}
