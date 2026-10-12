"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "react-redux";
import { useAui } from "@assistant-ui/react";
import {
  addLayer,
  interactionConfigChange,
  setFilterAnimationTimeConfig,
  setFilterAnimationWindow,
  setFilterView,
  toggleFilterAnimation,
  wrapTo,
} from "@kepler.gl/actions";
import { Loader2, MapPin, MessageSquareText, Pause, Play, Route, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { runKeplerCommand } from "@/lib/kepler/commands";
import { pointInRing } from "@/lib/menara/geometry";
import { viewFor } from "@/lib/menara/map-draw";
import { TOWER_STATUS_COLOR } from "@/lib/map-colors";
import { cn } from "@/lib/utils";

import { MAP_ID, type makeKeplerStore } from "../kepler-store";

type KeplerStore = ReturnType<typeof makeKeplerStore>;

type Place = {
  name: string;
  level: "state" | "district" | "mukim" | "point";
  state: string | null;
  district: string | null;
  center: { lat: number; lng: number };
  radius_km: number;
  bbox: [number, number, number, number];
  rings: number[][][];
  source: "boundary" | "search" | "given";
};
type Tower = { enodeb_name: string; town: string; lat: number; lng: number; status: string; distance_km: number };
type TowerLoad = { enodeb_name: string; subscribers_est: number };
type Subscriber = { msisdn_hash: string; enodeb_name: string; latest_label: string; cell_changes_24h: number };
type Segment = { serving_cell: string; enodeb_name: string; cell_lat: number; cell_lng: number; arrived_at: string; left_at: string | null; duration_min: number };
type Routine = { tower: string; kind: "home" | "weekday" | "weekend"; lat: number; lng: number; sentence: string };
type AppRow = { name: string; category: string; reach_pct: number; data_share_pct: number };
type Apps = { apps: AppRow[]; busiest_hour: number | null };

type Area = { place: Place; towers: Tower[]; inside: number; subscribers: Subscriber[]; peopleEst: number; sampled: number };

const OUTLINE_COLOR = "#7c5cff";
const TRAIL_COLOR = "#ec4899";
// kepler draws a point of radius r at about r / 5 pixels below zoom 14, so these are roughly 6, 9, 7 and 11 px
const TOWER_RADIUS = { UP: 30, DEGRADED: 45, DOWN: 45 } as Record<string, number>;
const STOP_RADIUS = 35;
const ROUTINE_RADIUS = 55;
const PER_TOWER_SAMPLE = 6;
const MAX_TOWERS_SAMPLED = 25;

const TRAIL_EVENT = "menara:trail-open";
const TRAIL_DATA = "trail_moves";
const TRAIL_FILTER = "trail_time";
type TooltipConfig = { config: { fieldsToShow: Record<string, { name: string; format: string | null }[]> } };
const SAMPLE_MIN = 15; // presence samples during each stay, so the playback histogram shows when the phone was seen
const LABEL_SLOTS = 3; // the 1st, 2nd and 3rd visit to the same cell are labelled side by side

/** An ISO time with the Malaysia offset, e.g. "2026-11-13T08:43:00+08:00". */
function isoMyt(ms: number) {
  return `${new Date(ms + 8 * 3600_000).toISOString().slice(0, 19)}+08:00`;
}


export type Section = "towers" | "subscribers" | "usage";

const STATUS_COLOR: Record<string, string> = TOWER_STATUS_COLOR;
const LABEL_STYLE: Record<string, string> = {
  GOOD: "bg-green/15 text-green",
  FAIR: "bg-amber/15 text-amber",
  POOR: "bg-orange-500/15 text-orange-500",
  NO_SERVICE: "bg-red/15 text-red",
};
const ROUTINE_STYLE: Record<Routine["kind"], { chip: string; color: string }> = {
  home: { chip: "bg-blue/15 text-blue", color: "#38bdf8" },
  weekday: { chip: "bg-amber/15 text-amber", color: "#facc15" },
  weekend: { chip: "bg-teal/15 text-teal", color: "#2dd4bf" },
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

const hhmm = (iso: string) => iso.slice(11, 16);

function circleRing(lat: number, lng: number, km: number): number[][] {
  const dLat = km / 111;
  const dLng = km / (111 * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: 65 }, (_, i) => {
    const angle = (i / 64) * 2 * Math.PI;
    return [lng + dLng * Math.sin(angle), lat + dLat * Math.cos(angle)];
  });
}

/** Rings as line segments (lat0/lng0 to lat1/lng1): kepler's `line` layer needs no extra config. */
function segmentsOf(rings: number[][][]) {
  return rings.flatMap((ring) => ring.slice(1).map((p, i) => ({ lat0: ring[i][1], lng0: ring[i][0], lat1: p[1], lng1: p[0] })));
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl border bg-foreground/[0.02] px-2 py-1.5">
      <div className={cn("whitespace-nowrap text-[13px] font-semibold tabular-nums", tone)}>{value}</div>
      <div className="truncate text-[10.5px] text-muted-foreground">{label}</div>
    </div>
  );
}

const levelWord = (p: Place) => (p.level === "point" ? "place" : p.level);

/**
 * Map & area as a chat card: the place the model asked for is drawn on the map (its real boundary, or a circle),
 * its towers are dots coloured by status, and the card lists them with the people there, what they use and, per
 * subscriber, the last 24 hours' trail and the 4-week routine. "Explain this trail" asks the chat model to word it.
 */
export function AreaCard({
  place,
  lat,
  lng,
  radiusKm,
  show,
}: {
  place?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  show?: Section[];
}) {
  const want = new Set<Section>(show?.length ? show : ["towers"]);
  const store = useStore() as unknown as KeplerStore;
  const aui = useAui();
  const [area, setArea] = useState<Area | null>(null);
  const [apps, setApps] = useState<Apps | null>(null);
  const [rank, setRank] = useState<"users" | "data">("users");
  const [error, setError] = useState<string | null>(null);
  const [trail, setTrail] = useState<{ hash: string; segments: Segment[] } | null>(null);
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [trailBusy, setTrailBusy] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const cardId = useId();

  // one trail card on the page: when another chat card opens a trail, this one closes its own
  useEffect(() => {
    const onOpen = (event: Event) => {
      if ((event as CustomEvent<string>).detail === cardId) return;
      setTrail(null);
      setRoutines(null);
    };
    window.addEventListener(TRAIL_EVENT, onOpen);
    return () => window.removeEventListener(TRAIL_EVENT, onOpen);
  }, [cardId]);

  type MapState = { layers: { id: string; dataId: string }[]; datasets: { id: string }[] };
  /** Removes our layers and datasets by id prefix; kepler logs an error for ids that are not loaded, so only existing ones are touched. */
  const removeOurs = (prefixes: string[]) => {
    const state = runKeplerCommand(store, MAP_ID, "get_map_state", {}) as MapState;
    const ours = (id: string) => prefixes.some((p) => id.startsWith(p));
    for (const layer of state.layers) if (ours(layer.dataId)) runKeplerCommand(store, MAP_ID, "remove_layer", { layerId: layer.id });
    for (const dataset of state.datasets) if (ours(dataset.id)) runKeplerCommand(store, MAP_ID, "remove_dataset", { dataId: dataset.id });
  };

  const addLines = async (dataId: string, label: string, rows: unknown[], color: string, thickness: number) => {
    if (!rows.length) return;
    await runKeplerCommand(store, MAP_ID, "load_data", { rows, label, dataId, centerMap: false, autoCreateLayers: false });
    await runKeplerCommand(store, MAP_ID, "add_layer", {
      dataId,
      type: "line",
      label,
      columns: { lat0: "lat0", lng0: "lng0", lat1: "lat1", lng1: "lng1" },
      color,
      opacity: 0.9,
      visConfig: { thickness },
    });
  };
  const addPoints = async (dataId: string, label: string, rows: unknown[], color: string, radius: number) => {
    if (!rows.length) return;
    await runKeplerCommand(store, MAP_ID, "load_data", { rows, label, dataId, centerMap: false, autoCreateLayers: false });
    await runKeplerCommand(store, MAP_ID, "add_layer", { dataId, type: "point", label, columns: { lat: "lat", lng: "lng" }, color, radius });
  };

  const loadApps = async (p: Place, by: "users" | "data") => {
    const data = await menara<Apps>("usage_top_apps_in_area", { lat: p.center.lat, lng: p.center.lng, radius_km: p.radius_km, rank_by: by, limit: 5 }).catch(() => null);
    setApps(data);
  };

  const load = async () => {
    try {
      const res = await fetch("/api/menara/place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: place, lat, lng, radius_km: radiusKm }),
      });
      const resolved = (await res.json()) as Place & { error?: string };
      if (!res.ok) throw new Error(resolved.error ?? "Could not find that place.");
      const towerData = await menara<{ towers: Tower[] }>("tower_list_in_radius", {
        lat: resolved.center.lat,
        lng: resolved.center.lng,
        radius_km: resolved.radius_km,
        limit: 200,
      });
      // inside the real boundary when there is one; otherwise everything in the circle
      const within = resolved.rings.length
        ? towerData.towers.filter((t) => resolved.rings.some((ring) => pointInRing(ring, t.lat, t.lng)))
        : towerData.towers;

      // people are sampled per tower inside the area, so a large area does not fill the sample from outside it
      let subscribers: Subscriber[] = [];
      let peopleEst = 0;
      if (want.has("subscribers")) {
        const perTower = await Promise.all(
          within.slice(0, MAX_TOWERS_SAMPLED).map((t) =>
            menara<{ subscribers: Subscriber[]; towers: TowerLoad[] }>("user_list_on_tower", { enodeb_name: t.enodeb_name, limit: PER_TOWER_SAMPLE }).catch(() => null),
          ),
        );
        subscribers = perTower.flatMap((r) => r?.subscribers ?? []);
        peopleEst = perTower.reduce((sum, r) => sum + (r?.towers?.[0]?.subscribers_est ?? 0), 0);
      }

      removeOurs(["area_", "trail_"]);
      const outline = resolved.rings.length ? resolved.rings : [circleRing(resolved.center.lat, resolved.center.lng, resolved.radius_km)];
      await addLines("area_boundary", `${resolved.name} outline`, segmentsOf(outline), OUTLINE_COLOR, 3);
      for (const status of want.has("towers") ? ["UP", "DEGRADED", "DOWN"] : []) {
        const rows = within.filter((t) => t.status === status).map((t) => ({ name: t.enodeb_name, lat: t.lat, lng: t.lng, status }));
        await addPoints(`area_${status.toLowerCase()}`, `Towers ${status}`, rows, STATUS_COLOR[status], TOWER_RADIUS[status]);
      }
      runKeplerCommand(store, MAP_ID, "set_view", viewFor(resolved.bbox));

      setArea({ place: resolved, towers: within, inside: within.length, subscribers: subscribers.slice(0, 60), peopleEst, sampled: subscribers.length });
      if (want.has("usage")) await loadApps(resolved, "users");
    } catch (e) {
      console.error("[area] failed", e instanceof Error ? e.stack : e);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // show the area as soon as the card appears
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
    // once per mount: the card keeps its own state after that
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeTrail = () => {
    setTrail(null);
    setRoutines(null);
    setPlaying(false);
    // removing the dataset also removes its time filter and the playback bar
    removeOurs(["trail_"]);
  };

  const showTrail = async (hash: string) => {
    setError(null);
    setRoutines(null);
    setTrailBusy(hash);
    window.dispatchEvent(new CustomEvent(TRAIL_EVENT, { detail: cardId }));
    try {
      const [data, routineReply] = await Promise.all([
        menara<{ segments: Segment[] }>("user_get_trail", { msisdn_hash: hash, window_min: 1440 }),
        fetch("/api/menara/routines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ msisdn_hash: hash }),
        }).then((res) => res.json() as Promise<{ routines?: Routine[]; error?: string }>),
      ]);
      const segments = data.segments ?? [];
      setTrail({ hash, segments });
      setRoutines(routineReply.routines ?? []);
      setTrailBusy(null);
      removeOurs(["trail_"]);
      // routine markers first: kepler draws newer layers on top, so the trail stays visible over them
      for (const kind of ["home", "weekday", "weekend"] as const) {
        const rows = (routineReply.routines ?? []).filter((r) => r.kind === kind).map((r) => ({ name: r.tower, kind, lat: r.lat, lng: r.lng }));
        await addPoints(`trail_${kind}`, `Routine ${kind}`, rows, ROUTINE_STYLE[kind].color, ROUTINE_RADIUS);
      }
      await drawTrailPlayback(segments);
      // fit the map to the area and the whole trail, which can leave the area
      if (segments.length && area) {
        const [west, south, east, north] = area.place.bbox;
        const lngs = [west, east, ...segments.map((s) => s.cell_lng)];
        const lats = [south, north, ...segments.map((s) => s.cell_lat)];
        runKeplerCommand(store, MAP_ID, "set_view", viewFor([Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]));
      }
    } catch (e) {
      setTrailBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /**
   * The trail as one dataset, one row per cell visit with its arrival time: a point layer for the stops and a line layer
   * for the move from the previous stop. A time filter on the arrival time gives kepler's time playback bar at the bottom
   * of the map; the "incremental" window keeps the start fixed, so the trail grows as it plays.
   */
  const drawTrailPlayback = async (segments: Segment[]) => {
    if (!segments.length) return;
    const seen = new Map<string, number>();
    const rows: Record<string, string | number>[] = [];
    segments.forEach((s, i) => {
      const nth = (seen.get(s.serving_cell) ?? 0) + 1;
      seen.set(s.serving_cell, nth);
      const labels = Object.fromEntries(Array.from({ length: LABEL_SLOTS }, (_, k) => [`label_${k + 1}`, k === Math.min(nth, LABEL_SLOTS) - 1 ? `#${i + 1}` : ""]));
      const base = {
        order: i + 1,
        cell: s.serving_cell,
        tower: s.enodeb_name,
        stay_min: Math.round(s.duration_min),
        lat: s.cell_lat,
        lng: s.cell_lng,
      };
      // the visit: a stop, a move from the previous stop, and its number next to the circle
      rows.push({
        ...base,
        kind: "visit",
        // ISO with its +08:00 offset, so the time is right whatever the viewer's time zone
        arrived_at: s.arrived_at,
        // what the tooltip shows: kepler prints timestamps in UTC there
        time_myt: `${s.arrived_at.slice(0, 10)} ${s.arrived_at.slice(11, 16)}`,
        lat0: i ? segments[i - 1].cell_lat : s.cell_lat,
        lng0: i ? segments[i - 1].cell_lng : s.cell_lng,
        ...labels,
      });
      // still there: a sample every SAMPLE_MIN minutes of the stay (no move, no label)
      const start = Date.parse(s.arrived_at);
      for (let at = start + SAMPLE_MIN * 60_000; at < start + s.duration_min * 60_000; at += SAMPLE_MIN * 60_000) {
        const iso = isoMyt(at);
        rows.push({
          ...base,
          kind: "stay",
          arrived_at: iso,
          time_myt: `${iso.slice(0, 10)} ${iso.slice(11, 16)}`,
          lat0: s.cell_lat,
          lng0: s.cell_lng,
          ...Object.fromEntries(Array.from({ length: LABEL_SLOTS }, (_, k) => [`label_${k + 1}`, ""])),
        });
      }
    });
    await runKeplerCommand(store, MAP_ID, "load_data", { rows, label: "Subscriber trail", dataId: TRAIL_DATA, centerMap: false, autoCreateLayers: false });
    await runKeplerCommand(store, MAP_ID, "add_layer", {
      dataId: TRAIL_DATA,
      type: "line",
      label: "Trail moves",
      columns: { lat0: "lat0", lng0: "lng0", lat1: "lat", lng1: "lng" },
      color: TRAIL_COLOR,
      opacity: 0.9,
      visConfig: { thickness: 3 },
    });
    addStopsWithVisitNumbers();
    showTooltipFields(TRAIL_DATA, ["order", "cell", "time_myt", "stay_min", "kind"]);
    const times = rows.map((r) => Date.parse(String(r.arrived_at)));
    const start = Math.min(...times);
    // one minute past the last sample, so the last stop is inside the range
    const end = Math.max(...times) + 60_000;
    try {
      await runKeplerCommand(store, MAP_ID, "add_filter", { dataId: TRAIL_DATA, field: "arrived_at", filterId: TRAIL_FILTER, value: [start, end] });
      const filters = (store.getState().keplerGl as unknown as Record<string, { visState: { filters: { id: string }[] } }>)[MAP_ID].visState.filters;
      const idx = filters.findIndex((f) => f.id === TRAIL_FILTER);
      if (idx >= 0) {
        // kepler's full playback panel (histogram, play, speed) at the bottom of the map, in Malaysia time
        store.dispatch(wrapTo(MAP_ID, setFilterView(idx, "enlarged")));
        store.dispatch(wrapTo(MAP_ID, setFilterAnimationTimeConfig(idx, { timezone: "Asia/Kuala_Lumpur" })));
        store.dispatch(wrapTo(MAP_ID, setFilterAnimationWindow({ id: TRAIL_FILTER, animationWindow: "incremental" })));
        store.dispatch(wrapTo(MAP_ID, toggleFilterAnimation(idx)));
        setPlaying(true);
      }
    } catch (e) {
      // the trail still shows without playback
      console.warn("[trail] time playback unavailable", e);
    }
  };

  /**
   * The stops layer, created with the visit numbers as text labels (one slot per visit to the same cell, side by side).
   * The labels go in the layer config at creation: kepler builds the label font from the data then, and labels set later
   * render as empty boxes.
   */
  const addStopsWithVisitNumbers = () => {
    const id = "trail_stops_layer"; // one trail at a time; removeOurs drops it with the dataset
    const hex = TRAIL_COLOR.replace("#", "");
    const color = [0, 2, 4].map((k) => parseInt(hex.slice(k, k + 2), 16));
    store.dispatch(
      wrapTo(
        MAP_ID,
        addLayer({
          id,
          type: "point",
          config: {
            dataId: TRAIL_DATA,
            label: "Trail stops",
            columns: { lat: "lat", lng: "lng" },
            isVisible: true,
            color,
            textLabel: Array.from({ length: LABEL_SLOTS }, (_, k) => ({
              field: { name: `label_${k + 1}`, type: "string" },
              color: [255, 255, 255],
              size: 32,
              offset: [16 + k * 42, -16],
              anchor: "start",
              alignment: "center",
              // a small dark chip behind white digits reads on both basemaps
              outlineWidth: 0,
              outlineColor: [0, 0, 0, 0],
              background: true,
              backgroundColor: [17, 24, 39, 220],
            })),
          },
          // marks the config as a saved (v1) layer so kepler parses it
          visualChannels: {},
        } as never),
      ),
    );
    runKeplerCommand(store, MAP_ID, "update_layer", { layerId: id, radius: STOP_RADIUS });
  };

  /** Which fields kepler's hover tooltip lists for a dataset. */
  const showTooltipFields = (dataId: string, names: string[]) => {
    const tooltip = (store.getState().keplerGl as unknown as Record<string, { visState: { interactionConfig: { tooltip: TooltipConfig } } }>)[MAP_ID]
      ?.visState.interactionConfig.tooltip;
    if (!tooltip) return;
    const fieldsToShow = { ...tooltip.config.fieldsToShow, [dataId]: names.map((name) => ({ name, format: null })) };
    store.dispatch(wrapTo(MAP_ID, interactionConfigChange({ ...tooltip, config: { ...tooltip.config, fieldsToShow } } as never)));
  };

  const togglePlayback = () => {
    const filters = (store.getState().keplerGl as unknown as Record<string, { visState: { filters: { id: string }[] } }>)[MAP_ID]?.visState.filters ?? [];
    const idx = filters.findIndex((f) => f.id === TRAIL_FILTER);
    if (idx < 0) return;
    store.dispatch(wrapTo(MAP_ID, toggleFilterAnimation(idx)));
    setPlaying((p) => !p);
  };

  const counts = (status: string) => area?.towers.filter((t) => t.status === status).length ?? 0;

  if (error && !area) {
    return <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</p>;
  }
  if (!area) {
    return (
      <div className="flex items-center gap-2 rounded-xl border bg-card/40 px-3 py-2 text-[12px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Drawing {place ?? "the area"} on the map…
      </div>
    );
  }

  const p = area.place;
  return (
    <div className="flex max-h-[34rem] flex-col gap-3 overflow-y-auto rounded-xl border bg-card/40 p-3 font-sans text-foreground">
      <div className="flex items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-blue/15 text-blue">
          <MapPin className="size-3.5" />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">{p.name}</h2>
          <p className="text-[11px] text-muted-foreground">
            {p.level === "point" ? `Circle of ${p.radius_km} km` : `${levelWord(p)}${p.district && p.level === "mukim" ? `, ${p.district}` : ""}${p.state ? `, ${p.state}` : ""}`}
            {p.rings.length ? " · outline from NetOps boundaries" : ""}
          </p>
        </div>
      </div>

      {error ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-[12px] text-destructive">{error}</p> : null}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))] gap-2">
        {want.has("towers") ? (
          <>
            <Stat label="Towers" value={area.inside} />
            <Stat label="Degraded" value={counts("DEGRADED")} tone={counts("DEGRADED") ? "text-amber" : undefined} />
            <Stat label="Down" value={counts("DOWN")} tone={counts("DOWN") ? "text-red" : undefined} />
          </>
        ) : null}
        {want.has("subscribers") ? <Stat label="People (est.)" value={area.peopleEst.toLocaleString()} /> : null}
      </div>

      {want.has("towers") ? (
      <section>
        <h3 className="mb-1 text-[12px] font-medium text-muted-foreground">Towers {p.rings.length ? `inside ${p.name}` : "in the circle"}</h3>
        <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto text-[12px]">
          {area.towers.map((t) => (
            <li key={t.enodeb_name} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-accent">
              <span className="size-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[t.status] ?? TOWER_STATUS_COLOR.UNKNOWN }} />
              <span className="font-medium">{t.enodeb_name}</span>
              <span className="truncate text-muted-foreground">{t.town}</span>
              <span className="ml-auto tabular-nums text-muted-foreground">{t.status}</span>
            </li>
          ))}
          {area.towers.length === 0 ? <li className="px-1.5 text-muted-foreground">No towers found here.</li> : null}
        </ul>
      </section>
      ) : null}

      {want.has("subscribers") ? (
      <section>
        <h3 className="mb-1 text-[12px] font-medium text-muted-foreground">Sampled subscribers — pick one for the last 24 h</h3>
        <ul className="flex max-h-44 flex-col gap-0.5 overflow-y-auto text-[12px]">
          {area.subscribers.map((s) => (
            <li key={s.msisdn_hash}>
              <button
                type="button"
                onClick={() => showTrail(s.msisdn_hash)}
                className={cn("flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-accent", trail?.hash === s.msisdn_hash && "bg-accent")}
              >
                <span className="font-mono">{s.msisdn_hash.slice(0, 8)}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", LABEL_STYLE[s.latest_label] ?? "bg-muted")}>{s.latest_label}</span>
                <span className="truncate text-muted-foreground">{s.enodeb_name}</span>
                <span className="ml-auto text-muted-foreground">{s.cell_changes_24h} moves</span>
              </button>
            </li>
          ))}
          {area.subscribers.length === 0 ? <li className="px-1.5 text-muted-foreground">No subscribers shown (groups under 5 are withheld).</li> : null}
        </ul>
      </section>
      ) : null}

      {want.has("subscribers") && (trail || trailBusy) ? (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Route className="size-3.5" /> {trailBusy ? "Loading the trail…" : `Trail of ${trail?.hash.slice(0, 8)} is shown at the bottom right of the map.`}
        </p>
      ) : null}

      {want.has("usage") && apps?.apps.length ? (
        <section>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-[12px] font-medium text-muted-foreground">
              What people use here{apps.busiest_hour != null ? ` — busiest at ${String(apps.busiest_hour).padStart(2, "0")}:00` : ""}
            </h3>
            <div className="flex overflow-hidden rounded-full border text-[11px]">
              {(["users", "data"] as const).map((by) => (
                <button
                  key={by}
                  type="button"
                  onClick={() => {
                    setRank(by);
                    void loadApps(p, by);
                  }}
                  className={cn("px-2.5 py-0.5 capitalize", rank === by ? "bg-accent font-medium" : "text-muted-foreground")}
                >
                  {by}
                </button>
              ))}
            </div>
          </div>
          <ul className="flex flex-col gap-1.5 text-[12px]">
            {apps.apps.map((a) => {
              const share = rank === "users" ? a.reach_pct : a.data_share_pct;
              return (
                <li key={a.name}>
                  <div className="flex justify-between">
                    <span className="font-medium">{a.name}</span>
                    <span className="text-muted-foreground">
                      {a.reach_pct}% reach · {a.data_share_pct}% data
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 rounded bg-muted">
                    <div className="h-full rounded bg-primary" style={{ width: `${Math.min(100, share * (rank === "users" ? 1 : 2))}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <p className="text-[11px] text-muted-foreground">Synthetic data. Cell level only; groups of 1–4 people are withheld.</p>
      {trail && typeof document !== "undefined"
        ? createPortal(
            <div
              role="dialog"
              aria-label={`Trail of subscriber ${trail.hash.slice(0, 8)}`}
              className="fixed right-4 bottom-[19rem] z-[60] flex max-h-[calc(100vh-24rem)] w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2 overflow-y-auto rounded-2xl border bg-background/95 p-3 font-sans text-foreground shadow-[0_24px_60px_-28px_rgba(0,0,0,0.45)] backdrop-blur"
            >
              <div className="flex items-center gap-1.5">
                <Route className="size-3.5 text-muted-foreground" />
                <h3 className="text-[13px] font-medium">Trail of {trail.hash.slice(0, 8)}</h3>
                <span className="text-[11px] text-muted-foreground">cells only, 24 h</span>
                <button
                  type="button"
                  onClick={togglePlayback}
                  aria-label={playing ? "Pause the trail playback" : "Play the trail"}
                  className="ml-auto flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />} {playing ? "Pause" : "Play"}
                </button>
                <button type="button" onClick={closeTrail} aria-label="Close the trail" className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                  <X className="size-3.5" />
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">Replays on the map with the time bar at the bottom: drag it, or change the speed there.</p>
              <ol className="flex flex-col gap-0.5 text-[12px]">
                {trail.segments.map((s, i) => (
                  <li key={`${s.arrived_at}-${i}`} className="flex gap-2 rounded px-1.5 py-0.5">
                    <span className="w-9 tabular-nums text-muted-foreground">{hhmm(s.arrived_at)}</span>
                    <span className="font-medium">{s.serving_cell}</span>
                    <span className="ml-auto text-muted-foreground">{s.left_at ? `${Math.round(s.duration_min)} min` : "now"}</span>
                  </li>
                ))}
              </ol>
              {routines ? (
                <div>
                  <h4 className="mb-1 text-[12px] font-medium text-muted-foreground">Routine (last 4 weeks)</h4>
                  <ul className="flex flex-col gap-1.5 text-[12px] leading-5">
                    {routines.map((r) => (
                      <li key={`${r.kind}-${r.tower}`} className="flex gap-2">
                        <span className={cn("h-5 shrink-0 rounded-full px-2 text-[10px] font-medium leading-5", ROUTINE_STYLE[r.kind].chip)}>{r.kind}</span>
                        <span>{r.sentence}</span>
                      </li>
                    ))}
                    {routines.length === 0 ? <li className="text-muted-foreground">No regular routine found in the last 4 weeks.</li> : null}
                  </ul>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">Synthetic subscriber. Cell level (about a kilometre), so places are &lsquo;near&rsquo;, never &lsquo;at&rsquo;.</p>
                </div>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                className="self-start"
                onClick={() => aui.thread().append(`Explain the movements of subscriber ${trail.hash} in plain language (use the describe_trail tool).`)}
              >
                <MessageSquareText /> Explain this trail
              </Button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
