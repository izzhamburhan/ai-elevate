import { addDataToMap } from "@kepler.gl/actions";
import { processRowObject } from "@kepler.gl/processors";

import { hexToRgb, TOWER_STATUS_COLOR } from "@/lib/map-colors";

import { PENINSULA_VIEW } from "./kepler-store";
import { currentTowerStatus, type TowerPin, type TowerStatus } from "./tower-status";

/** Dataset id of the down towers a new chat's map starts with; `TowerPulse` rings the same rows. */
export const DOWN_TOWERS_DATA_ID = "towers_down";

/**
 * Ground radius of an up tower's dot while zoomed out. Sized in metres, not pixels, so the healthy
 * network is a faint speck across the whole country and grows in as the map closes in on a city.
 */
const UP_RADIUS_M = 150;

/** Screen radius up towers hold once zoomed in, in kepler's units (outages and degraded use 30). */
const UP_RADIUS = 20;

/**
 * Zoom where the UP_RADIUS_M ground dot is as big as the UP_RADIUS screen dot. Below it up towers are
 * sized on the ground; from it they keep the screen size, so they never outgrow an outage. kepler
 * draws a screen-sized dot as radius × 2^(14 − zoom) metres, hence the formula.
 */
export const UP_SIZE_SWITCH_ZOOM = 14 + Math.log2(UP_RADIUS / UP_RADIUS_M);

/**
 * The tower layers a new chat's map starts with, top first: outages over degraded over the healthy
 * network. Outages and degraded towers keep a fixed screen size at every zoom; up towers don't.
 */
export const TOWER_LAYERS = [
  { status: "DOWN", dataId: DOWN_TOWERS_DATA_ID, layerId: "towers-down-points", label: "Tower outages" },
  { status: "DEGRADED", dataId: "towers_degraded", layerId: "towers-degraded-points", label: "Towers degraded" },
  { status: "UP", dataId: "towers_up", layerId: "towers-up-points", label: "Towers up" },
] as const;

export type TowerLayer = (typeof TOWER_LAYERS)[number];

/** Layer id of the up towers, whose sizing `DownTowerCount` switches with the zoom. */
export const UP_TOWERS_LAYER_ID = TOWER_LAYERS[2].layerId;

/** The towers of one layer in a network status. */
export function layerTowers(status: TowerStatus, layer: TowerLayer) {
  return layer.status === "DOWN" ? status.down : layer.status === "DEGRADED" ? status.degraded : status.up;
}

/** A layer's dataset for these towers, labelled for the tooltip; null when there are none. */
export function towerLayerDataset(layer: TowerLayer, towers: TowerPin[]) {
  if (!towers.length) return null;
  // radius_m sizes up towers on the ground; the tooltip leaves it out (see TOOLTIP_FIELDS)
  const rows = towers.map(({ enodeb_name, town, state, lat, lng, status }) => ({ tower: enodeb_name, town, state, status, lat, lng, radius_m: UP_RADIUS_M }));
  const data = processRowObject(rows);
  return data ? { info: { id: layer.dataId, label: layer.label }, data } : null;
}

/** What a tower's hover tooltip shows. */
const TOOLTIP_FIELDS = ["tower", "town", "state", "status"].map((name) => ({ name, format: null }));

/** A layer as kepler's saved (v1) config takes it, the first in a config's list drawn on top. */
function savedLayer(layer: TowerLayer) {
  const base = { dataId: layer.dataId, label: layer.label, columns: { lat: "lat", lng: "lng" }, isVisible: true };
  if (layer.status === "UP") {
    return {
      id: layer.layerId,
      type: "point",
      config: {
        ...base,
        color: hexToRgb(TOWER_STATUS_COLOR.UP),
        // the radius_m column sizes the dot in metres; with fixedRadius off it maps to radiusRange instead
        visConfig: { radius: UP_RADIUS, radiusRange: [UP_RADIUS, UP_RADIUS], fixedRadius: true, opacity: 0.45, filled: true, outline: false },
      },
      // kepler only sizes a point in metres when a column drives its size
      visualChannels: { sizeField: { name: "radius_m", type: "integer" }, sizeScale: "linear" },
    };
  }
  return {
    id: layer.layerId,
    type: "point",
    config: { ...base, color: hexToRgb(TOWER_STATUS_COLOR[layer.status]), visConfig: { radius: 30, opacity: 1, filled: true, outline: false } },
  };
}

/**
 * The action that puts the network on a fresh map, over Peninsular Malaysia, labelled for the
 * tooltip. The outage dots sit under the glowing cores `TowerPulse` draws, so they mostly serve
 * hover and the Layers list; `DownTowerCount` keeps every layer's rows in step with the live status
 * afterwards. Resolves to null when the tower MCP can't be reached, so the map simply starts empty.
 */
export async function towerLayersAction() {
  const status = await currentTowerStatus().catch((error) => {
    console.warn("[map] Tower status unavailable:", error instanceof Error ? error.message : error);
    return undefined;
  });
  if (!status) return null;
  const shown = TOWER_LAYERS.flatMap((layer) => {
    const dataset = towerLayerDataset(layer, layerTowers(status, layer));
    return dataset ? [{ layer, dataset }] : [];
  });
  if (!shown.length) return null;

  return {
    dataIds: shown.map(({ layer }) => layer.dataId),
    action: addDataToMap({
      datasets: shown.map(({ dataset }) => dataset),
      options: { centerMap: false },
      config: {
        version: "v1",
        config: {
          mapState: PENINSULA_VIEW,
          visState: {
            layers: shown.map(({ layer }) => savedLayer(layer)),
            interactionConfig: {
              tooltip: { enabled: true, compareMode: false, compareType: "absolute", fieldsToShow: Object.fromEntries(shown.map(({ layer }) => [layer.dataId, TOOLTIP_FIELDS])) },
            },
          },
        },
      },
    }),
  };
}
