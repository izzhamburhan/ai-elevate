"use client";

import type { makeKeplerStore } from "@/components/map/kepler-store";
import { runKeplerCommand } from "@/lib/kepler/commands";
import type { Simulation } from "./contracts";

const DATA_ID = "decision-time-machine-focus";

/** Highlight only the simulated opportunity and its supporting sites; other layers stay. */
export async function focusSimulation(store: ReturnType<typeof makeKeplerStore>, simulation: Simulation) {
  const state = runKeplerCommand(store, "workspace", "get_map_state", {}) as { datasets: { id: string }[] };
  if (state.datasets.some((dataset) => dataset.id === DATA_ID)) runKeplerCommand(store, "workspace", "remove_dataset", { dataId: DATA_ID });
  const rows = simulation.data.geojson.features.map((feature) => ({
    ...Object.fromEntries(Object.entries(feature.properties).map(([key, value]) => [key, value !== null && typeof value === "object" ? JSON.stringify(value) : value])),
    longitude: feature.geometry.coordinates[0], latitude: feature.geometry.coordinates[1],
  }));
  await runKeplerCommand(store, "workspace", "load_data", {
    dataId: DATA_ID, label: "Decision Time Machine · simulated opportunity", rows, autoCreateLayers: false, centerMap: false,
  });
  runKeplerCommand(store, "workspace", "add_layer", {
    dataId: DATA_ID, type: "point", label: "Decision Time Machine · simulated opportunity", columns: { lat: "latitude", lng: "longitude" },
    color: "#06b6d4", radius: 22, opacity: 0.9, visConfig: { filled: true, outline: true, thickness: 2 },
  });
  const { lat, lng } = simulation.data.opportunity.where;
  runKeplerCommand(store, "workspace", "set_view", { bounds: [lng - 0.12, lat - 0.08, lng + 0.12, lat + 0.08] });
}
