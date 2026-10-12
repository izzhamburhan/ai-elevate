"use client";

import type { makeKeplerStore } from "@/components/map/kepler-store";
import { runKeplerCommand } from "@/lib/kepler/commands";

import type { HaloRow } from "./halos";

type MapStore = ReturnType<typeof makeKeplerStore>;
const MAP_ID = "workspace";

/**
 * Puts the people-per-tower rows in kepler as a dataset without a layer: the PeopleHalos overlay draws them (soft
 * halos and count chips that kepler's point layer cannot), and kepler saves the dataset with the chat. Replaces an
 * earlier dataset with the same id; no rows just clears it.
 */
export async function loadPeopleHalos(store: MapStore, dataId: string, rows: HaloRow[], label = "People per tower") {
  const state = runKeplerCommand(store, MAP_ID, "get_map_state", {}) as { datasets: { id: string }[]; layers: { id: string; dataId: string }[] };
  for (const layer of state.layers) if (layer.dataId === dataId) runKeplerCommand(store, MAP_ID, "remove_layer", { layerId: layer.id });
  if (state.datasets.some((d) => d.id === dataId)) runKeplerCommand(store, MAP_ID, "remove_dataset", { dataId });
  if (!rows.length) return;
  await runKeplerCommand(store, MAP_ID, "load_data", { rows, label, dataId, centerMap: false, autoCreateLayers: false });
}