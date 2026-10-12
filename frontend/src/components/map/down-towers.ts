import { addDataToMap } from "@kepler.gl/actions";
import { processRowObject } from "@kepler.gl/processors";

import { hexToRgb, TOWER_STATUS_COLOR } from "@/lib/map-colors";

import { PENINSULA_VIEW } from "./kepler-store";
import { currentTowerStatus, type TowerPin } from "./tower-status";

/** Dataset id of the down towers a new chat's map starts with; `TowerPulse` rings the same rows. */
export const DOWN_TOWERS_DATA_ID = "towers_down";

/** The "Tower outages" dataset for these towers, labelled for the tooltip; null when there are none. */
export function downTowersDataset(towers: TowerPin[]) {
  if (!towers.length) return null;
  const rows = towers.map(({ enodeb_name, town, state, lat, lng, status }) => ({ tower: enodeb_name, town, state, status, lat, lng }));
  const data = processRowObject(rows);
  return data ? { info: { id: DOWN_TOWERS_DATA_ID, label: "Tower outages" }, data } : null;
}

/**
 * The action that puts the down towers on a fresh map, over Peninsular Malaysia, labelled for the
 * tooltip. The dots sit under the glowing cores `TowerPulse` draws, so they mostly serve hover and
 * the Layers list; `DownTowerCount` keeps their rows in step with the live status afterwards.
 * Resolves to null when the tower MCP can't be reached or nothing is down, so the map simply starts
 * empty.
 */
export async function downTowersAction() {
  const towers = await currentTowerStatus().then(
    (status) => status.down,
    (error) => {
      console.warn("[map] Down towers unavailable:", error instanceof Error ? error.message : error);
      return [];
    },
  );
  const dataset = downTowersDataset(towers);
  if (!dataset) return null;

  return addDataToMap({
    datasets: dataset,
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
                label: "Tower outages",
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
