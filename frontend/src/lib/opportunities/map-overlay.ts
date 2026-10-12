"use client";

import type { makeKeplerStore } from "@/components/map/kepler-store";
import { runKeplerCommand } from "@/lib/kepler/commands";
import { discoveryBounds, discoveryRows, type Discovery } from "./contracts";

const OPPORTUNITIES = "telco-opportunities";
const EVIDENCE = "telco-opportunity-evidence";

/** Replace only the two opportunity datasets (other panels' layers stay) and fly to the ranked areas. */
export async function loadOpportunityOverlay(store: ReturnType<typeof makeKeplerStore>, discovery: Discovery) {
  const state = runKeplerCommand(store, "workspace", "get_map_state", {}) as { datasets: { id: string }[] };
  for (const dataId of [OPPORTUNITIES, EVIDENCE]) {
    if (state.datasets.some((dataset) => dataset.id === dataId)) runKeplerCommand(store, "workspace", "remove_dataset", { dataId });
  }
  const rows = discoveryRows(discovery);
  const layers = [
    { dataId: OPPORTUNITIES, label: "Opportunities · ranked areas", rows: rows.filter((r) => r.kind === "opportunity"), color: "#f59e0b", radius: 40 },
    { dataId: EVIDENCE, label: "Opportunities · supporting sites and events", rows: rows.filter((r) => r.kind !== "opportunity"), color: "#8b5cf6", radius: 12 },
  ];
  for (const layer of layers) {
    if (!layer.rows.length) continue;
    await runKeplerCommand(store, "workspace", "load_data", {
      dataId: layer.dataId, label: layer.label, rows: layer.rows, autoCreateLayers: false, centerMap: false,
    });
    runKeplerCommand(store, "workspace", "add_layer", {
      dataId: layer.dataId, type: "point", label: layer.label, columns: { lat: "latitude", lng: "longitude" },
      color: layer.color, radius: layer.radius, opacity: 0.9, visConfig: { filled: true, outline: true, thickness: 2 },
    });
  }
  runKeplerCommand(store, "workspace", "set_view", { bounds: discoveryBounds(discovery) });
}
