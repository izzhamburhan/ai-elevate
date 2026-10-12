"use client";

import type { makeKeplerStore } from "@/components/map/kepler-store";
import { runKeplerCommand } from "@/lib/kepler/commands";
import { EXPOSURE_STYLES, weatherRowsByExposure, type WeatherExposure, type WeatherForecast } from "./contracts";

type MapStore = ReturnType<typeof makeKeplerStore>;
const MAP_ID = "workspace";
const PREFIX = "weather-ml-";
type MapLayer = { id: string; dataId: string; isVisible: boolean };

function mapState(store: MapStore) {
  return runKeplerCommand(store, MAP_ID, "get_map_state", {}) as { datasets: { id: string }[]; layers: MapLayer[] };
}

/** Replace only weather-owned datasets. Existing network datasets and layer settings are retained. */
export async function loadWeatherOverlay(store: MapStore, forecast: WeatherForecast) {
  for (const dataset of mapState(store).datasets.filter((item) => item.id.startsWith(PREFIX))) {
    runKeplerCommand(store, MAP_ID, "remove_dataset", { dataId: dataset.id });
  }
  for (const exposure of Object.keys(EXPOSURE_STYLES) as WeatherExposure[]) {
    const rows = weatherRowsByExposure(forecast, exposure);
    if (!rows.length) continue;
    const dataId = `${PREFIX}${exposure}`;
    await runKeplerCommand(store, MAP_ID, "load_data", {
      dataId, label: `Weather: ${EXPOSURE_STYLES[exposure].label} exposure (${forecast.mode})`,
      rows, autoCreateLayers: false, centerMap: false,
    });
    runKeplerCommand(store, MAP_ID, "add_layer", {
      dataId, type: "point", label: `Weather · ${EXPOSURE_STYLES[exposure].label}`,
      columns: { lat: "latitude", lng: "longitude" }, color: EXPOSURE_STYLES[exposure].color,
      radius: 12, opacity: 0.85, sizeField: "marker_radius", sizeScale: "linear",
      visConfig: { radiusRange: [5, 18], filled: true, outline: true, thickness: 1, fixedRadius: false },
    });
  }
}

export function setWeatherOverlayVisible(store: MapStore, visible: boolean) {
  for (const layer of mapState(store).layers.filter((item) => item.dataId.startsWith(PREFIX))) {
    runKeplerCommand(store, MAP_ID, "update_layer", { layerId: layer.id, isVisible: visible });
  }
}

export function hasWeatherOverlay(store: MapStore) {
  return mapState(store).layers.some((item) => item.dataId.startsWith(PREFIX) && item.isVisible);
}
