"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Play, RotateCcw, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Stage = "detect" | "diagnose" | "simulate" | "approve" | "apply" | "verify" | "rollback" | "recover";
const STAGES: { id: Stage; title: string }[] = [
  { id: "detect", title: "Detect" },
  { id: "diagnose", title: "Diagnose" },
  { id: "simulate", title: "Simulate" },
  { id: "approve", title: "Approve" },
  { id: "apply", title: "Apply" },
  { id: "verify", title: "Verify" },
  { id: "rollback", title: "Roll back" },
  { id: "recover", title: "Recover" },
];

type RunEvent =
  | { type: "stage"; step: number | null; stage: Stage; attempt: number; label: string }
  | { type: "approval"; approvalId: string; summary: string }
  | { type: "final"; status: "done" | "cancelled" | "error"; text: string };
type EventsReply = { runId: string | null; status: string; events: RunEvent[]; next: number; awaitingApproval?: boolean };
type Point = { t_min: number; prb: number };
type HealState = {
  clock_min: number;
  failed_tower: string;
  failed_status: string | null;
  threshold: number;
  watched: string[];
  series: Record<string, Point[]>;
  changes: { change_id: string; status: string; applied_min: number | null; reverted_min: number | null; towers: string[] }[];
  incident: { incident_id: string; status: string } | null;
};

const SERIES_COLORS = ["#7c5cff", "#f59e0b", "#10b981", "#38bdf8"];

async function post<T>(url: string, body: unknown = {}): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

function Chart({ state }: { state: HealState }) {
  const towers = state.watched;
  if (!towers.length) {
    return <p className="text-[12px] text-muted-foreground">The chart appears once a neighbour of the failed tower runs hot or is re-tilted.</p>;
  }
  const all = towers.flatMap((t) => state.series[t]);
  const minT = Math.min(...all.map((p) => p.t_min));
  const maxT = Math.max(...all.map((p) => p.t_min), minT + 1);
  const W = 360;
  const H = 150;
  const pad = { l: 28, r: 8, t: 8, b: 18 };
  const x = (t: number) => pad.l + ((t - minT) / (maxT - minT)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - Math.min(100, Math.max(0, v)) / 100) * (H - pad.t - pad.b);
  const marks = state.changes.flatMap((c, i) => [
    c.applied_min != null ? { t: c.applied_min, text: `tilt ${i + 1}` } : null,
    c.reverted_min != null ? { t: c.reverted_min, text: `undo ${i + 1}` } : null,
  ]);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="PRB load of the neighbour towers">
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={0.5} />
            <text x={pad.l - 4} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground text-[8px]">
              {v}%
            </text>
          </g>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(state.threshold)} y2={y(state.threshold)} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={0.8} />
        <text x={W - pad.r} y={y(state.threshold) - 2} textAnchor="end" fill="#ef4444" className="text-[8px]">
          overload {state.threshold}%
        </text>
        {marks.map((m, i) =>
          m ? (
            <g key={`${m.text}-${i}`}>
              <line x1={x(m.t)} x2={x(m.t)} y1={pad.t} y2={H - pad.b} className="stroke-muted-foreground" strokeDasharray="2 2" strokeWidth={0.6} />
              <text x={x(m.t) + 2} y={pad.t + 7} className="fill-muted-foreground text-[8px]">
                {m.text}
              </text>
            </g>
          ) : null,
        )}
        {towers.map((tower, i) => (
          <polyline
            key={tower}
            fill="none"
            stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
            strokeWidth={1.4}
            points={state.series[tower].map((p) => `${x(p.t_min).toFixed(1)},${y(p.prb).toFixed(1)}`).join(" ")}
          />
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
        {towers.map((tower, i) => (
          <span key={tower} className="flex items-center gap-1">
            <span className="size-2 rounded-full" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
            {tower}
          </span>
        ))}
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border bg-card px-2.5 py-1.5">
      <div className={cn("text-sm font-semibold tabular-nums", tone)}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

/** Self-heal: the flood story as a closed loop (detect to recover), run as a replay that a human approves step by step. */
export function HealPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [approval, setApproval] = useState<{ approvalId: string; summary: string } | null>(null);
  const [state, setState] = useState<HealState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const next = useRef(0);
  const busy = useRef(false);

  const refreshState = useCallback(async () => {
    try {
      setState(await post<HealState>("/api/menara/heal/state"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const poll = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const reply = await post<EventsReply>("/api/menara/heal/events", { since: next.current });
      next.current = reply.next;
      setRunId(reply.runId);
      setStatus(reply.status);
      if (reply.events.length) setEvents((prev) => [...prev, ...reply.events]);
      const pending = [...reply.events].reverse().find((e) => e.type === "approval");
      if (reply.awaitingApproval && pending?.type === "approval") setApproval({ approvalId: pending.approvalId, summary: pending.summary });
      else if (!reply.awaitingApproval) setApproval(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
    }
  }, []);

  // restore after a tab switch (the panel unmounts), then keep polling while a run is going
  useEffect(() => {
    const timer = setTimeout(() => {
      void poll();
      void refreshState();
    }, 0);
    return () => clearTimeout(timer);
  }, [poll, refreshState]);

  useEffect(() => {
    if (status !== "running") return;
    const fast = setInterval(() => void poll(), 800);
    const slow = setInterval(() => void refreshState(), 2500);
    return () => {
      clearInterval(fast);
      clearInterval(slow);
    };
  }, [status, poll, refreshState]);

  useEffect(() => {
    if (status !== "done" && status !== "cancelled" && status !== "error") return;
    const timer = setTimeout(() => void refreshState(), 0);
    return () => clearTimeout(timer);
  }, [status, refreshState]);

  const start = async () => {
    setError(null);
    try {
      next.current = 0;
      setEvents([]);
      setApproval(null);
      const { runId: id } = await post<{ runId: string }>("/api/menara/heal");
      setRunId(id);
      setStatus("running");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const decide = async (approve: boolean) => {
    if (!runId) return;
    setApproval(null);
    await post("/api/menara/heal/decision", { runId, approve }).catch((e) => setError(String(e)));
    void poll();
  };

  const cancel = async () => {
    if (runId) await post("/api/menara/heal", { action: "cancel", runId }).catch((e) => setError(String(e)));
    void poll();
  };

  const reset = async () => {
    setError(null);
    try {
      await post("/api/menara/reset");
      next.current = 0;
      setEvents([]);
      setApproval(null);
      setStatus("idle");
      setRunId(null);
      void refreshState();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const stageEvents = events.filter((e): e is Extract<RunEvent, { type: "stage" }> => e.type === "stage");
  const last = stageEvents.at(-1);
  const final = events.find((e): e is Extract<RunEvent, { type: "final" }> => e.type === "final");
  const running = status === "running";
  const peak = state && state.watched.length ? Math.max(...state.watched.flatMap((t) => state.series[t].map((p) => p.prb))) : null;
  const now = state && state.watched.length ? Math.max(...state.watched.map((t) => state.series[t].at(-1)?.prb ?? 0)) : null;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 font-sans text-foreground",
        embedded ? "max-h-[40rem] overflow-y-auto rounded-xl border bg-card/40 p-3" : "min-h-0 flex-1 overflow-y-auto pb-3",
      )}
    >
      <h2 className={cn("truncate font-bold tracking-tight", embedded ? "text-sm" : "text-base")}>Self-heal</h2>
      <p className="text-[12px] leading-5 text-muted-foreground">
        A flood cuts power to a tower. Watch the loop detect it, simulate a fix, ask a human, apply it, check the result and roll back if it fails.
        A scripted replay (no model key) drives the real MCP servers.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button onClick={start} disabled={running} className="h-9 rounded-[10px]">
          {running ? <Loader2 className="animate-spin" /> : <Play />}
          Run self-heal (replay)
        </Button>
        {running ? (
          <Button variant="outline" onClick={cancel} className="h-9 rounded-[10px]">
            <Square /> Cancel
          </Button>
        ) : null}
        <Button variant="ghost" onClick={reset} disabled={running} className="h-9 rounded-[10px]" title="Clear incidents, approvals, RAN changes and the clock">
          <RotateCcw /> Reset demo
        </Button>
      </div>

      {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-[12px] text-destructive">{error}</p> : null}

      {approval ? (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-2.5 text-[12px]">
          <p className="mb-2 font-medium">A human must approve</p>
          <p className="mb-2 text-muted-foreground">{approval.summary}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => decide(true)}>
              Approve
            </Button>
            <Button size="sm" variant="outline" onClick={() => decide(false)}>
              Reject
            </Button>
          </div>
        </div>
      ) : null}

      <ol className="flex flex-col gap-1">
        {STAGES.map((s) => {
          const seen = stageEvents.filter((e) => e.stage === s.id);
          const active = running && last?.stage === s.id;
          const done = seen.length > 0 && !active;
          const latest = seen.at(-1);
          return (
            <li
              key={s.id}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors",
                active && "border-primary bg-primary/10",
                done && s.id === "rollback" && "border-red-500/40 bg-red-500/10",
                !active && !done && "text-muted-foreground",
              )}
            >
              <span className="grid size-4 shrink-0 place-items-center">
                {active ? <Loader2 className="size-3.5 animate-spin" /> : done ? <Check className={cn("size-3.5", s.id === "rollback" ? "text-red-500" : "text-emerald-500")} /> : <span className="size-1.5 rounded-full bg-muted-foreground/40" />}
              </span>
              <span className="font-medium">{s.title}</span>
              {latest?.attempt ? <span className="rounded bg-muted px-1 text-[10px]">attempt {latest.attempt}</span> : null}
              <span className="ml-auto truncate text-right text-muted-foreground">{latest?.label ?? ""}</span>
            </li>
          );
        })}
      </ol>

      {final ? (
        <p className={cn("rounded-lg border px-2.5 py-2 text-[12px] leading-5", final.status === "error" ? "border-destructive/40 bg-destructive/10 text-destructive" : "bg-card text-muted-foreground")}>
          {final.text}
        </p>
      ) : null}

      {state ? (
        <>
          <div className="grid grid-cols-4 gap-2">
            <Tile label="Peak load" value={peak != null ? `${peak.toFixed(0)}%` : "–"} tone={peak != null && peak >= state.threshold ? "text-red-500" : undefined} />
            <Tile label="Load now" value={now != null ? `${now.toFixed(0)}%` : "–"} tone={now != null && now < state.threshold ? "text-emerald-500" : undefined} />
            <Tile label="Tilts tried" value={String(state.changes.length)} />
            <Tile label="Incident" value={state.incident?.status ?? "none"} />
          </div>
          <section>
            <h3 className="mb-1 text-[12px] font-semibold text-muted-foreground">PRB load of the neighbours of {state.failed_tower}</h3>
            <Chart state={state} />
          </section>
        </>
      ) : null}
      <p className="text-[11px] text-muted-foreground">Synthetic data. Nothing real-world is changed.</p>
    </div>
  );
}