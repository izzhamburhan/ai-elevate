"use client";

import { useEffect, useState } from "react";
import { WebMercatorViewport } from "@math.gl/web-mercator";

import { TOWER_STATUS_COLOR } from "@/lib/map-colors";
import { HALO_DATA_IDS, chipKeys, compactCount, haloRadius, type Placed } from "@/lib/subscribers/halos";

import type { makeKeplerStore } from "./kepler-store";

type KeplerStore = ReturnType<typeof makeKeplerStore>;

type MapState = { width: number; height: number; latitude: number; longitude: number; zoom: number; pitch: number; bearing: number };
type Dataset = {
  fields: { name: string }[];
  dataContainer: { numRows(): number; valueAt(row: number, column: number): unknown };
};
type Instance = { mapState: MapState; visState: { datasets: Record<string, Dataset | undefined> } };

type Halo = Placed & { r: number; color: string; status: string; tower: string; chip: boolean };

const STATUS_COLOR: Record<string, string> = TOWER_STATUS_COLOR;

/**
 * Styles in the component, like the tower pulse (Turbopack's dev cache has served a stale globals.css). The halo is a
 * soft radial glow with a faint rim, translucent enough that the tower dot under it keeps its colour; it eases in once.
 */
const HALO_CSS = `
@keyframes people-halo-in {
  from { transform: translate(-50%, -50%) scale(0.6); opacity: 0; }
  to { transform: translate(-50%, -50%) scale(1); opacity: 1; }
}
.people-halo {
  position: absolute; border-radius: 9999px; transform: translate(-50%, -50%);
  background: radial-gradient(circle, color-mix(in srgb, var(--halo) 8%, transparent) 0%,
    color-mix(in srgb, var(--halo) 24%, transparent) 45%, color-mix(in srgb, var(--halo) 5%, transparent) 100%);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--halo) 38%, transparent);
  animation: people-halo-in 420ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.people-chip {
  position: absolute; transform: translate(-50%, calc(-100% - 6px));
  display: flex; align-items: center; gap: 5px; padding: 2px 7px 2px 6px; border-radius: 9999px;
  font: 600 11px/16px var(--font-sans, ui-sans-serif, system-ui); font-variant-numeric: tabular-nums;
  color: #f8fafc; background: rgba(15, 17, 26, 0.78); backdrop-filter: blur(6px);
  box-shadow: 0 6px 16px -8px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08);
  white-space: nowrap; animation: people-halo-in 420ms 120ms both;
}
.people-chip i { width: 6px; height: 6px; border-radius: 9999px; background: var(--halo); }
.people-chip span { color: rgba(248, 250, 252, 0.6); font-weight: 500; }
@media (prefers-reduced-motion: reduce) { .people-halo, .people-chip { animation: none; } }
`;

/** Every halo on screen, from the halo datasets in kepler (they are saved with the chat, so the halos come back too). */
function halosFor(instance: Instance): Halo[] {
  const { width, height, latitude, longitude, zoom, pitch, bearing } = instance.mapState;
  const rows: { tower: string; lat: number; lng: number; status: string; people: number }[] = [];
  for (const id of HALO_DATA_IDS) {
    const dataset = instance.visState.datasets[id];
    if (!dataset) continue;
    const column = (name: string) => dataset.fields.findIndex((f) => f.name === name);
    const [tower, lat, lng, status, people] = ["tower", "lat", "lng", "status", "people"].map(column);
    if (lat < 0 || lng < 0 || people < 0) continue;
    const at = (row: number, col: number) => dataset.dataContainer.valueAt(row, col);
    for (let row = 0; row < dataset.dataContainer.numRows(); row++) {
      rows.push({
        tower: String(tower >= 0 ? at(row, tower) : `${id}-${row}`),
        lat: Number(at(row, lat)),
        lng: Number(at(row, lng)),
        status: String(status >= 0 ? at(row, status) : "UNKNOWN"),
        people: Number(at(row, people)) || 0,
      });
    }
  }
  if (!rows.length) return [];

  const viewport = new WebMercatorViewport({ width, height, latitude, longitude, zoom, pitch, bearing });
  const max = Math.max(...rows.map((r) => r.people));
  const halos: Halo[] = [];
  for (const r of rows) {
    const [x, y] = viewport.project([r.lng, r.lat]);
    const radius = haloRadius(r.people, max, zoom);
    if (x < -radius || y < -radius || x > width + radius || y > height + radius) continue;
    halos.push({ key: r.tower, tower: r.tower, x, y, r: radius, people: r.people, status: r.status, color: STATUS_COLOR[r.status] ?? STATUS_COLOR.UNKNOWN, chip: false });
  }
  // no chip under the map controls on the right, the status bar at the top or the edges
  const chips = chipKeys(halos.filter((h) => h.x > 60 && h.x < width - 140 && h.y > 110 && h.y < height - 40), zoom);
  // biggest first, so small halos sit on top and stay visible
  return halos.map((h) => ({ ...h, chip: chips.has(h.key) })).sort((a, b) => b.r - a.r);
}

/**
 * People per tower on the map: a halo behind each tower dot, sized by its subscribers and coloured by its status, with
 * the count on the busiest few. Drawn from kepler's map state like the tower pulse; it goes away with its datasets.
 * Clicks pass through to the map. Render it right after `<KeplerGl>`.
 */
export function PeopleHalos({ store, mapId }: { store: KeplerStore; mapId: string }) {
  const [halos, setHalos] = useState<Halo[]>([]);

  useEffect(() => {
    let last: unknown[] = [];
    const update = () => {
      const instance = (store.getState().keplerGl as unknown as Record<string, Instance | undefined>)[mapId];
      if (!instance) return;
      const next = [instance.mapState, ...HALO_DATA_IDS.map((id) => instance.visState.datasets[id])];
      if (next.every((part, i) => part === last[i])) return;
      last = next;
      setHalos(halosFor(instance));
    };
    update();
    return store.subscribe(update);
  }, [store, mapId]);

  if (!halos.length) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 1 }}>
      <style href="elevate-people-halos" precedence="default">
        {HALO_CSS}
      </style>
      {halos.map((h) => (
        <i
          key={`halo-${h.key}`}
          className="people-halo"
          style={{ left: h.x, top: h.y, width: h.r * 2, height: h.r * 2, ["--halo" as string]: h.color }}
        />
      ))}
      {halos
        .filter((h) => h.chip)
        .map((h) => (
          <b key={`chip-${h.key}`} className="people-chip" style={{ left: h.x, top: h.y - h.r * 0.55, ["--halo" as string]: h.color }}>
            <i />
            {compactCount(h.people)}
            <span>people</span>
          </b>
        ))}
    </div>
  );
}