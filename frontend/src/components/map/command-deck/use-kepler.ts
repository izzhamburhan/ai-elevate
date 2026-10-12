"use client";

import { useEffect, useRef, useState } from "react";
import { WebMercatorViewport } from "@math.gl/web-mercator";

import type { makeKeplerStore } from "../kepler-store";

export type KeplerStore = ReturnType<typeof makeKeplerStore>;

export type DeckMapState = { width: number; height: number; latitude: number; longitude: number; zoom: number; pitch: number; bearing: number };
export type DeckLayer = {
  id: string;
  type?: string;
  config: { dataId: string; label?: string; isVisible: boolean; color?: number[] };
};
export type DeckDataset = {
  id: string;
  label?: string;
  fields: { name: string }[];
  dataContainer: { numRows(): number; valueAt(row: number, column: number): unknown };
};
export type DeckInstance = {
  mapState: DeckMapState;
  mapStyle: { styleType: string; mapStyles: Record<string, unknown> };
  uiState: { activeSidePanel: string | null };
  visState: {
    layers: DeckLayer[];
    layerOrder: string[];
    datasets: Record<string, DeckDataset | undefined>;
    filters: { dataId: string[] | string; name: string[] | string; value: unknown }[];
  };
};

export const readInstance = (store: KeplerStore, mapId: string) =>
  (store.getState().keplerGl as unknown as Record<string, DeckInstance | undefined>)[mapId];

/**
 * A value derived from the kepler instance, recomputed when any of the `deps` parts change and
 * re-rendered only when `isEqual` says the result changed. Cheap enough for every store update.
 */
export function useKeplerValue<T>(
  store: KeplerStore,
  mapId: string,
  deps: (instance: DeckInstance) => unknown[],
  derive: (instance: DeckInstance) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T | undefined {
  const deriveRef = useRef({ deps, derive, isEqual });
  useEffect(() => {
    deriveRef.current = { deps, derive, isEqual };
  });
  const [value, setValue] = useState<T | undefined>(() => {
    const instance = readInstance(store, mapId);
    return instance ? derive(instance) : undefined;
  });

  useEffect(() => {
    let last: unknown[] | undefined;
    let current: T | undefined;
    const update = () => {
      const instance = readInstance(store, mapId);
      if (!instance) return;
      const { deps, derive, isEqual } = deriveRef.current;
      const next = deps(instance);
      if (last && next.length === last.length && next.every((part, i) => part === last![i])) return;
      last = next;
      const value = derive(instance);
      if (current !== undefined && isEqual(current, value)) return;
      current = value;
      setValue(value);
    };
    update();
    return store.subscribe(update);
  }, [store, mapId]);

  return value;
}

/** Projects [lng, lat] points to screen pixels for the current camera. */
export function projector(mapState: DeckMapState) {
  const { width, height, latitude, longitude, zoom, pitch, bearing } = mapState;
  const viewport = new WebMercatorViewport({ width, height, latitude, longitude, zoom, pitch, bearing });
  return (lng: number, lat: number) => viewport.project([lng, lat]) as [number, number];
}

/** "15:18" in Malaysia time. */
export const formatMyt = (value: string | number | Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));

/** "13 Oct, 15:18" in Malaysia time. */
export const formatMytDate = (value: string | number | Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
