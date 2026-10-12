import { rng, type Pt } from "./map-art";

/*
 * Cinematic hero scene, standing in for Ideogram's full-bleed photography: a city at night in a
 * storm, seen at a low pitch like kepler.gl's 3D view. Extruded hex cells rise from the plane, a
 * flooded river cuts through, and arcs link the tallest towers. Pure SVG from a seed.
 */

const W = 1600;
const H = 1000;
const HORIZON = 430;
const FOCAL = 560;
const CAM_Y = 1.5;
const FOG = [11, 14, 30] as const;

/** Perspective projection of a world point (x right, y up, z away from the camera). */
const project = (x: number, y: number, z: number): Pt => [W / 2 + (x * FOCAL) / z, HORIZON + ((CAM_Y - y) * FOCAL) / z];

const pts = (p: Pt[]) => p.map(([x, y], i) => `${i ? "L" : "M"}${Math.round(x)},${Math.round(y)}`).join("") + "Z";

const STOPS = [
  [42, 27, 110],
  [109, 61, 245],
  [208, 21, 127],
  [255, 122, 26],
  [255, 214, 140],
] as const;

/** Height ramp (violet → magenta → amber), darkened by `shade` and faded into fog by `fog`. */
function color(t: number, shade: number, fog: number) {
  const seg = Math.min(STOPS.length - 1.001, Math.max(0, t) * (STOPS.length - 1));
  const i = Math.floor(seg);
  const k = seg - i;
  const c = STOPS[i].map((v, j) => (v + (STOPS[i + 1][j] - v) * k) * shade);
  const m = c.map((v, j) => Math.round(v + (FOG[j] - v) * fog));
  return `rgb(${m[0]} ${m[1]} ${m[2]})`;
}

// City cores sit right of centre, leaving the left side calm for the headline.
const CLUSTERS = [
  { x: 2.9, z: 5.2, r: 1.5, k: 1.15 },
  { x: 5.6, z: 8.8, r: 2, k: 0.9 },
  { x: 0.8, z: 11, r: 2.6, k: 0.7 },
  { x: 4.2, z: 3.2, r: 0.7, k: 0.6 },
  { x: -4.5, z: 13, r: 3, k: 0.45 },
];

const density = (x: number, z: number) =>
  CLUSTERS.reduce((d, c) => {
    const q = ((x - c.x) ** 2 + (z - c.z) ** 2) / (c.r * c.r);
    return d + c.k / (1 + q * 1.6) ** 2;
  }, 0);

// The river enters bottom-right and bends towards the horizon, away from the headline on the left.
const riverX = (z: number) => 0.7 + 1.2 * Math.sin(z * 0.42 + 0.6);
const riverW = (z: number) => 0.28 + 0.7 * Math.exp(-((z - 6.5) ** 2) / 6);

const S = 0.26;
const HEX: Pt[] = Array.from({ length: 6 }, (_, i) => {
  const a = (i * Math.PI) / 3;
  return [Math.cos(a) * S, Math.sin(a) * S];
});

export function HeroArt({ className, uid = "hero" }: { className?: string; uid?: string }) {
  const r = rng(2024);

  // Extruded cells, far to near so nearer prisms paint over farther ones.
  const cells: { x: number; z: number; t: number }[] = [];
  for (let z = 1.8; z < 20; z += (S * Math.sqrt(3)) / 2) {
    const row = Math.round(z / ((S * Math.sqrt(3)) / 2));
    for (let x = -2 * z + (row % 2) * S * 1.5; x < 2 * z; x += S * 3) {
      const d = density(x, z) + (r() - 0.5) * 0.18;
      if (d < 0.3 || Math.abs(x - riverX(z)) < riverW(z) + 0.2) continue;
      cells.push({ x, z, t: Math.min(1, d) });
    }
  }
  cells.sort((a, b) => b.x * b.x + b.z * b.z - (a.x * a.x + a.z * a.z));

  const tops: { p: Pt; height: number }[] = [];
  const prisms = cells.map((c, idx) => {
    const height = c.t ** 1.6 * 2.1 + 0.04;
    const fog = Math.min(0.85, Math.max(0, (c.z - 2.5) / 15) ** 1.1);
    const base = HEX.map(([dx, dz]): [number, number] => [c.x + dx, c.z + dz]);
    const faces = base.map((a, i) => {
      const b = base[(i + 1) % 6];
      const mx = (a[0] + b[0]) / 2;
      const mz = (a[1] + b[1]) / 2;
      const nx = mx - c.x;
      const nz = mz - c.z;
      // Back faces are hidden by the prism itself.
      if (nx * -mx + nz * -mz <= 0) return null;
      const light = 0.5 + 0.5 * ((nx * -0.6 + nz * -0.8) / S);
      const shade = 0.28 + 0.42 * light;
      return (
        <path
          key={i}
          d={pts([project(a[0], 0, a[1]), project(b[0], 0, b[1]), project(b[0], height, b[1]), project(a[0], height, a[1])])}
          fill={color(c.t, shade, fog)}
          stroke="#000"
          strokeOpacity={0.25}
          strokeWidth={0.6}
        />
      );
    });
    const top = project(c.x, height, c.z);
    if (c.z < 11) tops.push({ p: top, height });

    // Lit floors on the tall near towers: one dashed stroke per floor, per visible face.
    let windows = "";
    if (height > 0.7 && c.z < 9) {
      base.forEach((a, i) => {
        const b = base[(i + 1) % 6];
        const mx = (a[0] + b[0]) / 2;
        const mz = (a[1] + b[1]) / 2;
        if ((mx - c.x) * -mx + (mz - c.z) * -mz <= 0) return;
        const ax = a[0] + (b[0] - a[0]) * 0.15;
        const az = a[1] + (b[1] - a[1]) * 0.15;
        const bx = a[0] + (b[0] - a[0]) * 0.85;
        const bz = a[1] + (b[1] - a[1]) * 0.85;
        for (let y = 0.14; y < height - 0.06; y += 0.13) {
          const [x1, y1] = project(ax, y, az);
          const [x2, y2] = project(bx, y, bz);
          windows += `M${Math.round(x1)},${Math.round(y1)}L${Math.round(x2)},${Math.round(y2)}`;
        }
      });
    }

    return (
      <g key={idx}>
        {faces}
        {windows && <path d={windows} stroke="#ffd9a3" strokeOpacity={0.5 * (1 - fog)} strokeWidth={Math.max(0.8, 2.2 / c.z)} strokeDasharray="2 3" fill="none" />}
        {height < CAM_Y && (
          <path d={pts(base.map(([x, z]) => project(x, height, z)))} fill={color(Math.min(1, c.t + 0.15), 1, fog)} stroke="#fff" strokeOpacity={0.22} strokeWidth={0.7} />
        )}
      </g>
    );
  });

  // Flooded river on the ground plane.
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let z = 1.3; z < 40; z *= 1.08) {
    left.push(project(riverX(z) - riverW(z), 0, z));
    right.push(project(riverX(z) + riverW(z), 0, z));
  }
  const river = pts([...left, ...right.reverse()]);

  // Ground grid that converges on the horizon.
  const grid: string[] = [];
  for (let x = -24; x <= 24; x += 1.2) {
    const [ax, ay] = project(x, 0, 1.2);
    const [bx, by] = project(x, 0, 60);
    grid.push(`M${Math.round(ax)},${Math.round(ay)}L${Math.round(bx)},${Math.round(by)}`);
  }
  for (let z = 1.5; z < 40; z *= 1.22) {
    const [ax, ay] = project(-40, 0, z);
    const [bx] = project(40, 0, z);
    grid.push(`M${Math.round(ax)},${Math.round(ay)}H${Math.round(bx)}`);
  }

  // Arcs between the tallest near towers, left to right.
  const arcTops = [...tops]
    .sort((a, b) => b.height - a.height)
    .map((t) => t.p)
    .reduce<Pt[]>((kept, p) => (kept.length < 7 && kept.every((k) => Math.abs(k[0] - p[0]) > 110) ? [...kept, p] : kept), [])
    .sort((a, b) => a[0] - b[0]);
  const arcs = arcTops.slice(1).map((b, i) => {
    const a = arcTops[i];
    const lift = 50 + Math.abs(a[0] - b[0]) * 0.45;
    return `M${Math.round(a[0])},${Math.round(a[1])}Q${Math.round((a[0] + b[0]) / 2)},${Math.round(Math.min(a[1], b[1]) - lift)} ${Math.round(b[0])},${Math.round(b[1])}`;
  });

  const rain = Array.from({ length: 140 }, () => {
    const x = r() * (W + 200) - 100;
    const y = r() * H;
    const len = 18 + r() * 34;
    return `M${Math.round(x)},${Math.round(y)}l${Math.round(-len * 0.28)},${Math.round(len)}`;
  }).join("");

  const stars = Array.from({ length: 50 }, () => [r() * W, r() * HORIZON * 0.8, r()] as const);

  // Street lights: a carpet of small points around each city core, smaller with distance.
  const lights = CLUSTERS.flatMap((c) =>
    Array.from({ length: Math.round(90 * c.k) }, () => {
      const a = r() * Math.PI * 2;
      const d = c.r * 1.8 * Math.sqrt(r());
      const z = c.z + Math.sin(a) * d;
      const x = c.x + Math.cos(a) * d;
      if (z < 1.6 || Math.abs(x - riverX(z)) < riverW(z)) return null;
      const [sx, sy] = project(x, 0, z);
      return { sx, sy, rad: Math.max(0.9, 7 / z), warm: r() < 0.7 };
    }),
  ).filter((l) => l !== null);

  // Forked lightning over the far city.
  const bolt: Pt[] = [[1180, 40]];
  for (let i = 0; i < 9; i++) bolt.push([bolt[i][0] + (r() - 0.45) * 46, bolt[i][1] + 26 + r() * 18]);
  const fork: Pt[] = [bolt[4]];
  for (let i = 0; i < 4; i++) fork.push([fork[i][0] + 18 + r() * 22, fork[i][1] + 18 + r() * 14]);
  const line = (p: Pt[]) => p.map(([x, y], i) => `${i ? "L" : "M"}${Math.round(x)},${Math.round(y)}`).join("");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#04050a" />
          <stop offset="0.38" stopColor="#0d1124" />
          <stop offset="0.45" stopColor="#1a1436" />
          <stop offset="0.6" stopColor="#090b16" />
          <stop offset="1" stopColor="#050609" />
        </linearGradient>
        <radialGradient id={`${uid}-dome`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#d0157f" stopOpacity="0.42" />
          <stop offset="0.5" stopColor="#6d3df5" stopOpacity="0.18" />
          <stop offset="1" stopColor="#6d3df5" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}-river`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6fd8ff" stopOpacity="0.15" />
          <stop offset="1" stopColor="#2fb5ff" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id={`${uid}-arc`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#bd9fff" />
          <stop offset="1" stopColor="#6fd8ff" />
        </linearGradient>
        <linearGradient id={`${uid}-fog`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.38" stopColor="#0b0e1e" stopOpacity="0" />
          <stop offset="0.44" stopColor="#141029" stopOpacity="0.85" />
          <stop offset="0.6" stopColor="#0b0e1e" stopOpacity="0" />
        </linearGradient>
        <filter id={`${uid}-glow`} x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect width={W} height={H} fill={`url(#${uid}-sky)`} />
      {stars.map(([x, y, o], i) => (
        <circle key={i} cx={Math.round(x)} cy={Math.round(y)} r={o > 0.9 ? 1.4 : 0.8} fill="#fff" opacity={0.15 + o * 0.35} />
      ))}
      <ellipse cx={W / 2 + 60} cy={HORIZON + 10} rx={980} ry={240} fill={`url(#${uid}-dome)`} />
      <g fill="none" stroke="#efe9ff" strokeLinejoin="round" filter={`url(#${uid}-glow)`} opacity={0.45}>
        <path d={line(bolt)} strokeWidth={2} />
        <path d={line(fork)} strokeWidth={1.1} />
      </g>

      <path d={grid.join("")} stroke="#bd9fff" strokeOpacity={0.07} strokeWidth={1} fill="none" />
      <path d={river} fill={`url(#${uid}-river)`} filter={`url(#${uid}-glow)`} />
      <g filter={`url(#${uid}-glow)`}>
        {lights.map((l, i) => (
          <circle key={i} cx={Math.round(l.sx)} cy={Math.round(l.sy)} r={Math.round(l.rad * 10) / 10} fill={l.warm ? "#ffc27a" : "#c9b3ff"} opacity={0.85} />
        ))}
      </g>

      <g filter={`url(#${uid}-glow)`}>{prisms}</g>

      <g fill="none" filter={`url(#${uid}-glow)`}>
        {arcs.map((d, i) => (
          <path key={i} d={d} stroke={`url(#${uid}-arc)`} strokeWidth={1.6} strokeOpacity={0.85} strokeLinecap="round" />
        ))}
        {arcTops.map(([x, y], i) => (
          <circle key={i} cx={Math.round(x)} cy={Math.round(y)} r={3} fill="#f3eaff" />
        ))}
      </g>

      <rect width={W} height={H} fill={`url(#${uid}-fog)`} />
      <path d={rain} stroke="#dfe7ff" strokeOpacity={0.09} strokeWidth={1} />
    </svg>
  );
}
