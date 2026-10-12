import { addDataToMap } from "@kepler.gl/actions";
import { processRowObject } from "@kepler.gl/processors";

import { hexToRgb, TOWER_STATUS_COLOR } from "@/lib/map-colors";

import { PENINSULA_VIEW } from "./kepler-store";

/** Dataset id of the down towers a new chat's map starts with; `TowerPulse` rings the same rows. */
export const DOWN_TOWERS_DATA_ID = "towers_down";

/** All of Malaysia, so panning to Sabah and Sarawak shows their down towers too. */
const MALAYSIA_BBOX = { min_lat: 0.8, min_lng: 99.5, max_lat: 7.5, max_lng: 119.5 };

type TowerPin = { enodeb_name: string; site_id: string; town: string; state: string; lat: number; lng: number; status: string };

/** Towers the tower MCP reports as DOWN right now (scenario clock), across Malaysia. */
async function fetchDownTowers(): Promise<TowerPin[]> {
  const res = await fetch("/api/menara/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool: "tower_list_in_bbox", args: { ...MALAYSIA_BBOX, status: "DOWN", limit: 500 } }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; data?: { towers?: TowerPin[] } };
  if (!res.ok) throw new Error(body.error ?? `Tower request failed (${res.status})`);
  return body.data?.towers ?? [];
}

/**
 * The action that puts the down towers on a fresh map, over Peninsular Malaysia, labelled for the
 * tooltip. The dots sit under the glowing cores `TowerPulse` draws, so they mostly serve hover and
 * the Layers list. Resolves to null when the tower MCP can't be reached or nothing is down, so the
 * map simply starts empty.
 */
export async function downTowersAction() {
  const towers = await fetchDownTowers().catch((error) => {
    console.warn("[map] Down towers unavailable:", error instanceof Error ? error.message : error);
    return [];
  });
  if (!towers.length) return null;

  const rows = towers.map(({ enodeb_name, town, state, lat, lng, status }) => ({ tower: enodeb_name, town, state, status, lat, lng }));
  const data = processRowObject(rows);
  if (!data) return null;

  return addDataToMap({
    datasets: { info: { id: DOWN_TOWERS_DATA_ID, label: "Towers down" }, data },
    options: { centerMap: false },
    config: {
      version: "v1",
      config: {
        mapState: PENINSULA_VIEW,
        visState: {
          layers: [
            {
              id: "towers-down-points",
              type: "point",
              config: {
                dataId: DOWN_TOWERS_DATA_ID,
                label: "Towers down",
                columns: { lat: "lat", lng: "lng" },
                isVisible: true,
                color: hexToRgb(TOWER_STATUS_COLOR.DOWN),
                visConfig: { radius: 30, opacity: 1, filled: true, outline: false },
              },
            },
          ],
        },
      },
    },
  });
}
