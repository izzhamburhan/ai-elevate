"use client";

import { useEffect } from "react";
import { layerVisConfigChange, wrapTo } from "@kepler.gl/actions";

import type { makeKeplerStore } from "./kepler-store";

type KeplerStore = ReturnType<typeof makeKeplerStore>;
type Layer = Parameters<typeof layerVisConfigChange>[0];
type Instance = { visState: { layers: Layer[] } };

/**
 * kepler paints a hovered point in its highlight color (yellow), whatever the point's own color: a
 * green tower would look DEGRADED under the cursor. Turn that off on every point layer, whether the
 * chat, a card or a restored chat added it, so a dot keeps its status color; the tooltip shows the hover.
 */
export function useTrueColorHover(store: KeplerStore, mapId: string) {
  useEffect(() => {
    let checked: unknown;
    const fix = () => {
      const layers = (store.getState().keplerGl as unknown as Record<string, Instance | undefined>)[mapId]?.visState.layers;
      if (!layers || layers === checked) return;
      checked = layers;
      // one layer per pass: the dispatch runs this again on the updated layers for the next one
      const layer = layers.find((l) => l.type === "point" && l.config.visConfig.showHighlightColor);
      if (layer) store.dispatch(wrapTo(mapId, layerVisConfigChange(layer, { showHighlightColor: false })));
    };
    fix();
    return store.subscribe(fix);
  }, [store, mapId]);
}