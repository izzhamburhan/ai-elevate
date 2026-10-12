"use client";

import { useMemo } from "react";
import { useStore } from "react-redux";

import type { makeKeplerStore } from "@/components/map/kepler-store";
import { MAP_ID } from "@/components/map/kepler-store";
import { runKeplerCommand } from "@/lib/kepler/commands";

type KeplerStore = ReturnType<typeof makeKeplerStore>;
type MapState = { layers: { id: string; dataId: string }[]; datasets: { id: string }[] };

/** Opening a floating card (trail, self-heal) closes the others, so only one sits at the bottom right. */
export const FLOATING_EVENT = "menara:trail-open";

/** Centre and zoom that put a box in the part of the map that is not under the chat panel. */
export function viewFor([west, south, east, north]: [number, number, number, number]) {
  const lat = (south + north) / 2;
  const lng = (west + east) / 2;
  const spanLng = Math.max(east - west, 0.005);
  const spanLat = Math.max(north - south, 0.005);
  const zoomX = Math.log2((800 * 360) / (512 * spanLng));
  const zoomY = Math.log2((650 * 360 * Math.cos((lat * Math.PI) / 180)) / (512 * spanLat));
  // above zoom 14 kepler's points grow with the zoom, so stop there to keep the dots their designed size
  const zoom = Math.min(14, Math.max(3, Math.min(zoomX, zoomY) - 0.2));
  return { latitude: lat, longitude: lng - (205 * 360) / (512 * 2 ** zoom), zoom };
}

/**
 * Small drawing helpers over the kepler commands. Lines and points only: kepler's `line` and `point` layers need no
 * extra config (a `geojson` layer added this way crashes kepler's loader). Point radius r shows at about r / 5 px.
 */
export function useMapDraw() {
  const store = useStore() as unknown as KeplerStore;
  return useMemo(() => {
    const run = (name: Parameters<typeof runKeplerCommand>[2], args: Record<string, unknown>) => runKeplerCommand(store, MAP_ID, name, args);

    /** Removes layers and datasets by id prefix; kepler logs an error for ids that are not loaded, so only existing ones are touched. */
    const removeOurs = (prefixes: string[]) => {
      const state = run("get_map_state", {}) as MapState;
      const ours = (id: string) => prefixes.some((p) => id.startsWith(p));
      for (const layer of state.layers) if (ours(layer.dataId)) run("remove_layer", { layerId: layer.id });
      for (const dataset of state.datasets) if (ours(dataset.id)) run("remove_dataset", { dataId: dataset.id });
    };
    const addLines = async (dataId: string, label: string, rows: unknown[], color: string, thickness: number, opacity = 0.9) => {
      if (!rows.length) return;
      await run("load_data", { rows, label, dataId, centerMap: false, autoCreateLayers: false });
      await run("add_layer", {
        dataId,
        type: "line",
        label,
        columns: { lat0: "lat0", lng0: "lng0", lat1: "lat1", lng1: "lng1" },
        color,
        opacity,
        visConfig: { thickness },
      });
    };
    const addPoints = async (dataId: string, label: string, rows: unknown[], color: string, radius: number) => {
      if (!rows.length) return;
      await run("load_data", { rows, label, dataId, centerMap: false, autoCreateLayers: false });
      await run("add_layer", { dataId, type: "point", label, columns: { lat: "lat", lng: "lng" }, color, radius });
    };
    const fit = (bbox: [number, number, number, number]) => run("set_view", viewFor(bbox));
    return { removeOurs, addLines, addPoints, fit };
  }, [store]);
}