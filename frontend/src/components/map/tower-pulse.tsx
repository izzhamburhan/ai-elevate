"use client";

import { useEffect, useState } from "react";
import { WebMercatorViewport } from "@math.gl/web-mercator";

import { TOWER_STATUS_COLOR } from "@/lib/map-colors";

import { DOWN_TOWERS_DATA_ID } from "./down-towers";
import type { makeKeplerStore } from "./kepler-store";

type KeplerStore = ReturnType<typeof makeKeplerStore>;

type MapState = { width: number; height: number; latitude: number; longitude: number; zoom: number; pitch: number; bearing: number };
type Dataset = {
  fields: { name: string }[];
  dataContainer: { numRows(): number; valueAt(row: number, column: number): unknown };
};
type Instance = {
  mapState: MapState;
  visState: { datasets: Record<string, Dataset | undefined>; layers: { config: { dataId: string; isVisible: boolean } }[] };
};

type Ring = { key: string; x: number; y: number };

/**
 * The marker's styles live here rather than in globals.css: Turbopack's dev cache has kept serving an
 * old globals.css after edits, which left the rings unstyled (and still). React 19 hoists this
 * `<style>` into <head> once, however many maps render it.
 */
const MARKER_CSS = `
@keyframes tower-fx-pulse {
  from { transform: scale(0.4); opacity: 0.95; }
  to { transform: scale(2.6); opacity: 0; }
}
.tower-fx { position: absolute; width: 0; height: 0; }
.tower-fx-core, .tower-fx-ring { position: absolute; border-radius: 9999px; }
.tower-fx-core {
  left: -7px; top: -7px; width: 14px; height: 14px;
  background: var(--tower-fx);
  box-shadow: 0 0 14px var(--tower-fx), 0 0 4px var(--tower-fx) inset;
}
.tower-fx-ring {
  left: -16px; top: -16px; width: 32px; height: 32px;
  border: 2px solid var(--tower-fx);
  animation: tower-fx-pulse 2s ease-out infinite;
}
.tower-fx-ring-late { animation-delay: 1s; }
@media (prefers-reduced-motion: reduce) {
  .tower-fx-ring { animation: none; opacity: 0.45; }
  .tower-fx-ring-late { display: none; }
}
`;

/** Screen positions of the down towers, or none while their layer is hidden or gone. */
function ringsFor(instance: Instance): Ring[] {
  const dataset = instance.visState.datasets[DOWN_TOWERS_DATA_ID];
  const visible = instance.visState.layers.some((l) => l.config.dataId === DOWN_TOWERS_DATA_ID && l.config.isVisible);
  if (!dataset || !visible) return [];

  const column = (name: string) => dataset.fields.findIndex((f) => f.name === name);
  const [lat, lng, tower] = [column("lat"), column("lng"), column("tower")];
  if (lat < 0 || lng < 0) return [];

  const { width, height, latitude, longitude, zoom, pitch, bearing } = instance.mapState;
  const viewport = new WebMercatorViewport({ width, height, latitude, longitude, zoom, pitch, bearing });
  const rings: Ring[] = [];
  for (let row = 0; row < dataset.dataContainer.numRows(); row++) {
    const [x, y] = viewport.project([Number(dataset.dataContainer.valueAt(row, lng)), Number(dataset.dataContainer.valueAt(row, lat))]);
    // skip what is off screen (with room for the ring)
    if (x < -40 || y < -40 || x > width + 40 || y > height + 40) continue;
    rings.push({ key: String(tower >= 0 ? dataset.dataContainer.valueAt(row, tower) : row), x, y });
  }
  return rings;
}

/**
 * The down-tower marker of the Menara command center's map: a glowing core with two rings pulsing
 * out of it, so outages stand out. kepler keeps a dot underneath for the tooltip; this draws the
 * marker, positioned from kepler's map state. It follows the "Tower outages" layer: hide or remove
 * the layer and the markers go too. Clicks pass through to the map.
 * Render it right after `<KeplerGl>`: it sits above the map and below the side panel.
 */
export function TowerPulse({ store, mapId }: { store: KeplerStore; mapId: string }) {
  const [rings, setRings] = useState<Ring[]>([]);

  useEffect(() => {
    let last: unknown[] = [];
    const update = () => {
      const instance = (store.getState().keplerGl as unknown as Record<string, Instance | undefined>)[mapId];
      if (!instance) return;
      const { mapState, visState } = instance;
      const next = [mapState, visState.datasets[DOWN_TOWERS_DATA_ID], visState.layers];
      if (next.every((part, i) => part === last[i])) return;
      last = next;
      setRings(ringsFor(instance));
    };
    update();
    return store.subscribe(update);
  }, [store, mapId]);

  if (!rings.length) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ zIndex: 1, ["--tower-fx" as string]: TOWER_STATUS_COLOR.DOWN }}
    >
      <style href="elevate-tower-fx" precedence="default">
        {MARKER_CSS}
      </style>
      {rings.map((r) => (
        <span key={r.key} className="tower-fx" style={{ left: r.x, top: r.y }}>
          <i className="tower-fx-ring" />
          <i className="tower-fx-ring tower-fx-ring-late" />
          <i className="tower-fx-core" />
        </span>
      ))}
    </div>
  );
}
