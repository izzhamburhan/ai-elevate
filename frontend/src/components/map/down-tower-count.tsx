"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActionTypes, removeDataset, replaceDataInMap, updateMap, wrapTo } from "@kepler.gl/actions";
import { WebMercatorViewport, flyToViewport, getFlyToDuration } from "@math.gl/web-mercator";
import { RefreshCw } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { DOWN_TOWERS_DATA_ID, downTowersDataset } from "./down-towers";
import type { makeKeplerStore } from "./kepler-store";
import { refreshTowerStatus, TOWER_STATUS_REFRESH_MS, type TowerPin, useTowerStatus } from "./tower-status";

type KeplerStore = ReturnType<typeof makeKeplerStore>;
type KeplerAction = { type: (typeof ActionTypes)[keyof typeof ActionTypes] };

type MapState = { width: number; height: number; latitude: number; longitude: number; zoom: number; pitch: number; bearing: number };
type Dataset = {
  fields: { name: string }[];
  dataContainer: { numRows(): number; valueAt(row: number, column: number): unknown };
};
/** What kepler keeps of a layer click: deck.gl's pick info, whose object is the point's row. */
type Clicked = { layer?: { id: string } | null; object?: { position?: number[]; index?: number } | null };
type Instance = {
  mapState: MapState;
  visState: {
    datasets: Record<string, Dataset | undefined>;
    layers: { id: string; config: { dataId: string } }[];
    clicked?: Clicked | null;
  };
  uiState: { activeSidePanel: string | null };
};

/** Zoom a tower opens at from the list, unless the map is already closer. */
const TOWER_ZOOM = 11;
/** Bounds of a flight's length: short hops still ease, long ones don't drag. */
const FLY_MIN_MS = 1100;
const FLY_MAX_MS = 2200;
/** How long the pill pulses after a refresh finds new outages. */
const NEW_PULSE_MS = 4000;

const MYT = "Asia/Kuala_Lumpur";
const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: MYT, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dateFormat = new Intl.DateTimeFormat("en-GB", { timeZone: MYT, day: "numeric", month: "short" });

const read = (store: KeplerStore, mapId: string) =>
  (store.getState().keplerGl as unknown as Record<string, Instance | undefined>)[mapId];

/** Screen pixels the open side panel covers on the map's left; zero once it is closed or would leave no map. */
function panelInset(instance: Instance, panelWidth: number) {
  return instance.uiState.activeSidePanel && panelWidth < instance.mapState.width - 160 ? panelWidth : 0;
}

/** Down towers the map shows right now: inside the view and not under the side panel. */
function inViewCount(instance: Instance, towers: TowerPin[], panelWidth: number) {
  const { width, height, latitude, longitude, zoom, pitch, bearing } = instance.mapState;
  const viewport = new WebMercatorViewport({ width, height, latitude, longitude, zoom, pitch, bearing });
  const left = panelInset(instance, panelWidth);
  return towers.filter((t) => {
    const [x, y] = viewport.project([t.lng, t.lat]);
    return x >= left && x <= width && y >= 0 && y <= height;
  }).length;
}

const towerKey = (names: string[]) => [...names].sort().join("\n");

type View = { longitude: number; latitude: number; zoom: number };

/** The flight in progress, so a new one (or the user grabbing the map) replaces it. */
let flight = 0;

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Flies the map to a view: it zooms out, pans and zooms back in along one smooth curve. kepler
 * keeps its own view state and drops deck.gl's transition props, so step the view each frame.
 * Dragging or zooming the map mid-flight stops it where it is.
 */
function flyTo(store: KeplerStore, mapId: string, end: View) {
  const instance = read(store, mapId);
  if (!instance) return;
  cancelAnimationFrame(flight);
  const set = (view: View) => store.dispatch(wrapTo(mapId, updateMap(view as Parameters<typeof updateMap>[0])));
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return set(end);

  const { width, height, pitch, bearing } = instance.mapState;
  const from = { width, height, pitch, bearing, ...pick(instance.mapState) };
  const to = { ...from, ...end };
  const duration = Math.min(FLY_MAX_MS, Math.max(FLY_MIN_MS, getFlyToDuration(from, to)));
  const startedAt = performance.now();
  let last: View = pick(instance.mapState);

  const step = (now: number) => {
    const current = read(store, mapId)?.mapState;
    if (!current || !sameView(current, last)) return;
    const t = Math.min(1, (now - startedAt) / duration);
    last = t < 1 ? flyToViewport(from, to, easeInOutCubic(t)) : end;
    set(last);
    if (t < 1) flight = requestAnimationFrame(step);
  };
  flight = requestAnimationFrame(step);
}

const pick = ({ longitude, latitude, zoom }: View): View => ({ longitude, latitude, zoom });

/** Whether the map still shows the view the flight last set (kepler may round it slightly). */
const sameView = (a: View, b: View) =>
  Math.abs(a.longitude - b.longitude) < 1e-6 && Math.abs(a.latitude - b.latitude) < 1e-6 && Math.abs(a.zoom - b.zoom) < 1e-6;

/** Centres a tower in the map beside the side panel, zooming in unless the map is already closer. */
function flyToTower(store: KeplerStore, mapId: string, tower: { lat: number; lng: number }, panelWidth: number) {
  const instance = read(store, mapId);
  if (!instance) return;
  const { width, height } = instance.mapState;
  const zoom = Math.max(instance.mapState.zoom, TOWER_ZOOM);
  const viewport = new WebMercatorViewport({ width, height, latitude: tower.lat, longitude: tower.lng, zoom });
  const [longitude, latitude] = viewport.unproject([width / 2 - panelInset(instance, panelWidth) / 2, height / 2]);
  flyTo(store, mapId, { longitude, latitude, zoom });
}

/**
 * The down tower a layer click picked, if any: a dot in the "Tower outages" layer, or a DOWN row
 * of any other point dataset (e.g. the area card's "Towers DOWN").
 */
function clickedDownTower(instance: Instance, clicked: Clicked) {
  const position = clicked.object?.position;
  const layer = instance.visState.layers.find((l) => l.id === clicked.layer?.id);
  if (!layer || !position || position.length < 2) return undefined;
  const dataset = instance.visState.datasets[layer.config.dataId];
  const row = clicked.object?.index;
  const statusColumn = dataset?.fields.findIndex((f) => f.name === "status") ?? -1;
  const isDown =
    layer.config.dataId === DOWN_TOWERS_DATA_ID ||
    (dataset !== undefined && row !== undefined && statusColumn >= 0 && dataset.dataContainer.valueAt(row, statusColumn) === "DOWN");
  return isDown ? { lng: position[0], lat: position[1] } : undefined;
}

/** Clicking a down tower on the map flies to it, as picking it from the pill's list does. */
function useFlyToClickedDownTower(store: KeplerStore, mapId: string, panelWidth: number) {
  const panelWidthRef = useRef(panelWidth);
  useEffect(() => {
    panelWidthRef.current = panelWidth;
  }, [panelWidth]);

  useEffect(() => {
    let last = read(store, mapId)?.visState.clicked;
    return store.subscribe(() => {
      const instance = read(store, mapId);
      const clicked = instance?.visState.clicked;
      if (!instance || clicked === last) return;
      last = clicked;
      const tower = clicked ? clickedDownTower(instance, clicked) : undefined;
      if (tower) flyToTower(store, mapId, tower, panelWidthRef.current);
    });
  }, [store, mapId]);
}

/** The tower names in the map's "Tower outages" dataset. */
function datasetTowers(dataset: Dataset) {
  const column = dataset.fields.findIndex((f) => f.name === "tower");
  if (column < 0) return undefined;
  return Array.from({ length: dataset.dataContainer.numRows() }, (_, row) => String(dataset.dataContainer.valueAt(row, column)));
}

/**
 * Keeps the map's "Tower outages" layer on the live list: a refresh that finds the network changed,
 * or a saved chat restored with an old list, swaps the rows in place (the layer and its styling
 * stay). Once nothing is down the dataset goes. A map without the dataset is left alone.
 */
function useLiveDownTowers(store: KeplerStore, mapId: string, towers: TowerPin[] | undefined) {
  useEffect(() => {
    if (!towers) return;
    const live = towerKey(towers.map((t) => t.enodeb_name));
    const dispatch = (action: KeplerAction) => store.dispatch(wrapTo(mapId, action));
    let checked: Dataset | undefined;

    const sync = () => {
      const dataset = read(store, mapId)?.visState.datasets[DOWN_TOWERS_DATA_ID];
      if (!dataset || dataset === checked) return;
      checked = dataset;
      const names = datasetTowers(dataset);
      if (!names || towerKey(names) === live) return;

      const next = downTowersDataset(towers);
      if (!next) dispatch(removeDataset(DOWN_TOWERS_DATA_ID));
      else dispatch(replaceDataInMap({ datasetToReplaceId: DOWN_TOWERS_DATA_ID, datasetToUse: next, options: { centerMap: false } }));
    };
    sync();
    return store.subscribe(sync);
  }, [store, mapId, towers]);
}

/** Whether the pill should pulse: for a few seconds after a refresh finds new outages. */
function usePulse(newlyDown: string[] | undefined, fetchedAt: number | undefined) {
  const pulseUntil = newlyDown?.length && fetchedAt ? fetchedAt + NEW_PULSE_MS : 0;
  const [endedAt, setEndedAt] = useState(0);
  useEffect(() => {
    if (!pulseUntil) return;
    const timer = setTimeout(() => setEndedAt(pulseUntil), Math.max(0, pulseUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [pulseUntil]);
  return pulseUntil > endedAt;
}

/** Down towers grouped by state, the states with most outages first. */
function byState(towers: TowerPin[]) {
  const groups = new Map<string, TowerPin[]>();
  for (const t of towers) groups.set(t.state, [...(groups.get(t.state) ?? []), t]);
  return [...groups]
    .map(([state, list]) => [state, list.sort((a, b) => a.enodeb_name.localeCompare(b.enodeb_name))] as const)
    .sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b));
}

function Dot({ className }: { className: string }) {
  return <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", className)} />;
}

function StatTile({ value, label, className }: { value: number; label: string; className?: string }) {
  return (
    <div className="min-w-0 rounded-xl border bg-foreground/[0.02] px-2 py-1.5">
      <div className={cn("text-[13px] font-semibold tabular-nums", className)}>{value}</div>
      <div className="truncate text-[10.5px] text-muted-foreground">{label}</div>
    </div>
  );
}

/**
 * Live network status in a pill at the map's top right, beside kepler's map controls: towers down
 * (and how many of them the map shows), towers degraded, and the tower MCP's clock. It refreshes
 * every minute and pulses when new towers go down. Opening it lists the down towers by state; a
 * tower flies the map to it, and "Show all" fits them all in view.
 * `panelWidth` is the side panel's width with its margins, the map it covers while open.
 * Render it right after `<KeplerGl>`.
 */
export function DownTowerCount({ store, mapId, panelWidth }: { store: KeplerStore; mapId: string; panelWidth: number }) {
  const { status, error, loading } = useTowerStatus();
  const down = status?.down;
  useLiveDownTowers(store, mapId, down);
  const pulsing = usePulse(status?.newlyDown, status?.fetchedAt);

  const inView = useSyncExternalStore(
    store.subscribe,
    useCallback(() => {
      const instance = read(store, mapId);
      return instance && down ? inViewCount(instance, down, panelWidth) : 0;
    }, [store, mapId, down, panelWidth]),
    () => 0,
  );

  useFlyToClickedDownTower(store, mapId, panelWidth);

  const showTower = (tower: TowerPin) => flyToTower(store, mapId, tower, panelWidth);

  const [open, setOpen] = useState(false);

  /** Fits every down tower beside the side panel, closing the list so it doesn't cover the east. */
  const showAll = () => {
    setOpen(false);
    const instance = read(store, mapId);
    if (!instance || !down?.length) return;
    if (down.length === 1) return showTower(down[0]);
    const lngs = down.map((t) => t.lng);
    const lats = down.map((t) => t.lat);
    const pad = 64;
    const { width, height } = instance.mapState;
    const fitted = new WebMercatorViewport({ width, height }).fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      {
        padding: {
          top: pad,
          bottom: pad,
          right: pad + 56, // kepler's map controls
          left: pad + panelInset(instance, panelWidth),
        },
      },
    );
    flyTo(store, mapId, pick(fitted));
  };

  if (!status || !down) return null;
  const count = down.length;
  const newCount = status.newlyDown.length;
  const asOf = status.asOf ? new Date(status.asOf) : undefined;
  const isNew = new Set(status.newlyDown);

  return (
    <>
      <div role="status" className="sr-only">
        {newCount ? `${newCount} more ${newCount === 1 ? "outage" : "outages"}: ${status.newlyDown.join(", ")}` : ""}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {/* right-14 clears kepler's control column (32px buttons in 12px padding); top-3 lines up with them */}
          <button
            type="button"
            aria-label={`${count} ${count === 1 ? "outage" : "outages"}, ${status.degraded} degraded. Show network status`}
            className="absolute top-3 right-14 z-10 flex h-8 items-center gap-2 rounded-full border bg-background/95 px-3 text-[13px] whitespace-nowrap shadow-[0_24px_60px_-28px_rgba(0,0,0,0.45)] backdrop-blur transition-colors hover:bg-accent"
          >
            {pulsing ? <span aria-hidden="true" className="absolute -inset-px rounded-full ring-2 ring-red motion-safe:animate-pulse" /> : null}
            {count ? (
              <>
                <Dot className="bg-red shadow-[0_0_6px_var(--red)]" />
                <span className="font-semibold tabular-nums text-red">{count}</span>
                <span className="text-muted-foreground">{count === 1 ? "outage" : "outages"}</span>
              </>
            ) : (
              <>
                <Dot className="bg-green" />
                <span className="text-muted-foreground">No outages</span>
              </>
            )}
            {newCount ? <span className="rounded bg-red/15 px-1 py-0.5 text-[10px] leading-none font-medium text-red">{newCount} new</span> : null}
            {count && inView < count ? <span className="text-muted-foreground max-md:hidden">· {inView} in view</span> : null}
            {status.degraded ? (
              <span className="flex items-center gap-1.5 border-l pl-2 max-lg:hidden">
                <Dot className="bg-amber" />
                <span className="font-semibold tabular-nums text-amber">{status.degraded}</span>
                <span className="text-muted-foreground">degraded</span>
              </span>
            ) : null}
            {asOf ? <span className="border-l pl-2 text-muted-foreground tabular-nums max-lg:hidden">{timeFormat.format(asOf)} MYT</span> : null}
            {status.synthetic ? (
              <span className="rounded bg-muted px-1 py-0.5 text-[10px] leading-none font-medium text-muted-foreground max-lg:hidden">Synthetic</span>
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8} className="w-80 gap-3 rounded-2xl p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-sm font-medium">Network status</h2>
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {asOf ? `As of ${dateFormat.format(asOf)}, ${timeFormat.format(asOf)} MYT` : "Latest from the tower feed"}
              </p>
            </div>
            <TooltipIconButton
              tooltip="Refresh"
              aria-label="Refresh network status"
              onClick={() => refreshTowerStatus().catch(() => {})}
              disabled={loading}
              className="size-7 p-1.5 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className={cn("size-3.5", loading && "motion-safe:animate-spin")} />
            </TooltipIconButton>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <StatTile value={count} label="Outage" className="text-red" />
            <StatTile value={status.degraded} label="Degraded" className="text-amber" />
            <StatTile value={inView} label="Outage in view" />
          </div>

          {count ? (
            <>
              <Button variant="outline" size="sm" onClick={showAll}>
                Show all outages
              </Button>
              <div className="-mx-1 flex max-h-72 flex-col gap-2 overflow-y-auto">
                {byState(down).map(([state, towers]) => (
                  <section key={state}>
                    <h3 className="px-1 pb-0.5 text-[12px] font-medium text-muted-foreground">
                      {state} · <span className="tabular-nums">{towers.length}</span>
                    </h3>
                    {towers.map((t) => (
                      <button
                        key={t.enodeb_name}
                        type="button"
                        onClick={() => showTower(t)}
                        className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-[12px] transition-colors hover:bg-accent"
                      >
                        <Dot className="bg-red" />
                        <span className="font-mono">{t.enodeb_name}</span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{t.town}</span>
                        {isNew.has(t.enodeb_name) ? (
                          <span className="rounded bg-red/15 px-1 py-0.5 text-[10px] leading-none font-medium text-red">New</span>
                        ) : null}
                      </button>
                    ))}
                  </section>
                ))}
              </div>
            </>
          ) : (
            <p className="text-[12px] text-muted-foreground">Every tower in Malaysia is up or degraded.</p>
          )}

          <p className="text-[11px] text-muted-foreground">
            {status.synthetic ? "Synthetic data. " : ""}
            Refreshes every {TOWER_STATUS_REFRESH_MS / 60_000} min.
            {error ? <span className="text-destructive"> Last refresh failed: {error}</span> : null}
          </p>
        </PopoverContent>
      </Popover>
    </>
  );
}
