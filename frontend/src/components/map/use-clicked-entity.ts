"use client";

import { useSelector } from "react-redux";

import { MAP_ID, type KeplerRootState } from "./kepler-store";

/** Field names that identify a tower or site, best first. */
const ID_FIELDS = [/^enodeb_?name$/i, /^tower(_?(id|name))?$/i, /^site_?id$/i, /^site(_?name)?$/i, /^name$/i, /^id$/i];

type KeplerField = { name: string };
type KeplerDataset = { fields: KeplerField[]; dataContainer: unknown };
type KeplerClicked = {
  object?: unknown;
  layer?: {
    config?: { dataId?: string };
    getHoverData?: (object: unknown, dataContainer: unknown, fields: KeplerField[]) => unknown;
  };
};

export type ClickedEntity = { label: string; field: string };

/**
 * The tower/site the user last clicked on the map, read from kepler's `visState.clicked`.
 * Undefined when nothing is selected or the clicked layer has no identifying column.
 */
export function useClickedEntity(): ClickedEntity | undefined {
  return useSelector((state: KeplerRootState) => {
    try {
      const vis = (state.keplerGl as Record<string, { visState?: { clicked?: KeplerClicked; datasets?: Record<string, KeplerDataset> } }>)[MAP_ID]?.visState;
      const clicked = vis?.clicked;
      const dataset = clicked?.layer?.config?.dataId ? vis?.datasets?.[clicked.layer.config.dataId] : undefined;
      if (!clicked?.object || !clicked.layer?.getHoverData || !dataset) return undefined;

      const row = clicked.layer.getHoverData(clicked.object, dataset.dataContainer, dataset.fields);
      if (!Array.isArray(row)) return undefined;
      for (const pattern of ID_FIELDS) {
        const index = dataset.fields.findIndex((f) => pattern.test(f.name));
        const value = index >= 0 ? row[index] : undefined;
        if (typeof value === "string" || typeof value === "number") {
          return { label: String(value), field: dataset.fields[index].name };
        }
      }
    } catch {
      // a layer type kepler cannot describe: no chip
    }
    return undefined;
  }, (a, b) => a?.label === b?.label && a?.field === b?.field);
}
