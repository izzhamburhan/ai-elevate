"use client";

import { addDataToMap, fitBounds, layerVisConfigChange, removeDataset, updateMap, wrapTo } from "@kepler.gl/actions";
import { processRowObject } from "@kepler.gl/processors";

import type { AnswerEntity } from "@/lib/answer-entities";
import type { NetworkOverview } from "@/lib/network-overview";

import { MALAYSIA_VIEW, MAP_ID, type makeKeplerStore } from "./kepler-store";

export const NETWORK_DATASET_ID = "network-towers";

/** NOC status colours. */
const STATUS_COLORS: Record<string, string> = {
  DEGRADED: "#f97316",
  DOWN: "#ef4444",
  UNKNOWN: "#9ca3af",
  UP: "#22c55e",
};

let shownSignature: string | undefined;

/**
 * Puts every tower on the map coloured by status. kepler's ordinal scale gives colours to the
 * values present in sorted order, so the range is built from exactly those values: a missing
 * status would otherwise shift every colour by one (that is how DOWN once came out green).
 * Returns false when nothing changed since the last draw (polling would otherwise redraw every minute).
 */
export function showNetworkLayer(store: ReturnType<typeof makeKeplerStore>, overview: NetworkOverview): boolean {
  const signature = overview.towers.map((t) => `${t.enodeb_name}:${t.status}`).join("|");
  const present = Boolean((store.getState().keplerGl as Record<string, { visState?: { datasets: Record<string, unknown> } }>)[MAP_ID]?.visState?.datasets[NETWORK_DATASET_ID]);
  if (present && signature === shownSignature) return false;
  shownSignature = signature;
  const dispatch = (action: unknown) => store.dispatch(wrapTo(MAP_ID, action as never));
  const keplerGl = store.getState().keplerGl as Record<string, { visState?: { datasets: Record<string, unknown> } }>;
  if (keplerGl[MAP_ID]?.visState?.datasets[NETWORK_DATASET_ID]) dispatch(removeDataset(NETWORK_DATASET_ID));

  const rows = overview.towers.map(({ enodeb_name, site_id, town, state, lat, lng, status }) => ({
    enodeb_name,
    status,
    site_id,
    town,
    state,
    lat,
    lng,
  }));
  const data = processRowObject(rows);
  if (!data) return false;

  const statuses = [...new Set(rows.map((r) => r.status))].sort();
  const colors = statuses.map((s) => STATUS_COLORS[s] ?? STATUS_COLORS.UNKNOWN);

  dispatch(
    addDataToMap({
      datasets: { info: { id: NETWORK_DATASET_ID, label: "Network towers" }, data },
      options: { centerMap: false },
      config: {
        version: "v1",
        config: {
          mapState: MALAYSIA_VIEW,
          visState: {
            layers: [
              {
                id: "network-towers-status",
                type: "point",
                config: {
                  dataId: NETWORK_DATASET_ID,
                  label: "Towers by status",
                  columns: { lat: "lat", lng: "lng" },
                  isVisible: true,
                  visConfig: {
                    radius: 6,
                    opacity: 0.85,
                    filled: true,
                    outline: false,
                    colorRange: { name: "NOC status", type: "custom", category: "Custom", colors },
                  },
                },
                visualChannels: {
                  colorField: { name: "status", type: "string" },
                  colorScale: "ordinal",
                },
              },
            ],
          },
        },
      },
    }),
  );
  return true;
}

export const FOCUS_DATASET_ID = "answer-focus";
const BASE_LAYER_ID = "network-towers-status";
const FOCUS_COLORS: Record<string, string> = { ...STATUS_COLORS, PLACE: "#3b82f6" };
/** Labels stay readable up to this many points. */
const MAX_LABELS = 40;

type KeplerStore = ReturnType<typeof makeKeplerStore>;
type VisState = { datasets: Record<string, unknown>; layers: { id: string; config: { visConfig: Record<string, unknown> } }[] };

/** Last focus shown, so it can be put back on top after the base layer reloads. */
let lastFocus: AnswerEntity[] | undefined;

const visStateOf = (store: KeplerStore) =>
  (store.getState().keplerGl as Record<string, { visState?: VisState }>)[MAP_ID]?.visState;

function setBaseOpacity(store: KeplerStore, opacity: number) {
  const layer = visStateOf(store)?.layers.find((l) => l.id === BASE_LAYER_ID);
  if (layer) store.dispatch(wrapTo(MAP_ID, layerVisConfigChange(layer as never, { opacity }) as never));
}

/**
 * Highlights what the latest answer is about: its towers and places, drawn larger on top of the
 * network layer, labelled, and the map moved to them. The rest of the network is dimmed.
 */
export function showFocus(store: KeplerStore, entities: AnswerEntity[], { move = true } = {}) {
  const dispatch = (action: unknown) => store.dispatch(wrapTo(MAP_ID, action as never));
  if (visStateOf(store)?.datasets[FOCUS_DATASET_ID]) dispatch(removeDataset(FOCUS_DATASET_ID));
  lastFocus = entities;
  if (entities.length === 0) {
    setBaseOpacity(store, 0.85);
    return;
  }

  const rows = entities.map(({ label, status, kind, lat, lng }) => ({ name: label, status, kind, lat, lng }));
  const data = processRowObject(rows);
  if (!data) return;
  const statuses = [...new Set(rows.map((r) => r.status))].sort();
  const colors = statuses.map((s) => FOCUS_COLORS[s] ?? STATUS_COLORS.UNKNOWN);

  dispatch(
    addDataToMap({
      datasets: { info: { id: FOCUS_DATASET_ID, label: "In this answer" }, data },
      options: { centerMap: false, keepExistingConfig: true },
      config: {
        version: "v1",
        config: {
          visState: {
            layers: [
              {
                id: "answer-focus-points",
                type: "point",
                config: {
                  dataId: FOCUS_DATASET_ID,
                  label: "In this answer",
                  columns: { lat: "lat", lng: "lng" },
                  isVisible: true,
                  visConfig: {
                    radius: 14,
                    opacity: 0.95,
                    filled: true,
                    outline: true,
                    thickness: 2,
                    strokeColor: [255, 255, 255],
                    colorRange: { name: "NOC status", type: "custom", category: "Custom", colors },
                  },
                  // saved (v1) configs take a list of labels; kepler's type describes a single one
                  textLabel: (rows.length <= MAX_LABELS
                      ? [{ field: { name: "name", type: "string" }, color: [255, 255, 255], size: 12, anchor: "start", alignment: "center", offset: [10, 0], outlineWidth: 2, outlineColor: [0, 0, 0, 255], background: false, weight: 500 }]
                      : []) as never,
                },
                visualChannels: { colorField: { name: "status", type: "string" }, colorScale: "ordinal" },
              },
            ],
          },
        },
      },
    }),
  );
  setBaseOpacity(store, 0.2);

  if (move) flyTo(store, entities);
}

/** Moves the map to these places: street level for one, fitted to all of them for several. */
export function flyTo(store: KeplerStore, entities: AnswerEntity[]) {
  if (entities.length === 0) return;
  const dispatch = (action: unknown) => store.dispatch(wrapTo(MAP_ID, action as never));
  if (entities.length === 1) {
    const [e] = entities;
    dispatch(updateMap({ latitude: e.lat, longitude: e.lng, zoom: 11 } as never));
  } else {
    const lats = entities.map((e) => e.lat);
    const lngs = entities.map((e) => e.lng);
    // kepler fits to the side of the map that is not under the open side panel
    dispatch(fitBounds([Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)]));
  }
}

/** Back to the whole network: no highlight, full opacity, Malaysia view. */
export function clearFocus(store: KeplerStore) {
  const hadFocus = lastFocus !== undefined;
  showFocus(store, [], { move: false });
  lastFocus = undefined;
  if (hadFocus) store.dispatch(wrapTo(MAP_ID, updateMap(MALAYSIA_VIEW as never) as never));
}

/** After the base layer reloads it sits on top; put the current highlight back above it. */
export function restoreFocus(store: KeplerStore) {
  if (lastFocus?.length) showFocus(store, lastFocus, { move: false });
}
