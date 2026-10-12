"use client";

import { useEffect, useState } from "react";
import { Check, Pause, Play, ShieldCheck, Wrench } from "lucide-react";

import { cn } from "@/lib/utils";

import { useInView, usePrefersReducedMotion } from "./hooks";
import { Chip, MockCard } from "./primitives";

const STAGES = ["Detect", "Diagnose", "Simulate", "Approve", "Apply", "Verify", "Roll back", "Recover"];
const ROLLBACK = 6;

/** Neighbour PRB load (%) over the incident: storm spike, a tilt that fails, a retry that works. */
const LOAD = [71, 73, 72, 84, 91, 95, 97, 96, 95, 93, 94, 96, 96, 90, 84, 79, 76, 74, 73, 72, 72, 71];
const THRESHOLD = 85;

type Status = "Open" | "Mitigating" | "Resolved";
type Frame = {
  stage: number;
  /** How many LOAD samples are on the chart. */
  n: number;
  tilts: number;
  status: Status;
  approval: "waiting" | "pending" | "approved";
  retry?: boolean;
  log: string;
  ms: number;
};

const FRAMES: Frame[] = [
  { stage: 0, n: 6, tilts: 0, status: "Open", approval: "waiting", log: "17 tickets clustered near TWR-KB-031. Tower is down.", ms: 1700 },
  { stage: 1, n: 7, tilts: 0, status: "Open", approval: "waiting", log: "Blast radius: feeder F-12, river gauge at 4.2 m, 1 hospital, 2,814 subscribers.", ms: 1900 },
  { stage: 2, n: 8, tilts: 0, status: "Open", approval: "waiting", log: "Twin: tilt −2° on 3 neighbour cells. Predicted load 82%.", ms: 1700 },
  { stage: 3, n: 8, tilts: 0, status: "Open", approval: "pending", log: "Hospital within 2 km, so policy asks a human.", ms: 2300 },
  { stage: 3, n: 8, tilts: 0, status: "Open", approval: "approved", log: "Approved. Signed action token issued.", ms: 1200 },
  { stage: 4, n: 9, tilts: 1, status: "Mitigating", approval: "approved", log: "Tilt −2° applied to TWR-KB-027, -035, -040.", ms: 1500 },
  { stage: 5, n: 12, tilts: 1, status: "Mitigating", approval: "approved", log: "10 min later (scenario clock): load 96%, still above 85%.", ms: 1900 },
  { stage: 6, n: 13, tilts: 1, status: "Mitigating", approval: "approved", log: "Change did not help. Rolled back.", ms: 1600 },
  { stage: 4, n: 14, tilts: 2, status: "Mitigating", approval: "approved", retry: true, log: "Retry: tilt −4° with a load-balance offset.", ms: 1600 },
  { stage: 5, n: 18, tilts: 2, status: "Mitigating", approval: "approved", retry: true, log: "Load 76%, under the threshold. Holding.", ms: 1900 },
  { stage: 7, n: 22, tilts: 2, status: "Resolved", approval: "approved", retry: true, log: "Incident resolved. Care notice sent in 4 languages.", ms: 4200 },
];
const LAST = FRAMES.length - 1;

/** Animated mock of the Self-heal chat card. Loops while on screen; shows the end state for reduced motion. */
export function SelfHealDemo() {
  const reduced = usePrefersReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const running = !reduced && !paused && inView;

  useEffect(() => {
    if (!running) return;
    const t = window.setTimeout(() => setIndex((i) => (i + 1) % FRAMES.length), FRAMES[index].ms);
    return () => window.clearTimeout(t);
  }, [running, index]);

  const at = reduced ? LAST : index;
  const frame = FRAMES[at];
  const reached = Math.max(...FRAMES.slice(0, at + 1).map((fr) => fr.stage));
  const series = LOAD.slice(0, frame.n);
  const now = series[series.length - 1];
  const peak = Math.max(...series);

  return (
    <figure ref={ref} className="relative">
      <figcaption className="sr-only">
        Animated example of a Self-heal card. A flooded tower raises neighbour load to 97%. The assistant simulates a tilt, a human approves it, the first tilt
        does not help and is rolled back, a second tilt brings load under 85%, and the incident is resolved.
      </figcaption>

      <MockCard aria-hidden="true" className="overflow-hidden">
        {/* Chat question */}
        <div className="border-b border-mk-line p-4">
          <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-mk-fg/[0.07] px-3.5 py-2.5 text-[13px] text-mk-fg">
            Towers near Kota Bharu are flooding. Who is affected and what should we do?
          </div>
        </div>

        <div className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium text-mk-fg">
              <span className="grid size-7 place-items-center rounded-lg bg-mk-magenta/15 text-mk-magenta">
                <Wrench className="size-3.5" />
              </span>
              Self-heal · TWR-KB-031
            </div>
            <Chip tone={frame.status === "Resolved" ? "green" : frame.status === "Mitigating" ? "amber" : "red"}>{frame.status}</Chip>
          </div>

          {/* Stage pipeline: 4 × 2, with a retry loop from Roll back to Apply. */}
          <div className="relative pb-5">
            <ol className="grid grid-cols-4 gap-1.5">
              {STAGES.map((s, i) => {
                const active = i === frame.stage;
                const done = !active && i <= reached;
                return (
                  <li
                    key={s}
                    className={cn(
                      "flex h-8 items-center justify-center gap-1 rounded-full border px-1 text-[11px] font-medium whitespace-nowrap transition-all duration-500 sm:text-xs",
                      active && "border-transparent bg-mk-fg text-mk-on-fg shadow-[0_0_24px_-4px_rgba(255,255,255,0.45)]",
                      done && "border-mk-green/30 bg-mk-green/10 text-mk-green",
                      !active && !done && "border-mk-line-strong text-mk-faint",
                    )}
                  >
                    {done && <Check className="size-3 shrink-0" />}
                    {s}
                  </li>
                );
              })}
            </ol>
            <div
              className={cn(
                "absolute top-[calc(100%-1.25rem)] right-[calc(37.5%-0.2rem)] left-[12.5%] h-3.5 rounded-b-lg border border-t-0 border-dashed transition-colors duration-500",
                frame.retry || frame.stage === ROLLBACK ? "border-mk-magenta" : "border-mk-line-strong",
              )}
            >
              <span
                className={cn(
                  "absolute -top-1 -left-[4.5px] size-0 border-x-4 border-b-[6px] border-x-transparent border-b-current",
                  frame.retry || frame.stage === ROLLBACK ? "text-mk-magenta" : "text-mk-line-strong",
                )}
              />
              <span
                className={cn(
                  "absolute top-full left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-mk-surface px-1.5 text-[10px]",
                  frame.retry ? "text-mk-magenta" : "text-mk-faint",
                )}
              >
                retry
              </span>
            </div>
          </div>

          <LoadChart series={series} />

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Peak load" value={`${peak}%`} tone={peak > THRESHOLD ? "red" : "fg"} />
            <Stat label="Load now" value={`${now}%`} tone={now > THRESHOLD ? "amber" : "green"} />
            <Stat label="Tilts tried" value={String(frame.tilts)} />
            <Stat label="Incident" value={frame.status} tone={frame.status === "Resolved" ? "green" : "fg"} />
          </dl>

          {/* Fixed-height approval slot so the card does not jump. */}
          <div className="flex min-h-[76px] items-center gap-3 rounded-xl border border-mk-line bg-mk-fg/[0.02] p-3">
            {frame.approval === "waiting" ? (
              <p className="text-[13px] text-mk-faint">Approval appears once the twin result is ready.</p>
            ) : (
              <>
                <ShieldCheck className={cn("size-5 shrink-0", frame.approval === "approved" ? "text-mk-green" : "text-mk-amber")} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-mk-fg">{frame.approval === "approved" ? "Approved by duty engineer" : "A human must approve"}</p>
                  <p className="truncate text-xs text-mk-muted">Tilt neighbour cells · Hospital (synthetic) within 2 km</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <span
                    className={cn(
                      "inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-semibold transition-all duration-300",
                      frame.approval === "approved" ? "bg-mk-green text-mk-bg" : "bg-mk-fg text-mk-on-fg",
                      frame.approval === "pending" && !reduced && "animate-pulse",
                    )}
                  >
                    {frame.approval === "approved" && <Check className="size-3.5" />}
                    {frame.approval === "approved" ? "Approved" : "Approve"}
                  </span>
                  {frame.approval === "pending" && (
                    <span className="inline-flex h-8 items-center rounded-full border border-mk-line-strong px-3 text-xs text-mk-fg">Reject</span>
                  )}
                </div>
              </>
            )}
          </div>

          <p className="flex items-start gap-2 font-mono text-xs leading-relaxed text-mk-muted">
            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-mk-blue mk-pulse" />
            {frame.log}
          </p>
        </div>
      </MockCard>

      {!reduced && (
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          className="absolute top-3 left-3 grid size-8 place-items-center rounded-full border border-mk-line-strong bg-mk-bg/80 text-mk-fg backdrop-blur hover:bg-mk-raised"
          aria-label={paused ? "Play animation" : "Pause animation"}
        >
          {paused ? <Play className="size-3.5" aria-hidden="true" /> : <Pause className="size-3.5" aria-hidden="true" />}
        </button>
      )}
    </figure>
  );
}

function Stat({ label, value, tone = "fg" }: { label: string; value: string; tone?: "fg" | "green" | "amber" | "red" }) {
  const color = { fg: "text-mk-fg", green: "text-mk-green", amber: "text-mk-amber", red: "text-mk-red" }[tone];
  return (
    <div className="rounded-xl border border-mk-line bg-mk-fg/[0.02] px-3 py-2.5">
      <dt className="text-[11px] text-mk-muted">{label}</dt>
      <dd className={cn("mt-0.5 text-lg font-semibold tracking-tight tabular-nums transition-colors", color)}>{value}</dd>
    </div>
  );
}

/** Inline SVG line chart of neighbour PRB load against the 85% threshold. */
function LoadChart({ series }: { series: number[] }) {
  const W = 320;
  const H = 110;
  const lo = 60;
  const hi = 100;
  const x = (i: number) => 6 + (i / (LOAD.length - 1)) * (W - 12);
  const y = (v: number) => 8 + ((hi - v) / (hi - lo)) * (H - 16);
  const line = series.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = series.length > 1 ? `${line}L${x(series.length - 1).toFixed(1)},${H}L${x(0).toFixed(1)},${H}Z` : "";
  const ty = y(THRESHOLD);
  const split = (ty / H).toFixed(3);
  const last = series.length - 1;

  return (
    <div className="rounded-xl border border-mk-line bg-[#07080b] p-3">
      <div className="mb-1 flex items-center justify-between text-[11px] text-mk-muted">
        <span>Neighbour PRB load</span>
        <span className="text-mk-amber">— — 85% threshold</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full">
        <defs>
          <linearGradient id="heal-line" x1="0" y1="0" x2="0" y2={H} gradientUnits="userSpaceOnUse">
            <stop offset={split} stopColor="#ff3ea5" />
            <stop offset={split} stopColor="#19e6c1" />
          </linearGradient>
          <linearGradient id="heal-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#a77bff" stopOpacity="0.28" />
            <stop offset="1" stopColor="#a77bff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[70, 80, 90].map((v) => (
          <line key={v} x1={0} x2={W} y1={y(v)} y2={y(v)} stroke="#fff" strokeOpacity={0.05} />
        ))}
        <line x1={0} x2={W} y1={ty} y2={ty} stroke="#ffb224" strokeDasharray="5 4" strokeOpacity={0.9} />
        {area && <path d={area} fill="url(#heal-area)" />}
        <path d={line} fill="none" stroke="url(#heal-line)" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
        {last >= 0 && (
          <>
            <circle cx={x(last)} cy={y(series[last])} r={7} fill={series[last] > THRESHOLD ? "#ff3ea5" : "#19e6c1"} fillOpacity={0.25} />
            <circle cx={x(last)} cy={y(series[last])} r={3} fill="#fff" />
          </>
        )}
      </svg>
    </div>
  );
}
