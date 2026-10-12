"use client";

import { create } from "zustand";

import type { makeKeplerStore } from "@/components/map/kepler-store";
import { runKeplerCommand } from "@/lib/kepler/commands";

/**
 * The map side of the Agents workspace: the tower last clicked on the map (the pane shows its evidence), and a
 * highlight ring for the evidence row last clicked in the pane.
 */

export type FocusedTower = { name: string; lat: number; lng: number; status?: string; at: number };

export const useMapFocus = create<{ tower: FocusedTower | null; highlighted: string | null }>(() => ({ tower: null, highlighted: null }));

export function focusTower(tower: Omit<FocusedTower, "at">) {
  const current = useMapFocus.getState().tower;
  if (current?.name === tower.name && current.lat === tower.lat) return;
  useMapFocus.setState({ tower: { ...tower, at: Date.now() } });
}

const HIGHLIGHT = "hermes-evidence-highlight";

/** One bright ring at the evidence location, replacing the previous one, and a fly-to. */
export async function highlightEvidence(store: ReturnType<typeof makeKeplerStore>, key: string, label: string, lat: number, lng: number, siteId?: string | null) {
  const state = runKeplerCommand(store, "workspace", "get_map_state", {}) as { datasets: { id: string }[] };
  if (state.datasets.some((d) => d.id === HIGHLIGHT)) runKeplerCommand(store, "workspace", "remove_dataset", { dataId: HIGHLIGHT });
  await runKeplerCommand(store, "workspace", "load_data", {
    dataId: HIGHLIGHT, label: "Agents · selected evidence", rows: [{ site_id: siteId ?? label, label, latitude: lat, longitude: lng }], autoCreateLayers: false, centerMap: false,
  });
  runKeplerCommand(store, "workspace", "add_layer", {
    dataId: HIGHLIGHT, type: "point", label: "Agents · selected evidence", columns: { lat: "latitude", lng: "longitude" },
    color: "#22d3ee", radius: 60, opacity: 0.35, visConfig: { filled: true, outline: true, thickness: 3, strokeColor: [34, 211, 238] },
  });
  runKeplerCommand(store, "workspace", "set_view", { latitude: lat, longitude: lng, zoom: 13 });
  useMapFocus.setState({ highlighted: key });
}

export function clearHighlight(store: ReturnType<typeof makeKeplerStore>) {
  const state = runKeplerCommand(store, "workspace", "get_map_state", {}) as { datasets: { id: string }[] };
  if (state.datasets.some((d) => d.id === HIGHLIGHT)) runKeplerCommand(store, "workspace", "remove_dataset", { dataId: HIGHLIGHT });
  useMapFocus.setState({ highlighted: null });
}
