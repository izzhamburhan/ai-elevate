"use client";

import { useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Crosshair, Lock, LocateFixed, MapPin } from "lucide-react";

import { cn } from "@/lib/utils";

import { Basemap, MapDefs, MapLabel, ROUTINE_COLORS, STATUS, Trail, f, rng, towerField, type Pt } from "./map-art";
import { MockCard } from "./primitives";

const W = 400;
const H = 300;
/** The mock map spans 60 km across. */
const PX_PER_KM = W / 60;
const CENTRE: Pt = [W / 2, H / 2];

const CITIES = [
  { name: "Kota Bharu", code: "KB", seed: 301, coast: true, apps: [["Messaging", 34], ["Video streaming", 27], ["Social", 18]] },
  { name: "KLCC", code: "KL", seed: 302, coast: false, apps: [["Video streaming", 31], ["Social", 24], ["E-wallet", 15]] },
  { name: "Johor Bahru", code: "JB", seed: 303, coast: true, apps: [["Maps", 29], ["Messaging", 26], ["Video streaming", 21]] },
  { name: "George Town", code: "GT", seed: 304, coast: true, apps: [["Social", 30], ["Video streaming", 25], ["Food delivery", 14]] },
  { name: "Kuching", code: "KCH", seed: 305, coast: false, apps: [["Messaging", 33], ["Social", 22], ["Gaming", 16]] },
  { name: "Kota Kinabalu", code: "KK", seed: 306, coast: true, apps: [["Video streaming", 28], ["Messaging", 27], ["Maps", 13]] },
] as const;

/** Interactive mock of the Map & area card: place picker, radius slider, towers, trail and routines. */
export function AreaDemo() {
  const [cityIndex, setCityIndex] = useState(0);
  const [radiusKm, setRadiusKm] = useState(8);
  const [centre, setCentre] = useState<Pt>(CENTRE);
  const [picking, setPicking] = useState(false);

  const city = CITIES[cityIndex];
  const R = radiusKm * PX_PER_KM;
  const towers = useMemo(() => towerField(city.seed, CENTRE[0], CENTRE[1], 170, 220), [city.seed]);

  const inside = towers.filter((t) => Math.hypot(t.x - centre[0], t.y - centre[1]) <= R);
  const degraded = inside.filter((t) => t.status === "degraded").length;
  const down = inside.filter((t) => t.status === "down").length;
  const people = Math.round(inside.reduce((n, t) => n + t.subs, 0) / 100) * 100;

  // One synthetic subscriber's last 4 weeks, as a walk around the circle centre.
  const trail = useMemo(() => {
    const r = rng(city.seed + 7);
    const pts: Pt[] = [];
    let x = -0.7;
    let y = 0.4;
    for (let i = 0; i < 12; i++) {
      pts.push([x, y]);
      x += 0.1 + r() * 0.06;
      y += (r() - 0.6) * 0.3;
    }
    return pts;
  }, [city.seed]);
  const scale = Math.max(R * 0.8, 100);
  const trailPts = trail.map(([x, y]): Pt => [centre[0] + x * scale, centre[1] + y * scale]);

  const moveTo = (p: Pt) => setCentre([Math.max(0, Math.min(W, p[0])), Math.max(0, Math.min(H, p[1]))]);

  const onMapClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!picking) return;
    const box = e.currentTarget.getBoundingClientRect();
    moveTo([((e.clientX - box.left) / box.width) * W, ((e.clientY - box.top) / box.height) * H]);
    setPicking(false);
  };

  const onMapKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!picking) return;
    const step = 10;
    const delta: Record<string, Pt> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (delta[e.key]) {
      e.preventDefault();
      moveTo([centre[0] + delta[e.key][0], centre[1] + delta[e.key][1]]);
    } else if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      setPicking(false);
    }
  };

  const routines = [
    { label: "Home", cell: `${city.code}-112`, when: "21 nights", color: ROUTINE_COLORS.Home },
    { label: "Weekday", cell: `${city.code}-047`, when: "17 days", color: ROUTINE_COLORS.Weekday },
    { label: "Weekend", cell: `${city.code}-205`, when: "6 days", color: ROUTINE_COLORS.Weekend },
  ];

  return (
    <MockCard className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-mk-line px-4 py-3 text-sm font-medium text-mk-fg">
        <span className="grid size-7 place-items-center rounded-lg bg-mk-blue/15 text-mk-blue">
          <MapPin className="size-3.5" aria-hidden="true" />
        </span>
        Map &amp; area
      </div>

      <div className="space-y-4 p-4">
        {/* Place picker */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative inline-flex h-9 items-center rounded-full border border-mk-line-strong bg-mk-fg/[0.03] pr-3 pl-3.5 text-sm text-mk-fg has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-(--ring)">
            <span className="sr-only">City</span>
            <select
              value={cityIndex}
              onChange={(e) => {
                setCityIndex(Number(e.target.value));
                setCentre(CENTRE);
              }}
              className="cursor-pointer appearance-none bg-transparent pr-1 focus-visible:outline-none"
            >
              {CITIES.map((c, i) => (
                <option key={c.name} value={i} className="bg-mk-raised">
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setCentre(CENTRE)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-mk-line px-3 text-xs text-mk-muted transition-colors hover:border-mk-line-strong hover:text-mk-fg"
          >
            <LocateFixed className="size-3.5" aria-hidden="true" />
            Use map centre
          </button>
          <button
            type="button"
            aria-pressed={picking}
            onClick={() => setPicking((p) => !p)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors",
              picking ? "border-transparent bg-mk-fg text-mk-on-fg" : "border-mk-line text-mk-muted hover:border-mk-line-strong hover:text-mk-fg",
            )}
          >
            <Crosshair className="size-3.5" aria-hidden="true" />
            {picking ? "Click the map…" : "Pick on map"}
          </button>
        </div>

        {/* Radius slider */}
        <div>
          <div className="flex items-center justify-between text-xs">
            <label htmlFor="area-radius" className="text-mk-muted">
              Radius
            </label>
            <span className="font-medium text-mk-fg tabular-nums">{radiusKm} km</span>
          </div>
          <input
            id="area-radius"
            type="range"
            min={1}
            max={50}
            value={radiusKm}
            onChange={(e) => setRadiusKm(Number(e.target.value))}
            className="mt-2 h-1.5 w-full cursor-pointer accent-mk-blue"
          />
        </div>

        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Towers" value={inside.length} />
          <Stat label="Degraded" value={degraded} className="text-mk-amber" />
          <Stat label="Down" value={down} className="text-mk-red" />
          <Stat label="People (est.)" value={people ? people.toLocaleString("en-US") : "—"} />
        </dl>

        {/* Map */}
        <div
          role="group"
          aria-label={picking ? "Map. Click, or use the arrow keys, to move the circle. Press Enter when done." : `Map of ${city.name} with a ${radiusKm} km circle`}
          tabIndex={picking ? 0 : -1}
          onClick={onMapClick}
          onKeyDown={onMapKey}
          className={cn("relative overflow-hidden rounded-xl border border-mk-line", picking && "cursor-crosshair ring-2 ring-mk-blue/60")}
        >
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-hidden="true" fontFamily="inherit">
            <MapDefs uid="area" />
            <rect width={W} height={H} fill="url(#area-bg)" />
            <Basemap w={W} h={H} seed={city.seed} coast={city.coast} />
            <defs>
              <radialGradient id="area-circle">
                <stop offset="0" stopColor="#3d8bff" stopOpacity={0.04} />
                <stop offset="1" stopColor="#3d8bff" stopOpacity={0.22} />
              </radialGradient>
            </defs>
            <g filter="url(#area-glow)">
              {towers.map((t) => {
                const isIn = Math.hypot(t.x - centre[0], t.y - centre[1]) <= R;
                return isIn ? (
                  <circle key={t.id} cx={f(t.x)} cy={f(t.y)} r={2.2} fill={STATUS[t.status]} />
                ) : (
                  <circle key={t.id} cx={f(t.x)} cy={f(t.y)} r={1.3} fill="#fff" fillOpacity={0.2} />
                );
              })}
              <Trail
                pts={trailPts}
                pins={[
                  { at: trailPts[0], label: "Home", color: ROUTINE_COLORS.Home },
                  { at: trailPts[6], label: "Weekday", color: ROUTINE_COLORS.Weekday },
                  { at: trailPts[11], label: "Weekend", color: ROUTINE_COLORS.Weekend },
                ]}
              />
            </g>
            <circle
              cx={f(centre[0])}
              cy={f(centre[1])}
              r={f(R)}
              fill="url(#area-circle)"
              stroke="#6aa6ff"
              strokeWidth={1.3}
              strokeDasharray="4 4"
              className="transition-[r] duration-200"
            />
            <path d={`M${f(centre[0] - 6)},${f(centre[1])}h12M${f(centre[0])},${f(centre[1] - 6)}v12`} stroke="#fff" strokeWidth={1.2} />
            <MapLabel x={centre[0]} y={Math.max(12, centre[1] - R - 12)} text={`${city.name} · ${radiusKm} km`} color="#6aa6ff" anchor="middle" />
            <rect width={W} height={H} fill="url(#area-vig)" pointerEvents="none" />
          </svg>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-mk-muted">Top apps here</p>
            <ul className="mt-2 space-y-2">
              {city.apps.map(([name, pct]) => (
                <li key={name} className="text-xs">
                  <div className="flex justify-between text-mk-fg">
                    <span>{name}</span>
                    <span className="tabular-nums text-mk-muted">{pct}%</span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-mk-fg/[0.06]">
                    <div className="h-full rounded-full bg-linear-to-r from-mk-violet to-mk-magenta" style={{ width: `${pct * 2.4}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium text-mk-muted">Routines · last 4 weeks · sub_••••3f9a</p>
            <ul className="mt-2 space-y-1.5">
              {routines.map((rt) => (
                <li key={rt.label} className="flex items-center gap-2 text-xs text-mk-fg">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: rt.color }} aria-hidden="true" />
                  <span className="w-16 font-medium">{rt.label}</span>
                  <span className="font-mono text-mk-muted">cell {rt.cell}</span>
                  <span className="ml-auto text-mk-muted">{rt.when}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="flex items-center gap-2 border-t border-mk-line pt-3 text-xs text-mk-muted">
          <Lock className="size-3.5 shrink-0 text-mk-green" aria-hidden="true" />
          Hashed IDs · cell-level location only · groups under 5 withheld
        </p>
      </div>
    </MockCard>
  );
}

function Stat({ label, value, className }: { label: string; value: number | string; className?: string }) {
  return (
    <div className="rounded-xl border border-mk-line bg-mk-fg/[0.02] px-3 py-2.5">
      <dt className="text-[11px] text-mk-muted">{label}</dt>
      <dd className={cn("mt-0.5 text-lg font-semibold tracking-tight text-mk-fg tabular-nums", className)}>{value}</dd>
    </div>
  );
}
