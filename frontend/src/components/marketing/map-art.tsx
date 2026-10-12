import type { ReactNode } from "react";

/*
 * Self-contained SVG "map" art for the marketing page: a dark basemap plus one glowing layer
 * (hexbin, flood extent, route, link graph or antenna sectors). Everything is generated from a seed, so
 * the same tile renders the same picture on the server and the client, with no external assets.
 */

export type Pt = [number, number];

export type MapLayer = "hexbin" | "flood" | "route" | "graph" | "sector";

/** Colour ramps for map layers. Mirrors the `--mk-*` accent tokens in globals.css. */
export const RAMPS = {
  heat: ["#1b2a6b", "#3d8bff", "#a77bff", "#ff3ea5", "#ffb224"],
  magenta: ["#3a0f4f", "#a77bff", "#ff3ea5", "#ffd0ea"],
  cyan: ["#0a2a5c", "#2fb5ff", "#c9f2ff"],
  teal: ["#0b3b4a", "#19e6c1", "#c8fff1"],
  amber: ["#4a1d00", "#ff7a1a", "#ffb224", "#fff1c2"],
  blue: ["#101e4d", "#3d8bff", "#a77bff", "#e6dcff"],
} as const;

export type RampName = keyof typeof RAMPS;

export const STATUS = { up: "#3ddc84", degraded: "#ffb224", down: "#ff4d5e" } as const;

/** Mulberry32: tiny seeded PRNG built on integer math, so it is identical in every JS engine. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Round to one decimal to keep SVG markup small. */
export const f = (n: number) => Math.round(n * 10) / 10;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Sample a colour ramp at t ∈ [0, 1]. */
export function ramp(stops: readonly string[], t: number) {
  const seg = (stops.length - 1) * clamp01(t);
  const i = Math.min(Math.floor(seg), stops.length - 2);
  const k = seg - i;
  const a = hexToRgb(stops[i]);
  const b = hexToRgb(stops[i + 1]);
  const c = a.map((v, j) => Math.round(v + (b[j] - v) * k));
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}

/** Catmull-Rom spline through the points, as an SVG path. */
export function smoothPath(pts: Pt[], closed = false) {
  if (pts.length < 2) return "";
  const p = closed
    ? [pts[pts.length - 1], ...pts, pts[0], pts[1]]
    : [pts[0], ...pts, pts[pts.length - 1]];
  let d = `M${f(p[1][0])},${f(p[1][1])}`;
  for (let i = 1; i < p.length - 2; i++) {
    const [x0, y0] = p[i - 1];
    const [x1, y1] = p[i];
    const [x2, y2] = p[i + 1];
    const [x3, y3] = p[i + 2];
    d += `C${f(x1 + (x2 - x0) / 6)},${f(y1 + (y2 - y0) / 6)} ${f(x2 - (x3 - x1) / 6)},${f(y2 - (y3 - y1) / 6)} ${f(x2)},${f(y2)}`;
  }
  return closed ? `${d}Z` : d;
}

/** Irregular closed blob around a centre. */
function blob(cx: number, cy: number, rad: number, r: () => number, n = 10, jitter = 0.35): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = rad * (1 - jitter + r() * jitter * 2);
    return [cx + Math.cos(a) * k, cy + Math.sin(a) * k];
  });
}

type Blob = { x: number; y: number; sd: number; k: number };

function blobs(w: number, h: number, r: () => number, n: number, sd: [number, number]): Blob[] {
  return Array.from({ length: n }, () => ({
    x: w * (0.12 + r() * 0.76),
    y: h * (0.12 + r() * 0.76),
    sd: sd[0] + r() * (sd[1] - sd[0]),
    k: 0.55 + r() * 0.6,
  }));
}

const density = (bs: Blob[], x: number, y: number) =>
  bs.reduce((d, b) => d + b.k * Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2) / (2 * b.sd * b.sd)), 0);

/** Small rounded label used on the map (place names, readings). */
export function MapLabel({ x, y, text, color = "#fafafa", anchor = "start" }: { x: number; y: number; text: string; color?: string; anchor?: "start" | "middle" | "end" }) {
  const w = text.length * 5.1 + 12;
  const x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
  return (
    <g>
      <rect x={f(x0)} y={f(y - 8)} width={f(w)} height={16} rx={8} fill="#0a0a0a" fillOpacity={0.78} stroke="#ffffff" strokeOpacity={0.14} />
      <circle cx={f(x0 + 7)} cy={y} r={2.2} fill={color} />
      <text x={f(x0 + 12)} y={f(y + 3)} fontSize={8.5} fill="#fafafa" fillOpacity={0.92} fontWeight={500}>
        {text}
      </text>
    </g>
  );
}

/** Glowing dot: soft halo plus a bright core. */
function Dot({ x, y, color, r = 2.2, halo = 3 }: { x: number; y: number; color: string; r?: number; halo?: number }) {
  return (
    <g>
      <circle cx={f(x)} cy={f(y)} r={f(r * halo)} fill={color} fillOpacity={0.16} />
      <circle cx={f(x)} cy={f(y)} r={f(r)} fill={color} />
    </g>
  );
}

type Ctx = { w: number; h: number; uid: string; r: () => number; pal: readonly string[] };

/* ----------------------------------------------------------------------------------------- */
/* Basemap                                                                                    */
/* ----------------------------------------------------------------------------------------- */

/** Faint road network and an optional sea edge, like a dark vector basemap. */
export function Basemap({ w, h, seed, coast = false }: { w: number; h: number; seed: number; coast?: boolean }) {
  // Own PRNG per render: a shared one would advance on React's double render and break hydration.
  const r = rng(seed);
  const roads: { d: string; o: number; sw: number }[] = [];
  for (let i = 0; i < 13; i++) {
    const major = i < 3;
    const fromLeft = r() < 0.5;
    let x = fromLeft ? -10 : w * r();
    let y = fromLeft ? h * r() : -10;
    let a = fromLeft ? (r() - 0.5) * 0.9 : Math.PI / 2 + (r() - 0.5) * 0.9;
    const pts: Pt[] = [[x, y]];
    while (x > -40 && x < w + 40 && y > -40 && y < h + 40 && pts.length < 40) {
      const step = 28 + r() * 36;
      a += (r() - 0.5) * 0.55;
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
      pts.push([x, y]);
    }
    roads.push({ d: smoothPath(pts), o: major ? 0.11 : 0.04 + r() * 0.04, sw: major ? 1.4 : 0.5 + r() * 0.6 });
  }

  let sea: string | null = null;
  if (coast) {
    const pts: Pt[] = [[w * (0.55 + r() * 0.2), -20]];
    for (let t = 1; t <= 6; t++) pts.push([w * (0.6 + t * 0.07) + (r() - 0.5) * 30, (h * t) / 6 + (r() - 0.5) * 20]);
    sea = smoothPath(pts);
  }

  return (
    <g>
      {sea && (
        <>
          <path d={`${sea}L${w + 20},${h + 20}L${w + 20},-20Z`} fill="#050913" />
          <path d={sea} fill="none" stroke="#3d8bff" strokeOpacity={0.22} strokeWidth={1} />
        </>
      )}
      {roads.map((rd, i) => (
        <path key={i} d={rd.d} fill="none" stroke="#ffffff" strokeOpacity={Math.round(rd.o * 100) / 100} strokeWidth={f(rd.sw)} />
      ))}
    </g>
  );
}

/* ----------------------------------------------------------------------------------------- */
/* Layers                                                                                     */
/* ----------------------------------------------------------------------------------------- */

function hexbin({ w, h, r, pal }: Ctx) {
  const s = 8.5;
  const bs = blobs(w, h, r, 5, [26, 70]);
  const dx = s * Math.sqrt(3);
  const dy = s * 1.5;
  // Cells are bucketed into a few colour levels, each drawn as one path of relative hexagons,
  // which keeps the markup a fraction of one <path> per cell.
  const levels = 8;
  const k = s * 0.9;
  const hx = (k * Math.sqrt(3)) / 2;
  const tail = `l${f(hx)},${f(k / 2)}v${f(k)}l${f(-hx)},${f(k / 2)}l${f(-hx)},${f(-k / 2)}v${f(-k)}z`;
  const groups: string[] = Array(levels).fill("");
  for (let row = 0, y = 0; y < h + s; row++, y += dy) {
    for (let x = (row % 2) * (dx / 2); x < w + s; x += dx) {
      const d = density(bs, x, y) + (r() - 0.5) * 0.16;
      if (d < 0.13) continue;
      groups[Math.min(levels - 1, Math.floor(Math.min(1, d) * levels))] += `M${f(x)},${f(y - k)}${tail}`;
    }
  }
  return (
    <g>
      {groups.map((d, i) => {
        const t = (i + 0.5) / levels;
        return d ? <path key={i} d={d} fill={ramp(pal, t)} fillOpacity={f(0.28 + 0.72 * t)} /> : null;
      })}
    </g>
  );
}

function riverPoints(w: number, h: number, r: () => number): Pt[] {
  const pts: Pt[] = [];
  let y = h * (0.35 + r() * 0.3);
  for (let x = -20; x <= w + 40; x += 38) {
    y += (r() - 0.5) * 46;
    y = Math.max(h * 0.2, Math.min(h * 0.8, y));
    pts.push([x, y]);
  }
  return pts;
}

function flood({ w, h, r }: Ctx) {
  const river = riverPoints(w, h, r);
  const a = 2 + Math.floor(r() * 2);
  const b = Math.min(river.length - 2, a + 5 + Math.floor(r() * 3));
  const seg = river.slice(a, b + 1);
  const widths = seg.map((_, i) => (Math.sin((i / (seg.length - 1)) * Math.PI) * 0.85 + 0.15) * (34 + r() * 30));
  const upper = seg.map(([x, y], i): Pt => [x + (r() - 0.5) * 10, y - widths[i]]);
  const lower = seg.map(([x, y], i): Pt => [x + (r() - 0.5) * 10, y + widths[i] * (0.7 + r() * 0.5)]);
  const outer = smoothPath([...upper, ...lower.reverse()], true);
  const inner = smoothPath(
    seg.slice(1, -1).flatMap(([x, y], i) => [[x, y - widths[i + 1] * 0.45]] as Pt[]).concat(
      seg.slice(1, -1).reverse().map(([x, y], i): Pt => [x, y + widths[seg.length - 2 - i] * 0.4]),
    ),
    true,
  );
  const towers = Array.from({ length: 16 }, () => {
    const x = w * (0.05 + r() * 0.9);
    const y = h * (0.08 + r() * 0.84);
    const near = river.reduce((m, p) => Math.min(m, Math.hypot(p[0] - x, p[1] - y)), Infinity);
    const inZone = x > seg[0][0] && x < seg[seg.length - 1][0];
    const status = inZone && near < 42 ? "down" : inZone && near < 70 ? "degraded" : "up";
    return { x, y, status } as const;
  });
  const gauge = seg[Math.floor(seg.length / 2)];
  return (
    <g>
      <path d={outer} fill="#2fb5ff" fillOpacity={0.24} stroke="#6fd8ff" strokeOpacity={0.8} strokeWidth={1} />
      <path d={inner} fill="#2fb5ff" fillOpacity={0.3} />
      <path d={smoothPath(river)} fill="none" stroke="#2fb5ff" strokeWidth={2.2} strokeOpacity={0.85} />
      {towers.map((t, i) => (
        <g key={i}>
          {t.status === "down" && <circle cx={f(t.x)} cy={f(t.y)} r={9} fill="none" stroke={STATUS.down} strokeOpacity={0.6} className="mk-pulse" />}
          <Dot x={t.x} y={t.y} color={STATUS[t.status]} r={2.4} />
        </g>
      ))}
      <rect x={f(gauge[0] - 4)} y={f(gauge[1] - 4)} width={8} height={8} fill="#ffb224" transform={`rotate(45 ${f(gauge[0])} ${f(gauge[1])})`} />
      <MapLabel x={gauge[0] + 10} y={gauge[1] - 18} text="Gauge 4.2 m ▲" color="#ffb224" />
    </g>
  );
}

function route({ w, h, r }: Ctx) {
  const depot: Pt = [w * 0.12, h * 0.84];
  const sites: Pt[] = [
    [w * (0.5 + r() * 0.1), h * (0.45 + r() * 0.1)],
    [w * (0.7 + r() * 0.1), h * (0.25 + r() * 0.1)],
    [w * (0.8 + r() * 0.08), h * (0.52 + r() * 0.1)],
  ];
  const way: Pt[] = [depot, [w * 0.28, h * (0.62 + r() * 0.1)], [w * 0.4, h * 0.56], sites[0], [w * 0.62, h * 0.36], sites[1], [w * 0.86, h * 0.38], sites[2]];
  const d = smoothPath(way);
  return (
    <g>
      {sites.map(([x, y], i) => (
        <path key={i} d={smoothPath(blob(x, y, 42 + r() * 18, r), true)} fill="#2fb5ff" fillOpacity={0.16} stroke="#6fd8ff" strokeOpacity={0.35} />
      ))}
      <path d={d} fill="none" stroke="#ffb224" strokeOpacity={0.22} strokeWidth={7} strokeLinecap="round" />
      <path d={d} fill="none" stroke="#ffb224" strokeWidth={2} strokeDasharray="6 6" strokeLinecap="round" className="mk-dash" />
      {sites.map(([x, y], i) => (
        <g key={i}>
          <circle cx={f(x)} cy={f(y)} r={10} fill="none" stroke={STATUS.down} strokeOpacity={0.55} className="mk-pulse" />
          <Dot x={x} y={y} color={STATUS.down} r={3} />
        </g>
      ))}
      <rect x={f(depot[0] - 5)} y={f(depot[1] - 5)} width={10} height={10} rx={2} fill="#ffffff" />
      <MapLabel x={depot[0] + 10} y={depot[1] + 16} text="Boat crew B-2 · ETA 18 min" color="#ffb224" />
    </g>
  );
}

/** Towers scattered around a centre, each with a status. Shared by the radius tile and the Map & area demo. */
export function towerField(seed: number, cx: number, cy: number, spread: number, n: number) {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    // Sum of uniforms approximates a normal spread, denser in the middle like a city.
    const gx = (r() + r() + r() - 1.5) / 1.5;
    const gy = (r() + r() + r() - 1.5) / 1.5;
    const roll = r();
    return {
      id: i,
      x: cx + gx * spread,
      y: cy + gy * spread,
      status: (roll < 0.08 ? "down" : roll < 0.22 ? "degraded" : "up") as keyof typeof STATUS,
      subs: 900 + Math.floor(r() * 4200),
    };
  });
}

/** Dotted subscriber trail with Home / Weekday / Weekend pins. Shared with the Map & area demo. */
export function Trail({ pts, pins }: { pts: Pt[]; pins: { at: Pt; label: string; color: string }[] }) {
  return (
    <g>
      <path d={smoothPath(pts)} fill="none" stroke="#ff3ea5" strokeWidth={2.4} strokeDasharray="0.5 6" strokeLinecap="round" />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={f(x)} cy={f(y)} r={1.6} fill="#ffd0ea" />
      ))}
      {pins.map((p) => (
        <g key={p.label}>
          <circle cx={f(p.at[0])} cy={f(p.at[1])} r={8} fill={p.color} fillOpacity={0.2} />
          <circle cx={f(p.at[0])} cy={f(p.at[1])} r={4} fill={p.color} stroke="#0a0a0a" strokeWidth={1.5} />
          <MapLabel x={p.at[0] + 9} y={p.at[1] - 13} text={p.label} color={p.color} />
        </g>
      ))}
    </g>
  );
}

export const ROUTINE_COLORS = { Home: "#19e6c1", Weekday: "#3d8bff", Weekend: "#ffb224" } as const;

function graph({ w, h, r }: Ctx) {
  const c: Pt = [w * 0.48, h * 0.5];
  const R = Math.min(w, h) * 0.26;
  const linked = [
    { label: "Feeder F-12", color: "#ffb224" },
    { label: "Gauge KB-3", color: "#2fb5ff" },
    { label: "Hospital (synthetic)", color: "#ff4d5e" },
    { label: "Clinic (synthetic)", color: "#ff4d5e" },
    { label: "TWR-KB-027", color: "#3d8bff" },
    { label: "TWR-KB-035", color: "#3d8bff" },
    { label: "TWR-KB-040", color: "#3d8bff" },
  ].map((n, i, all) => {
    const a = (i / all.length) * Math.PI * 2 + r() * 0.3;
    const k = R * (0.85 + r() * 0.35);
    return { ...n, x: c[0] + Math.cos(a) * k, y: c[1] + Math.sin(a) * k * 0.9 };
  });
  const subsA = r() * Math.PI * 2;
  const subC: Pt = [c[0] + Math.cos(subsA) * R * 1.55, c[1] + Math.sin(subsA) * R * 1.35];
  return (
    <g>
      {linked.slice(4).map((n, i, arr) => {
        const m = arr[(i + 1) % arr.length];
        return <line key={i} x1={f(n.x)} y1={f(n.y)} x2={f(m.x)} y2={f(m.y)} stroke="#3d8bff" strokeOpacity={0.25} strokeDasharray="3 4" />;
      })}
      {linked.map((n, i) => (
        <line key={i} x1={f(c[0])} y1={f(c[1])} x2={f(n.x)} y2={f(n.y)} stroke={n.color} strokeOpacity={0.55} strokeWidth={1.2} />
      ))}
      <line x1={f(c[0])} y1={f(c[1])} x2={f(subC[0])} y2={f(subC[1])} stroke="#ff3ea5" strokeOpacity={0.4} strokeDasharray="2 4" />
      {Array.from({ length: 46 }, (_, i) => (
        <circle key={i} cx={f(subC[0] + (r() - 0.5) * 64)} cy={f(subC[1] + (r() - 0.5) * 48)} r={1.3} fill="#ff3ea5" fillOpacity={f(0.5 + r() * 0.5)} />
      ))}
      {linked.map((n, i) => (
        <g key={i}>
          <Dot x={n.x} y={n.y} color={n.color} r={4} />
          <MapLabel x={n.x + 8} y={n.y + (n.y > c[1] ? 14 : -14)} text={n.label} color={n.color} />
        </g>
      ))}
      <circle cx={f(c[0])} cy={f(c[1])} r={16} fill="none" stroke="#ff4d5e" strokeOpacity={0.6} className="mk-pulse" />
      <Dot x={c[0]} y={c[1]} color="#ffffff" r={5.5} halo={2.2} />
      <MapLabel x={subC[0]} y={subC[1] + 36} text="2,814 subscribers" color="#ff3ea5" anchor="middle" />
    </g>
  );
}

function wedge(cx: number, cy: number, az: number, half: number, rad: number) {
  const a0 = ((az - half) * Math.PI) / 180;
  const a1 = ((az + half) * Math.PI) / 180;
  return `M${f(cx)},${f(cy)}L${f(cx + Math.cos(a0) * rad)},${f(cy + Math.sin(a0) * rad)}A${f(rad)},${f(rad)} 0 0 1 ${f(cx + Math.cos(a1) * rad)},${f(cy + Math.sin(a1) * rad)}Z`;
}

function sector({ w, h, r }: Ctx) {
  const towers: Pt[] = [];
  for (let gy = 0; gy < 3; gy++) for (let gx = 0; gx < 3; gx++) towers.push([w * (0.2 + gx * 0.3) + (r() - 0.5) * 40, h * (0.2 + gy * 0.3) + (r() - 0.5) * 40]);
  const target = towers[4];
  return (
    <g>
      {towers.map(([x, y], i) => {
        const rot = r() * 120;
        const hot = i === 4;
        return (
          <g key={i}>
            {[0, 120, 240].map((az) =>
              hot ? (
                <g key={az}>
                  <path d={wedge(x, y, az + rot, 30, 64)} fill="none" stroke="#ff3ea5" strokeOpacity={0.55} strokeDasharray="3 3" />
                  <path d={wedge(x, y, az + rot, 30, 44)} fill="#ff3ea5" fillOpacity={0.3} stroke="#ff3ea5" />
                </g>
              ) : (
                <path key={az} d={wedge(x, y, az + rot, 30, 38)} fill="#3d8bff" fillOpacity={0.12} stroke="#3d8bff" strokeOpacity={0.35} />
              ),
            )}
            <Dot x={x} y={y} color={hot ? "#ffffff" : "#6aa6ff"} r={hot ? 3.2 : 2.2} />
          </g>
        );
      })}
      <g transform={`translate(${f(target[0] + 52)},${f(target[1] + 34)})`}>
        <rect x={-6} y={-6} width={12} height={12} rx={2} fill="#ff4d5e" />
        <path d="M-1.5,-4h3v2.5h2.5v3h-2.5v2.5h-3v-2.5h-2.5v-3h2.5z" fill="#fff" />
      </g>
      <MapLabel x={target[0]} y={target[1] - 76} text="Tilt −2° · twin sim" color="#ff3ea5" anchor="middle" />
    </g>
  );
}

const RENDER: Record<MapLayer, (ctx: Ctx) => ReactNode> = { hexbin, flood, route, graph, sector };

/* ----------------------------------------------------------------------------------------- */
/* Frame                                                                                      */
/* ----------------------------------------------------------------------------------------- */

/** Shared defs for a map frame: background, vignette and glow filter, scoped by `uid`. */
export function MapDefs({ uid }: { uid: string }) {
  return (
    <defs>
      <radialGradient id={`${uid}-bg`} cx="50%" cy="45%" r="75%">
        <stop offset="0" stopColor="#12141b" />
        <stop offset="1" stopColor="#060709" />
      </radialGradient>
      <radialGradient id={`${uid}-vig`} cx="50%" cy="50%" r="72%">
        <stop offset="0.6" stopColor="#000" stopOpacity={0} />
        <stop offset="1" stopColor="#000" stopOpacity={0.55} />
      </radialGradient>
      <filter id={`${uid}-glow`} x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur stdDeviation="2.4" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

type MapArtProps = {
  layer: MapLayer;
  seed: number;
  uid: string;
  w?: number;
  h: number;
  ramp?: RampName;
  coast?: boolean;
  /** Fill the box and crop, instead of letterboxing. */
  slice?: boolean;
  className?: string;
};

/** One generated map picture. Decorative: callers describe it in text next to it. */
export function MapArt({ layer, seed, uid, w = 400, h, ramp: rampName = "heat", coast, slice, className }: MapArtProps) {
  const ctx: Ctx = { w, h, uid, r: rng(seed), pal: RAMPS[rampName] };
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio={slice ? "xMidYMid slice" : undefined}
      className={className}
      aria-hidden="true"
      focusable="false"
      fontFamily="inherit"
    >
      <MapDefs uid={uid} />
      <rect width={w} height={h} fill={`url(#${uid}-bg)`} />
      <Basemap w={w} h={h} seed={seed + 1} coast={coast} />
      <g filter={`url(#${uid}-glow)`}>{RENDER[layer](ctx)}</g>
      <rect width={w} height={h} fill={`url(#${uid}-vig)`} pointerEvents="none" />
    </svg>
  );
}
