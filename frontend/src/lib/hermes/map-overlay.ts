"use client";

import type { makeKeplerStore } from "@/components/map/kepler-store";
import { runKeplerCommand } from "@/lib/kepler/commands";
import { hermesMapRows, type HermesJob } from "./contracts";

const DATA_ID = "hermes-investigation-findings";

/** Replace only this panel's evidence overlay, retaining Weather, HEAL and chat datasets. */
export async function loadHermesOverlay(store: ReturnType<typeof makeKeplerStore>, job: HermesJob) {
  if (!job.geojson?.features.length) throw new Error("This investigation has no source-backed geographic findings.");
  const state = runKeplerCommand(store, "workspace", "get_map_state", {}) as { datasets: { id: string }[] };
  if (state.datasets.some((dataset) => dataset.id === DATA_ID)) runKeplerCommand(store, "workspace", "remove_dataset", { dataId: DATA_ID });
  await runKeplerCommand(store, "workspace", "load_data", {
    dataId: DATA_ID, label: "Hermes · investigation evidence", rows: hermesMapRows(job.geojson, job.investigation_id),
    autoCreateLayers: false, centerMap: false,
  });
  runKeplerCommand(store, "workspace", "add_layer", {
    dataId: DATA_ID, type: "point", label: "Hermes · source-backed findings",
    columns: { lat: "latitude", lng: "longitude" }, color: "#8b5cf6", radius: 10, opacity: 0.9,
    visConfig: { filled: true, outline: true, thickness: 1 },
  });
}
