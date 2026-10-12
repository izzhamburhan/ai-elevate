"use client";

import { BarChart3 } from "lucide-react";
import { z } from "zod";

/**
 * A chart in the chat answer (`show_chart`). The model passes numbers it already got from tools in this conversation,
 * names that source, and picks the chart type; this draws it as plain SVG (no chart library). Every value shown is
 * one the model passed in, and the card says where they came from.
 */

export const chartSpecSchema = z.object({
  title: z.string().min(1).max(120),
  type: z
    .enum(["bar", "horizontal_bar", "line", "area", "pie", "scatter"])
    .describe("bar/horizontal_bar to compare items, line/area for a trend over time, pie for shares of a whole, scatter for two measures"),
  categories: z.array(z.string().max(40)).max(60).optional().describe("x labels (bar, line, area) or slice labels (pie), in order"),
  series: z
    .array(z.object({ name: z.string().max(40), values: z.array(z.number()).max(60) }))
    .max(6)
    .optional()
    .describe("one or more series, each with one value per category (pie: exactly one series)"),
  points: z
    .array(z.object({ x: z.number(), y: z.number(), label: z.string().max(40).optional() }))
    .max(200)
    .optional()
    .describe("scatter only"),
  x_label: z.string().max(40).optional(),
  y_label: z.string().max(40).optional(),
  unit: z.string().max(16).optional().describe("unit of the values, e.g. '%', 'Mbps', 'visitors'"),
  source: z.string().min(3).max(160).describe("which tool result(s) these numbers come from, e.g. 'analyze_network_congestion, Shah Alam, last 7 days'"),
  note: z.string().max(200).optional(),
});
export type ChartSpec = z.infer<typeof chartSpecSchema>;

const PALETTE = ["#7c5cff", "#f59e0b", "#10b981", "#38bdf8", "#ec4899", "#ef4444"];
const W = 380;
const H = 230;

/** A checked spec, or the reason it cannot be drawn. */
export function checkChart(spec: ChartSpec): string | null {
  const cats = spec.categories ?? [];
  const series = spec.series ?? [];
  if (spec.type === "scatter") return spec.points?.length ? null : "A scatter chart needs points.";
  if (!cats.length || !series.length) return "This chart needs categories and at least one series.";
  if (series.some((s) => s.values.length !== cats.length)) return "Every series needs exactly one value per category.";
  if (series.some((s) => s.values.some((v) => !Number.isFinite(v)))) return "All values must be numbers.";
  if (spec.type === "pie" && (series.length !== 1 || series[0].values.some((v) => v < 0))) return "A pie chart takes one series of non-negative values.";
  return null;
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) max = min + 1;
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

const fmt = (v: number) =>
  Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e4 ? `${(v / 1e3).toFixed(0)}k` : Math.abs(v) >= 1000 ? `${(v / 1e3).toFixed(1)}k` : `${+v.toFixed(2)}`;

function short(label: string, max: number) {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function Axes({ yTicks, y, pad, unit }: { yTicks: number[]; y: (v: number) => number; pad: { l: number; r: number }; unit?: string }) {
  return (
    <>
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={0.6} />
          <text x={pad.l - 4} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">
            {fmt(t)}
            {unit === "%" ? "%" : ""}
          </text>
        </g>
      ))}
    </>
  );
}

function Cartesian({ spec }: { spec: ChartSpec }) {
  const cats = spec.categories ?? [];
  const series = spec.series ?? [];
  const all = series.flatMap((s) => s.values);
  const lo = Math.min(0, ...all);
  const hi = Math.max(...all, lo + 1);
  const yTicks = niceTicks(lo, hi);
  const pad = { l: 36, r: 8, t: 10, b: cats.length > 8 ? 46 : 28 };
  const y = (v: number) => pad.t + (1 - (v - yTicks[0]) / (yTicks.at(-1)! - yTicks[0])) * (H - pad.t - pad.b);
  const band = (W - pad.l - pad.r) / cats.length;
  const xc = (i: number) => pad.l + band * (i + 0.5);
  const rotate = cats.length > 8;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={spec.title}>
      <Axes yTicks={yTicks} y={y} pad={pad} unit={spec.unit} />
      {spec.type === "bar"
        ? series.map((s, k) => {
            const bw = Math.max(2, (band * 0.75) / series.length);
            return s.values.map((v, i) => {
              const x = pad.l + band * i + band * 0.125 + bw * k;
              const top = Math.min(y(v), y(0));
              return (
                <rect key={`${k}-${i}`} x={x} y={top} width={bw - 1} height={Math.max(1, Math.abs(y(v) - y(0)))} rx={2} fill={PALETTE[k % PALETTE.length]}>
                  <title>{`${s.name} · ${cats[i]}: ${v}${spec.unit ? ` ${spec.unit}` : ""}`}</title>
                </rect>
              );
            });
          })
        : series.map((s, k) => {
            const color = PALETTE[k % PALETTE.length];
            const path = s.values.map((v, i) => `${i ? "L" : "M"}${xc(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
            return (
              <g key={s.name}>
                {spec.type === "area" ? (
                  <path d={`${path} L${xc(s.values.length - 1).toFixed(1)},${y(Math.max(0, yTicks[0]))} L${xc(0).toFixed(1)},${y(Math.max(0, yTicks[0]))} Z`} fill={color} opacity={0.18} />
                ) : null}
                <path d={path} fill="none" stroke={color} strokeWidth={1.8} />
                {s.values.map((v, i) => (
                  <circle key={i} cx={xc(i)} cy={y(v)} r={cats.length > 30 ? 1.5 : 2.5} fill={color}>
                    <title>{`${s.name} · ${cats[i]}: ${v}${spec.unit ? ` ${spec.unit}` : ""}`}</title>
                  </circle>
                ))}
              </g>
            );
          })}
      {cats.map((c, i) =>
        rotate && i % Math.ceil(cats.length / 14) ? null : (
          <text
            key={`${c}-${i}`}
            x={xc(i)}
            y={H - pad.b + 12}
            textAnchor={rotate ? "end" : "middle"}
            transform={rotate ? `rotate(-35 ${xc(i)} ${H - pad.b + 12})` : undefined}
            className="fill-muted-foreground text-[9px]"
          >
            {short(c, rotate ? 14 : Math.max(4, Math.floor(band / 5.5)))}
          </text>
        ),
      )}
    </svg>
  );
}

function HorizontalBars({ spec }: { spec: ChartSpec }) {
  const cats = spec.categories ?? [];
  const series = spec.series ?? [];
  const hi = Math.max(...series.flatMap((s) => s.values), 1);
  const ticks = niceTicks(0, hi);
  const rowH = Math.max(14, Math.min(26, 200 / cats.length));
  const height = rowH * cats.length + 30;
  const pad = { l: 110, r: 44 }; // room for the value after the longest bar
  const x = (v: number) => pad.l + (v / ticks.at(-1)!) * (W - pad.l - pad.r);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label={spec.title}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={4} y2={height - 18} className="stroke-border" strokeWidth={0.6} />
          <text x={x(t)} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[9px]">
            {fmt(t)}
          </text>
        </g>
      ))}
      {cats.map((c, i) => (
        <g key={`${c}-${i}`}>
          <text x={pad.l - 6} y={6 + rowH * i + rowH / 2 + 3} textAnchor="end" className="fill-foreground text-[10px]">
            {short(c, 20)}
          </text>
          {series.map((s, k) => {
            const bh = (rowH * 0.7) / series.length;
            const v = s.values[i];
            return (
              <rect key={k} x={pad.l} y={6 + rowH * i + rowH * 0.15 + bh * k} width={Math.max(1, x(v) - pad.l)} height={bh - 1} rx={2} fill={PALETTE[k % PALETTE.length]}>
                <title>{`${s.name} · ${c}: ${v}${spec.unit ? ` ${spec.unit}` : ""}`}</title>
              </rect>
            );
          })}
          {series.length === 1 ? (
            <text x={x(series[0].values[i]) + 3} y={6 + rowH * i + rowH / 2 + 3} className="fill-muted-foreground text-[9px]">
              {fmt(series[0].values[i])}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}

function Pie({ spec }: { spec: ChartSpec }) {
  const cats = spec.categories ?? [];
  const values = spec.series?.[0]?.values ?? [];
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const cx = 110;
  const cy = H / 2;
  const r = 85;
  // slice start/end angles, from the top, clockwise
  const ends = values.map((_, i) => -Math.PI / 2 + (values.slice(0, i + 1).reduce((a, b) => a + b, 0) / total) * Math.PI * 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={spec.title}>
      {values.map((v, i) => {
        const a0 = i ? ends[i - 1] : -Math.PI / 2;
        const a1 = ends[i];
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const p = (a: number, rr: number) => `${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`;
        const d =
          values.length === 1
            ? `M${cx},${cy - r} A${r},${r} 0 1 1 ${cx - 0.01},${cy - r} L${cx - 0.01},${cy - r * 0.55} A${r * 0.55},${r * 0.55} 0 1 0 ${cx},${cy - r * 0.55} Z`
            : `M${p(a0, r)} A${r},${r} 0 ${large} 1 ${p(a1, r)} L${p(a1, r * 0.55)} A${r * 0.55},${r * 0.55} 0 ${large} 0 ${p(a0, r * 0.55)} Z`;
        return (
          <path key={i} d={d} fill={PALETTE[i % PALETTE.length]} stroke="var(--background)" strokeWidth={1}>
            <title>{`${cats[i]}: ${v}${spec.unit ? ` ${spec.unit}` : ""} (${((v / total) * 100).toFixed(1)}%)`}</title>
          </path>
        );
      })}
      {cats.slice(0, 10).map((c, i) => (
        <g key={`${c}-${i}`}>
          <rect x={215} y={20 + i * 19} width={9} height={9} rx={2} fill={PALETTE[i % PALETTE.length]} />
          <text x={229} y={28 + i * 19} className="fill-foreground text-[10px]">
            {short(c, 16)} · {((values[i] / total) * 100).toFixed(0)}%
          </text>
        </g>
      ))}
    </svg>
  );
}

function Scatter({ spec }: { spec: ChartSpec }) {
  const pts = spec.points ?? [];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const xt = niceTicks(Math.min(...xs), Math.max(...xs));
  const yt = niceTicks(Math.min(0, ...ys), Math.max(...ys));
  const pad = { l: 36, r: 10, t: 10, b: 28 };
  const x = (v: number) => pad.l + ((v - xt[0]) / (xt.at(-1)! - xt[0])) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - yt[0]) / (yt.at(-1)! - yt[0])) * (H - pad.t - pad.b);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={spec.title}>
      <Axes yTicks={yt} y={y} pad={pad} />
      {xt.map((t) => (
        <text key={t} x={x(t)} y={H - pad.b + 12} textAnchor="middle" className="fill-muted-foreground text-[9px]">
          {fmt(t)}
        </text>
      ))}
      {pts.map((p, i) => (
        <circle key={i} cx={x(p.x)} cy={y(p.y)} r={3.2} fill={PALETTE[0]} opacity={0.8}>
          <title>{`${p.label ? `${p.label}: ` : ""}${p.x}, ${p.y}`}</title>
        </circle>
      ))}
    </svg>
  );
}

export function ChartCard({ spec: asked }: { spec: ChartSpec }) {
  // many long names do not fit under vertical bars: draw them as horizontal bars instead
  const longNames = (asked.categories ?? []).length > 6 && Math.max(0, ...(asked.categories ?? []).map((c) => c.length)) > 10;
  const spec: ChartSpec = asked.type === "bar" && longNames ? { ...asked, type: "horizontal_bar" } : asked;
  const problem = checkChart(spec);
  const series = spec.series ?? [];
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card/40 p-3 font-sans text-[12px] text-foreground">
      <h2 className="flex items-center gap-1.5 text-sm font-bold tracking-tight">
        <BarChart3 className="size-4 text-primary" /> {spec.title}
      </h2>
      {problem ? (
        <p className="text-destructive">{problem}</p>
      ) : (
        <>
          {spec.y_label && spec.type !== "pie" && spec.type !== "horizontal_bar" ? (
            <p className="text-[11px] text-muted-foreground">
              {spec.y_label}
              {spec.unit ? ` (${spec.unit})` : ""}
            </p>
          ) : null}
          {spec.type === "pie" ? <Pie spec={spec} /> : spec.type === "horizontal_bar" ? <HorizontalBars spec={spec} /> : spec.type === "scatter" ? <Scatter spec={spec} /> : <Cartesian spec={spec} />}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {spec.type !== "pie" && series.length > 1
              ? series.map((s, k) => (
                  <span key={s.name} className="flex items-center gap-1">
                    <span className="size-2 rounded-full" style={{ background: PALETTE[k % PALETTE.length] }} />
                    {s.name}
                  </span>
                ))
              : null}
            {spec.x_label && spec.type !== "pie" ? <span className="ml-auto">{spec.x_label}</span> : null}
          </div>
        </>
      )}
      {spec.note ? <p className="text-[11px] text-muted-foreground">{spec.note}</p> : null}
      <p className="text-[11px] text-muted-foreground">Values from: {spec.source}. Drawn from numbers the assistant passed in; hover a mark for its value.</p>
    </div>
  );
}