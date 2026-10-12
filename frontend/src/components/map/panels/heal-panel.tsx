"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, MapPinned, ShieldAlert, Wrench, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FLOATING_EVENT, useMapDraw } from "@/lib/menara/map-draw";
import { TOWER_STATUS_COLOR, towerStatusLabel } from "@/lib/map-colors";
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
  | { type: "stage"; step: number | null; stage: Stage; attempt: number; label: string; blocked?: boolean }
  | { type: "approval"; approvalId: string; summary: string; action?: string; targets?: string[]; purpose?: "cover" | "shed" }
  | { type: "final"; status: "done" | "stopped" | "cancelled" | "error"; text: string };
type EventsReply = { runId: string | null; status: string; events: RunEvent[]; next: number; awaitingApproval?: boolean };
type Point = { t_min: number; prb: number };
type MapTower = { name: string; lat: number; lng: number; role: "failed" | "neighbour"; status: string; prb_now: number | null; tilted: boolean };
type HealState = {
  clock_min: number;
  failed_tower: string;
  failed_status: string | null;
  threshold: number;
  watched: string[];
  series: Record<string, Point[]>;
  changes: { change_id: string; status: string; applied_min: number | null; reverted_min: number | null; towers: string[] }[];
  incident: { incident_id: string; status: string } | null;
  run: { id: string; status: string } | null;
  map: { towers: MapTower[] };
};

/** Chart lines in the shared hues; amber is kept for the overload line, as on the site. */
const SERIES_COLORS = ["var(--violet)", "var(--blue)", "var(--teal)", "var(--magenta)"];
const MAP_COLORS = {
  failed: TOWER_STATUS_COLOR.DOWN,
  degraded: TOWER_STATUS_COLOR.DEGRADED,
  hot: "#f97316",
  ok: TOWER_STATUS_COLOR.UP,
  tilted: "#a855f7",
  // neutral, so a line never reads as a load or status colour
  proposed: "#94a3b8",
};
const towerColor = (status: string) => (status === "UP" ? MAP_COLORS.ok : status === "DEGRADED" ? MAP_COLORS.degraded : MAP_COLORS.failed);

async function post<T>(url: string, body: unknown = {}): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

function Chart({ state, width = 360, height = 170 }: { state: HealState; width?: number; height?: number }) {
  const towers = state.watched;
  if (!towers.length) {
    return <p className="text-[12px] text-muted-foreground">No load data for the neighbours yet.</p>;
  }
  const all = towers.flatMap((t) => state.series[t]);
  const minT = Math.min(...all.map((p) => p.t_min));
  const maxT = Math.max(...all.map((p) => p.t_min), minT + 1);
  const pad = { l: 30, r: 8, t: 30, b: 18 };
  const x = (t: number) => pad.l + ((t - minT) / (maxT - minT)) * (width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - Math.min(100, Math.max(0, v)) / 100) * (height - pad.t - pad.b);
  const marks = state.changes.flatMap((c, i) => [
    c.applied_min != null ? { t: c.applied_min, text: `tilt ${i + 1}` } : null,
    c.reverted_min != null ? { t: c.reverted_min, text: `undo ${i + 1}` } : null,
  ]);
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="PRB load of the neighbour towers">
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={0.6} />
            <text x={pad.l - 4} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">
              {v}%
            </text>
          </g>
        ))}
        <line x1={pad.l} x2={width - pad.r} y1={y(state.threshold)} y2={y(state.threshold)} className="stroke-amber" strokeDasharray="3 3" strokeWidth={0.9} />
        <text x={width - pad.r} y={y(state.threshold) - 3} textAnchor="end" className="fill-amber text-[9px]">
          overload {state.threshold}%
        </text>
        {marks.map((m, i) =>
          m ? (
            <g key={`${m.text}-${i}`}>
              <line x1={x(m.t)} x2={x(m.t)} y1={pad.t} y2={height - pad.b} className="stroke-muted-foreground" strokeDasharray="2 2" strokeWidth={0.7} />
              <text x={x(m.t) + 2} y={pad.t - 21 + (i % 3) * 9} className="fill-muted-foreground text-[9px]">
                {m.text}
              </text>
            </g>
          ) : null,
        )}
        {towers.map((tower, i) => (
          <polyline
            key={tower}
            fill="none"
            style={{ stroke: SERIES_COLORS[i % SERIES_COLORS.length] }}
            strokeWidth={1.6}
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
    <div className="min-w-0 rounded-xl border bg-foreground/[0.02] px-2 py-1.5">
      <div className={cn("truncate whitespace-nowrap text-[13px] font-semibold tabular-nums", tone)} title={value}>
        {value}
      </div>
      <div className="truncate text-[10.5px] text-muted-foreground">{label}</div>
    </div>
  );
}

/** The human-in-the-loop prompt: nothing risky happens until a person presses Approve. */
function ApprovalBox({ summary, onDecide }: { summary: string; onDecide: (approve: boolean) => void }) {
  return (
    <div className="rounded-xl border border-amber/30 bg-amber/10 p-2.5 text-[12px]">
      <p className="mb-1 flex items-center gap-1.5 font-medium">
        <ShieldAlert className="size-3.5 text-amber" /> Your approval is needed
      </p>
      <p className="mb-2 text-muted-foreground">{summary}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="brand" onClick={() => onDecide(true)}>
          Approve
        </Button>
        <Button size="sm" variant="outline" onClick={() => onDecide(false)}>
          Reject
        </Button>
      </div>
    </div>
  );
}

/**
 * Self-heal as a chat card. The chat shows the 8-stage loop; a floating card at the bottom right shows the approval
 * prompt, the tiles and the load chart, and the map draws the incident (the failed tower, its neighbours by load, the
 * tilted ones). Every risky step waits for a person (human in the loop). `runId` is the run this card started.
 */
export function HealPanel({ runId }: { runId?: string }) {
  const draw = useMapDraw();
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [approval, setApproval] = useState<{ approvalId: string; summary: string; action?: string; targets?: string[] } | null>(null);
  const [state, setState] = useState<HealState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const next = useRef(0);
  const busy = useRef(false);
  const drawn = useRef<string>("");
  const framed = useRef(false);
  const floatingId = useId();

  // this card's run is the current one (older chat cards only show their stages)
  const owns = Boolean(runId) && currentId === runId;

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
      setCurrentId(reply.runId);
      setStatus(reply.status);
      if (reply.events.length) setEvents((prev) => [...prev, ...reply.events]);
      const pending = [...reply.events].reverse().find((e) => e.type === "approval");
      if (reply.awaitingApproval && pending?.type === "approval")
        setApproval({ approvalId: pending.approvalId, summary: pending.summary, action: pending.action, targets: pending.targets });
      else if (!reply.awaitingApproval) setApproval(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busy.current = false;
    }
  }, []);

  // restore after a remount, then keep polling while a run is going
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
    if (status !== "done" && status !== "stopped" && status !== "cancelled" && status !== "error") return;
    // once now and once a little later, so the chart shows the settled result
    const timers = [0, 2500].map((ms) => setTimeout(() => void refreshState(), ms));
    return () => timers.forEach(clearTimeout);
  }, [status, refreshState]);

  // the floating card opens by itself while this card's run is going; another floating card closes it
  useEffect(() => {
    if (!owns || status !== "running") return;
    const timer = setTimeout(() => {
      setOpen(true);
      window.dispatchEvent(new CustomEvent(FLOATING_EVENT, { detail: floatingId }));
    }, 0);
    return () => clearTimeout(timer);
  }, [owns, status, floatingId]);
  // approvals are only decided in the floating card, so each new one brings it back
  const approvalId = approval?.approvalId;
  useEffect(() => {
    if (!owns || !approvalId) return;
    const timer = setTimeout(() => {
      setOpen(true);
      window.dispatchEvent(new CustomEvent(FLOATING_EVENT, { detail: floatingId }));
    }, 0);
    return () => clearTimeout(timer);
  }, [owns, approvalId, floatingId]);
  useEffect(() => {
    const onOpen = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== floatingId) setOpen(false);
    };
    window.addEventListener(FLOATING_EVENT, onOpen);
    return () => window.removeEventListener(FLOATING_EVENT, onOpen);
  }, [floatingId]);

  // what the latest neighbour tilt is for, and the neighbours a pending tilt would move
  const purpose = events.reduce<"cover" | "shed" | undefined>((last, e) => (e.type === "approval" && e.purpose ? e.purpose : last), undefined);
  const proposedKey = approval?.action === "ran_tilt_cells" ? (approval.targets ?? []).join(",") : "";

  // draw the incident on the map when what it shows changes; lines join the failed tower only to the neighbours a
  // tilt proposes (faint) or has moved (re-tilted purple), so they show the fix, not every neighbour
  useEffect(() => {
    if (!owns || !open || !state?.map.towers.length) return;
    const towers = state.map.towers;
    const signature = JSON.stringify([towers.map((t) => [t.name, t.status, t.tilted, (t.prb_now ?? 0) >= state.threshold]), proposedKey, purpose]);
    if (signature === drawn.current) return;
    drawn.current = signature;
    const failed = towers.find((t) => t.role === "failed");
    const neighbours = towers.filter((t) => t.role === "neighbour");
    const row = (t: MapTower) => ({ name: t.name, lat: t.lat, lng: t.lng, status: t.status, prb_now: t.prb_now ?? "" });
    const proposed = proposedKey ? proposedKey.split(",") : [];
    void (async () => {
      draw.removeOurs(["heal_"]);
      if (failed) {
        const cover = purpose === "cover";
        const link = (n: MapTower) => ({ lat0: failed.lat, lng0: failed.lng, lat1: n.lat, lng1: n.lng, tower: n.name });
        await draw.addLines(
          "heal_links_proposed",
          `Proposed: ${cover ? "cover" : "re-tilt for"} ${failed.name}`,
          neighbours.filter((n) => !n.tilted && proposed.includes(n.name)).map(link),
          MAP_COLORS.proposed,
          1.5,
          0.6,
        );
        await draw.addLines(
          "heal_links_tilted",
          cover ? `Covering ${failed.name}` : `Re-tilted for ${failed.name}`,
          neighbours.filter((n) => n.tilted).map(link),
          MAP_COLORS.tilted,
          3,
        );
      }
      const up = neighbours.filter((n) => n.status === "UP");
      const hot = up.filter((n) => !n.tilted && (n.prb_now ?? 0) >= state.threshold);
      const ok = up.filter((n) => !n.tilted && (n.prb_now ?? 0) < state.threshold);
      await draw.addPoints("heal_ok", "Neighbours OK", ok.map(row), MAP_COLORS.ok, 40);
      // neighbours that are faulty themselves
      await draw.addPoints("heal_down", "Neighbours in outage", neighbours.filter((n) => n.status === "DOWN").map(row), MAP_COLORS.failed, 40);
      await draw.addPoints("heal_degraded", "Neighbours degraded", neighbours.filter((n) => n.status === "DEGRADED").map(row), MAP_COLORS.degraded, 40);
      await draw.addPoints("heal_hot", "Neighbours overloaded", hot.map(row), MAP_COLORS.hot, 55);
      await draw.addPoints("heal_tilted", "Neighbours re-tilted", neighbours.filter((n) => n.tilted).map(row), MAP_COLORS.tilted, 60);
      if (failed) await draw.addPoints("heal_failed", `${failed.name} (${towerStatusLabel(failed.status)})`, [row(failed)], towerColor(failed.status), 75);
      if (!framed.current) {
        framed.current = true;
        const lngs = towers.map((t) => t.lng);
        const lats = towers.map((t) => t.lat);
        draw.fit([Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]);
      }
    })();
  }, [owns, open, state, draw, proposedKey, purpose]);

  const decide = async (approve: boolean) => {
    if (!currentId) return;
    setApproval(null);
    await post("/api/menara/heal/decision", { runId: currentId, approve }).catch((e) => setError(String(e)));
    void poll();
  };

  const close = () => {
    setOpen(false);
    drawn.current = "";
    framed.current = false;
    draw.removeOurs(["heal_"]);
  };

  const showAgain = () => {
    setOpen(true);
    window.dispatchEvent(new CustomEvent(FLOATING_EVENT, { detail: floatingId }));
  };

  const stageEvents = events.filter((e): e is Extract<RunEvent, { type: "stage" }> => e.type === "stage");
  const last = stageEvents.at(-1);
  const final = events.find((e): e is Extract<RunEvent, { type: "final" }> => e.type === "final");
  const running = status === "running";
  // the stage a rejection, a policy denial or a missing crew stopped the run at; the stages after it never ran
  const blockedAt = !running ? STAGES.findIndex((s) => stageEvents.findLast((e) => e.stage === s.id)?.blocked) : -1;
  const peak = state && state.watched.length ? Math.max(...state.watched.flatMap((t) => state.series[t].map((p) => p.prb))) : null;
  const now = state && state.watched.length ? Math.max(...state.watched.map((t) => state.series[t].at(-1)?.prb ?? 0)) : null;

  return (
    <div className="flex max-h-[40rem] flex-col gap-3 overflow-y-auto rounded-xl border bg-card/40 p-3 font-sans text-foreground">
      <h2 className="flex items-center gap-2 truncate text-sm font-medium">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-magenta/15 text-magenta">
          <Wrench className="size-3.5" />
        </span>
        Self-heal{state ? ` · ${state.failed_tower}` : ""}
      </h2>

      {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-[12px] text-destructive">{error}</p> : null}
      {/* the decision itself lives in the floating card only; the chat just points to it */}
      {owns && approval ? (
        <div className="flex items-center gap-2 rounded-xl border border-amber/30 bg-amber/10 p-2.5 text-[12px]">
          <ShieldAlert className="size-3.5 shrink-0 text-amber" />
          <span className="min-w-0 flex-1">Your approval is needed in the self-heal card on the map.</span>
          {open ? null : (
            <Button size="sm" variant="outline" onClick={showAgain}>
              Open card
            </Button>
          )}
        </div>
      ) : null}

      <ol className="flex flex-col gap-1">
        {STAGES.map((s, i) => {
          const seen = stageEvents.filter((e) => e.stage === s.id);
          const active = running && last?.stage === s.id;
          const blocked = i === blockedAt;
          const done = seen.length > 0 && !active && !blocked;
          const skipped = blockedAt >= 0 && i > blockedAt && !seen.length;
          const latest = seen.at(-1);
          return (
            <li
              key={s.id}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors",
                active && "border-primary bg-primary/10",
                (blocked || (done && s.id === "rollback")) && "border-red/30 bg-red/10",
                !active && !done && !blocked && "text-muted-foreground",
                skipped && "opacity-60",
              )}
            >
              <span className="grid size-4 shrink-0 place-items-center">
                {active ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : blocked ? (
                  <X className="size-3.5 text-red" />
                ) : done ? (
                  <Check className={cn("size-3.5", s.id === "rollback" ? "text-red" : "text-green")} />
                ) : (
                  <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                )}
              </span>
              <span className="font-medium">{s.title}</span>
              {latest?.attempt ? <span className="whitespace-nowrap rounded-full bg-muted px-1.5 text-[10px]">try {latest.attempt}</span> : null}
              <span className={cn("ml-auto truncate text-right", blocked ? "text-red" : "text-muted-foreground")}>{latest?.label ?? (skipped ? "Skipped" : "")}</span>
            </li>
          );
        })}
      </ol>

      {final ? (
        <p
          className={cn(
            "rounded-lg border px-2.5 py-2 text-[12px] leading-5",
            final.status === "error"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : final.status === "stopped"
                ? "border-red/30 bg-red/10 text-foreground"
                : "bg-card text-muted-foreground",
          )}
        >
          {final.text}
        </p>
      ) : null}

      {owns ? (
        open ? (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <MapPinned className="size-3.5" /> The load chart and the incident on the map are at the bottom right.
          </p>
        ) : (
          <Button size="sm" variant="outline" className="self-start" onClick={showAgain}>
            <MapPinned /> Show on the map
          </Button>
        )
      ) : null}
      <p className="text-[11px] text-muted-foreground">Synthetic data. Nothing real-world is changed; every action waits for your approval.</p>

      {owns && open && typeof document !== "undefined"
        ? createPortal(
            <div
              role="dialog"
              aria-label="Self-heal"
              className="fixed right-4 bottom-10 z-[60] flex max-h-[70vh] w-[24rem] max-w-[calc(100vw-2rem)] flex-col gap-2.5 overflow-y-auto rounded-2xl border bg-background/95 p-3 font-sans text-foreground shadow-[0_24px_60px_-28px_rgba(0,0,0,0.45)] backdrop-blur"
            >
              <div className="flex items-center gap-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-magenta/15 text-magenta">
                  <Wrench className="size-3.5" />
                </span>
                <h3 className="text-[13px] font-medium">Self-heal{state ? ` · ${state.failed_tower}` : ""}</h3>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10.5px] font-medium",
                    approval
                      ? "border-amber/30 bg-amber/10 text-amber"
                      : running
                        ? "border-violet/30 bg-violet/10 text-violet"
                        : status === "done"
                          ? "border-green/30 bg-green/10 text-green"
                          : status === "stopped" || status === "error"
                            ? "border-red/30 bg-red/10 text-red"
                            : "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {approval ? "waiting for you" : running ? "running" : status}
                </span>
                <button type="button" onClick={close} aria-label="Close" className="ml-auto rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                  <X className="size-3.5" />
                </button>
              </div>

              {approval ? <ApprovalBox summary={approval.summary} onDecide={decide} /> : null}
              {final && final.status !== "done" ? (
                <p className="rounded-lg border border-red/30 bg-red/10 px-2.5 py-2 text-[12px] leading-5">{final.text}</p>
              ) : last && !approval ? (
                <p className="text-[12px] text-muted-foreground">Now: {last.label}</p>
              ) : null}

              {state ? (
                <>
                  <div className="grid grid-cols-4 gap-2">
                    <Tile
                      label="Tower"
                      value={(state.failed_status ?? "?").toLowerCase()}
                      tone={state.failed_status === "UP" ? "text-green" : state.failed_status === "DEGRADED" ? "text-amber" : "text-red"}
                    />
                    <Tile label="Peak load" value={peak != null ? `${peak.toFixed(0)}%` : "–"} tone={peak != null && peak >= state.threshold ? "text-red" : undefined} />
                    <Tile label="Load now" value={now != null ? `${now.toFixed(0)}%` : "–"} tone={now != null && now < state.threshold ? "text-green" : undefined} />
                    <Tile label="Incident" value={(state.incident?.status ?? "none").toLowerCase()} tone={state.incident?.status === "RESOLVED" ? "text-green" : undefined} />
                  </div>
                  <section>
                    <h4 className="mb-1 text-[12px] font-medium text-muted-foreground">PRB load of the neighbours of {state.failed_tower}</h4>
                    <Chart state={state} width={380} height={180} />
                  </section>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    {[
                      ["Outage", MAP_COLORS.failed],
                      ["Degraded", MAP_COLORS.degraded],
                      ["Overloaded", MAP_COLORS.hot],
                      ["OK", MAP_COLORS.ok],
                      ["Re-tilted", MAP_COLORS.tilted],
                    ].map(([label, color]) => (
                      <span key={label} className="flex items-center gap-1">
                        <span className="size-2 rounded-full" style={{ background: color }} />
                        {label}
                      </span>
                    ))}
                    {[
                      ["Proposed tilt", MAP_COLORS.proposed],
                      ["Tilt applied", MAP_COLORS.tilted],
                    ].map(([label, color]) => (
                      <span key={label} className="flex items-center gap-1">
                        <span className="h-0.5 w-3 rounded-full" style={{ background: color }} />
                        {label}
                      </span>
                    ))}
                  </div>
                </>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
