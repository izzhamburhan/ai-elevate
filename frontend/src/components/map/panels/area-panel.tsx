"use client";

import { useState } from "react";
import { useStore } from "react-redux";
import { Crosshair, Loader2, Route, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { runKeplerCommand } from "@/lib/kepler/commands";
import { cn } from "@/lib/utils";

import { MAP_ID, type makeKeplerStore } from "../kepler-store";

type KeplerStore = ReturnType<typeof makeKeplerStore>;

type Tower = { enodeb_name: string; town: string; state: string; lat: number; lng: number; status: string; distance_km: number };
type Subscriber = {
  msisdn_hash: string;
  enodeb_name: string;
  serving_cell: string;
  attached: boolean;
  latest_label: string;
  cell_changes_24h: number;
};
type Segment = { serving_cell: string; enodeb_name: string; cell_lat: number; cell_lng: number; arrived_at: string; left_at: string | null; duration_min: number };
type AppRow = { rank: number; name: string; category: string; users_est: number; reach_pct: number; data_share_pct: number };

type Area = {
  towers: Tower[];
  subscribers: Subscriber[];
  subscribersTotal: number;
  subscribersEst: number;
  apps: AppRow[];
  busiestHour: number | null;
};

const PRESETS = [
  { label: "Kota Bharu (flood story)", lat: 6.125, lng: 102.24, radius: 8 },
  { label: "KLCC, Kuala Lumpur", lat: 3.157, lng: 101.713, radius: 5 },
  { label: "Johor Bahru", lat: 1.492, lng: 103.741, radius: 8 },
  { label: "George Town", lat: 5.415, lng: 100.328, radius: 6 },
  { label: "Kuching", lat: 1.553, lng: 110.359, radius: 8 },
  { label: "Kota Kinabalu", lat: 5.981, lng: 116.073, radius: 8 },
];

const STATUS_COLOR: Record<string, string> = { UP: "#22c55e", DEGRADED: "#f59e0b", DOWN: "#ef4444" };
const LABEL_STYLE: Record<string, string> = {
  GOOD: "bg-emerald-500/15 text-emerald-500",
  FAIR: "bg-amber-500/15 text-amber-500",
  POOR: "bg-orange-500/15 text-orange-500",
  NO_SERVICE: "bg-red-500/15 text-red-500",
};

async function menara<T>(tool: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/menara/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${tool} failed (${res.status})`);
  return body.data as T;
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Bounding box of a circle: [west, south, east, north]. */
function circleBounds(lat: number, lng: number, km: number): [number, number, number, number] {
  const dLat = km / 111;
  const dLng = km / (111 * Math.cos((lat * Math.PI) / 180));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-lg border bg-card px-2.5 py-1.5">
      <div className={cn("text-sm font-semibold tabular-nums", tone)}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

/** Map & Area: pick a place and radius, see the towers, people and apps inside it, and follow one subscriber's trail. */
export function AreaPanel() {
  const store = useStore() as unknown as KeplerStore;
  const [place, setPlace] = useState(0);
  const [lat, setLat] = useState(PRESETS[0].lat);
  const [lng, setLng] = useState(PRESETS[0].lng);
  const [radius, setRadius] = useState(PRESETS[0].radius);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [area, setArea] = useState<Area | null>(null);
  const [trail, setTrail] = useState<{ hash: string; segments: Segment[] } | null>(null);

  const drawn = (ids: string[]) => {
    for (const id of ids) {
      try {
        runKeplerCommand(store, MAP_ID, "remove_layer", { layerId: id });
      } catch {
        /* already gone */
      }
    }
  };
  const dropDataset = (dataId: string) => {
    try {
      runKeplerCommand(store, MAP_ID, "remove_dataset", { dataId });
    } catch {
      /* not loaded */
    }
  };

  const clearMap = () => {
    const layers = (runKeplerCommand(store, MAP_ID, "get_map_state", {}) as { layers: { id: string; dataId: string }[] }).layers;
    for (const layer of layers) {
      if (layer.dataId.startsWith("area_") || layer.dataId.startsWith("trail_")) drawn([layer.id]);
    }
    for (const id of ["area_up", "area_degraded", "area_down", "trail_stops", "trail_lines"]) dropDataset(id);
  };

  const drawTowers = async (towers: Tower[]) => {
    for (const status of ["UP", "DEGRADED", "DOWN"]) {
      const rows = towers.filter((t) => t.status === status).map((t) => ({ name: t.enodeb_name, lat: t.lat, lng: t.lng, status: t.status }));
      if (!rows.length) continue;
      const dataId = `area_${status.toLowerCase()}`;
      await runKeplerCommand(store, MAP_ID, "load_data", { rows, label: `Towers ${status}`, dataId, centerMap: false, autoCreateLayers: false });
      await runKeplerCommand(store, MAP_ID, "add_layer", {
        dataId,
        type: "point",
        label: `Towers ${status}`,
        columns: { lat: "lat", lng: "lng" },
        color: STATUS_COLOR[status],
        radius: status === "UP" ? 8 : 12,
      });
    }
  };

  const search = async () => {
    setBusy(true);
    setError(null);
    setTrail(null);
    try {
      const [towersData, subsData, appsData] = await Promise.all([
        menara<{ towers: Tower[] }>("tower_list_in_radius", { lat, lng, radius_km: radius, limit: 200 }),
        menara<{ subscribers: Subscriber[]; subscribers_total: number; subscribers_est_total: number }>("user_list_in_area", {
          lat,
          lng,
          radius_km: radius,
          limit: 40,
        }),
        menara<{ apps: AppRow[]; busiest_hour: number | null }>("usage_top_apps_in_area", { lat, lng, radius_km: radius, limit: 5 }).catch(() => ({
          apps: [],
          busiest_hour: null,
        })),
      ]);
      clearMap();
      await drawTowers(towersData.towers);
      runKeplerCommand(store, MAP_ID, "set_view", { bounds: circleBounds(lat, lng, radius) });
      setArea({
        towers: towersData.towers,
        subscribers: subsData.subscribers ?? [],
        subscribersTotal: subsData.subscribers_total ?? 0,
        subscribersEst: subsData.subscribers_est_total ?? 0,
        apps: appsData.apps ?? [],
        busiestHour: appsData.busiest_hour ?? null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const showTrail = async (hash: string) => {
    setError(null);
    try {
      const data = await menara<{ segments: Segment[] }>("user_get_trail", { msisdn_hash: hash, window_min: 1440 });
      const segments = data.segments ?? [];
      setTrail({ hash, segments });
      for (const id of ["trail_stops", "trail_lines"]) dropDataset(id);
      const layers = (runKeplerCommand(store, MAP_ID, "get_map_state", {}) as { layers: { id: string; dataId: string }[] }).layers;
      drawn(layers.filter((l) => l.dataId.startsWith("trail_")).map((l) => l.id));
      if (!segments.length) return;
      await runKeplerCommand(store, MAP_ID, "load_data", {
        rows: segments.map((s, i) => ({ order: i + 1, cell: s.serving_cell, lat: s.cell_lat, lng: s.cell_lng })),
        label: "Trail stops",
        dataId: "trail_stops",
        centerMap: false,
        autoCreateLayers: false,
      });
      await runKeplerCommand(store, MAP_ID, "add_layer", {
        dataId: "trail_stops",
        type: "point",
        label: "Trail stops",
        columns: { lat: "lat", lng: "lng" },
        color: "#7c5cff",
        radius: 16,
      });
      if (segments.length > 1) {
        await runKeplerCommand(store, MAP_ID, "load_data", {
          rows: segments.slice(1).map((s, i) => ({ lat0: segments[i].cell_lat, lng0: segments[i].cell_lng, lat1: s.cell_lat, lng1: s.cell_lng })),
          label: "Trail",
          dataId: "trail_lines",
          centerMap: false,
          autoCreateLayers: false,
        });
        await runKeplerCommand(store, MAP_ID, "add_layer", {
          dataId: "trail_lines",
          type: "line",
          label: "Trail",
          columns: { lat0: "lat0", lng0: "lng0", lat1: "lat1", lng1: "lng1" },
          color: "#7c5cff",
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const counts = area ? { UP: 0, DEGRADED: 0, DOWN: 0, ...Object.fromEntries(Object.entries(Object.groupBy(area.towers, (t) => t.status)).map(([k, v]) => [k, v?.length ?? 0])) } : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-3 font-sans text-foreground">
      <h2 className="truncate text-base font-bold tracking-tight">Map &amp; area</h2>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <select
            value={place}
            onChange={(e) => {
              const index = Number(e.target.value);
              setPlace(index);
              setLat(PRESETS[index].lat);
              setLng(PRESETS[index].lng);
              setRadius(PRESETS[index].radius);
            }}
            className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-2 text-[13px]"
            aria-label="Place"
          >
            {PRESETS.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="icon"
            className="size-9 shrink-0"
            title="Use the current map centre"
            onClick={() => {
              const state = runKeplerCommand(store, MAP_ID, "get_map_state", {}) as { view: { latitude: number; longitude: number } };
              setLat(Number(state.view.latitude.toFixed(4)));
              setLng(Number(state.view.longitude.toFixed(4)));
            }}
          >
            <Crosshair className="size-4" />
          </Button>
        </div>
        <div className="flex gap-2 text-[13px]">
          <label className="flex flex-1 items-center gap-1.5 text-muted-foreground">
            Lat
            <input type="number" step="0.001" value={lat} onChange={(e) => setLat(Number(e.target.value))} className="h-8 w-full min-w-0 rounded-md border bg-background px-2 text-foreground" />
          </label>
          <label className="flex flex-1 items-center gap-1.5 text-muted-foreground">
            Lng
            <input type="number" step="0.001" value={lng} onChange={(e) => setLng(Number(e.target.value))} className="h-8 w-full min-w-0 rounded-md border bg-background px-2 text-foreground" />
          </label>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
          Radius
          <input type="range" min={1} max={50} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="flex-1 accent-primary" />
          <span className="w-12 text-right tabular-nums text-foreground">{radius} km</span>
        </label>
        <Button onClick={search} disabled={busy} className="h-9 rounded-[10px]">
          {busy ? <Loader2 className="animate-spin" /> : <Search />}
          Show area
        </Button>
      </div>

      {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-[12px] text-destructive">{error}</p> : null}

      {area && counts ? (
        <>
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Towers" value={area.towers.length} />
            <Stat label="Degraded" value={counts.DEGRADED} tone={counts.DEGRADED ? "text-amber-500" : undefined} />
            <Stat label="Down" value={counts.DOWN} tone={counts.DOWN ? "text-red-500" : undefined} />
            <Stat label="People (est.)" value={area.subscribersEst.toLocaleString()} />
          </div>

          <section>
            <h3 className="mb-1 text-[12px] font-semibold text-muted-foreground">Towers in the circle</h3>
            <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto text-[12px]">
              {area.towers.slice(0, 40).map((t) => (
                <li key={t.enodeb_name} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-accent">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[t.status] ?? "#888" }} />
                  <span className="font-medium">{t.enodeb_name}</span>
                  <span className="truncate text-muted-foreground">{t.town}</span>
                  <span className="ml-auto tabular-nums text-muted-foreground">{t.distance_km.toFixed(1)} km</span>
                </li>
              ))}
              {area.towers.length === 0 ? <li className="px-1.5 text-muted-foreground">No towers in this circle.</li> : null}
            </ul>
          </section>

          <section>
            <h3 className="mb-1 text-[12px] font-semibold text-muted-foreground">
              Sampled subscribers ({area.subscribers.length} of {area.subscribersTotal}) — pick one to see the last 24 h
            </h3>
            <ul className="flex max-h-44 flex-col gap-0.5 overflow-y-auto text-[12px]">
              {area.subscribers.map((s) => (
                <li key={s.msisdn_hash}>
                  <button
                    type="button"
                    onClick={() => showTrail(s.msisdn_hash)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-accent",
                      trail?.hash === s.msisdn_hash && "bg-accent",
                    )}
                  >
                    <span className="font-mono">{s.msisdn_hash.slice(0, 8)}</span>
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", LABEL_STYLE[s.latest_label] ?? "bg-muted")}>{s.latest_label}</span>
                    <span className="truncate text-muted-foreground">{s.enodeb_name}</span>
                    <span className="ml-auto text-muted-foreground">{s.cell_changes_24h} moves</span>
                  </button>
                </li>
              ))}
              {area.subscribers.length === 0 ? <li className="px-1.5 text-muted-foreground">No subscribers shown (groups under 5 are withheld).</li> : null}
            </ul>
          </section>

          {trail ? (
            <section>
              <h3 className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
                <Route className="size-3.5" /> Trail of {trail.hash.slice(0, 8)} (cells only, 24 h)
              </h3>
              <ol className="flex flex-col gap-0.5 text-[12px]">
                {trail.segments.map((s, i) => (
                  <li key={`${s.arrived_at}-${i}`} className="flex gap-2 rounded px-1.5 py-0.5">
                    <span className="w-9 tabular-nums text-muted-foreground">{hhmm(s.arrived_at)}</span>
                    <span className="font-medium">{s.serving_cell}</span>
                    <span className="ml-auto text-muted-foreground">{s.left_at ? `${s.duration_min} min` : "now"}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {area.apps.length ? (
            <section>
              <h3 className="mb-1 text-[12px] font-semibold text-muted-foreground">
                What people use here{area.busiestHour != null ? ` — busiest at ${String(area.busiestHour).padStart(2, "0")}:00` : ""}
              </h3>
              <ul className="flex flex-col gap-1.5 text-[12px]">
                {area.apps.map((a) => (
                  <li key={a.name}>
                    <div className="flex justify-between">
                      <span className="font-medium">{a.name}</span>
                      <span className="text-muted-foreground">
                        {a.reach_pct}% reach · {a.data_share_pct}% data
                      </span>
                    </div>
                    <div className="mt-0.5 h-1.5 rounded bg-muted">
                      <div className="h-full rounded bg-primary" style={{ width: `${Math.min(100, a.reach_pct)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <p className="text-[11px] text-muted-foreground">Synthetic data. Cell-level only; groups of 1–4 people are withheld.</p>
        </>
      ) : (
        <p className="text-[13px] leading-5 text-muted-foreground">
          Choose a place and radius, then <em>Show area</em> to see its towers on the map, the people sampled there, and what they use.
        </p>
      )}
    </div>
  );
}