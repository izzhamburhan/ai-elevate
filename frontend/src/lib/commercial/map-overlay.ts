"use client";

import type { makeKeplerStore } from "@/components/map/kepler-store";
import { runKeplerCommand } from "@/lib/kepler/commands";

const DATA_ID = "commercial-applications-focus";

/** Show only the selected application's areas/sites (one dataset, replaced on each switch) and fit the view to them. */
export async function focusCommercial(store: ReturnType<typeof makeKeplerStore>,
  geojson: { features: { geometry: { coordinates: [number, number] }; properties: Record<string, unknown> }[] }, label: string, color: string) {
  const state = runKeplerCommand(store, "workspace", "get_map_state", {}) as { datasets: { id: string }[] };
  if (state.datasets.some((d) => d.id === DATA_ID)) runKeplerCommand(store, "workspace", "remove_dataset", { dataId: DATA_ID });
  if (!geojson.features.length) return;
  const rows: (Record<string, unknown> & { longitude: number; latitude: number })[] = geojson.features.map((f) => ({
    ...Object.fromEntries(Object.entries(f.properties).map(([k, v]) => [k, v !== null && typeof v === "object" ? JSON.stringify(v) : v])),
    longitude: f.geometry.coordinates[0], latitude: f.geometry.coordinates[1],
  }));
  await runKeplerCommand(store, "workspace", "load_data", { dataId: DATA_ID, label: `Commercial · ${label}`, rows, autoCreateLayers: false, centerMap: false });
  runKeplerCommand(store, "workspace", "add_layer", { dataId: DATA_ID, type: "point", label: `Commercial · ${label}`, columns: { lat: "latitude", lng: "longitude" },
    color, radius: 20, opacity: 0.9, visConfig: { filled: true, outline: true, thickness: 2 } });
  // frame the recommended (rank 1) result when ranks exist; every result stays plotted
  const focus = rows.some((r) => r.rank === 1) ? rows.filter((r) => r.rank === 1) : rows;
  const lngs = focus.map((r) => r.longitude), lats = focus.map((r) => r.latitude);
  const pad = Math.max(0.05, (Math.max(...lngs) - Math.min(...lngs)) * 0.15);
  runKeplerCommand(store, "workspace", "set_view", { bounds: [Math.min(...lngs) - pad, Math.min(...lats) - pad, Math.max(...lngs) + pad, Math.max(...lats) + pad] });
}
