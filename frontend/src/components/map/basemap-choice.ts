import { useSyncExternalStore } from "react";

import type { Theme } from "@/lib/theme";
import { WEATHER_DEMO_MODE, weatherDemoBasemap } from "@/lib/weather/demo";

import { BASEMAP_DARK, BASEMAP_LIGHT, BASEMAP_OSM_DARK, BASEMAP_OSM_LIGHT } from "./basemaps";

/** The basemap family the user picked: the Elevate vector map, or OpenStreetMap's raster tiles. */
export type BasemapKind = "vector" | "osm";

const STORAGE_KEY = "elevate-basemap";

/**
 * Basemaps that follow the app theme and this choice. CARTO's are the ones chats were saved with
 * before the OSM basemaps; a saved chat on any of these opens on the current pick instead.
 */
export const FOLLOWING_BASEMAPS: readonly string[] = [
  BASEMAP_DARK,
  BASEMAP_LIGHT,
  BASEMAP_OSM_DARK,
  BASEMAP_OSM_LIGHT,
  "positron",
  "dark-matter",
];

let kind: BasemapKind | undefined;
const listeners = new Set<() => void>();

export function getBasemapKind(): BasemapKind {
  if (!kind) {
    try {
      kind = localStorage.getItem(STORAGE_KEY) === "osm" ? "osm" : "vector";
    } catch {
      kind = "vector";
    }
  }
  return kind;
}

export function setBasemapKind(next: BasemapKind) {
  kind = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // storage unavailable (private mode etc.) — the choice just won't persist
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBasemapKind(): BasemapKind {
  return useSyncExternalStore(subscribe, getBasemapKind, () => "vector");
}

/** The basemap for this theme and choice; the opt-in weather pitch keeps its network-free one. */
export function basemapFor(theme: Theme, choice: BasemapKind = getBasemapKind()) {
  if (WEATHER_DEMO_MODE) return weatherDemoBasemap(theme);
  if (choice === "osm") return theme === "dark" ? BASEMAP_OSM_DARK : BASEMAP_OSM_LIGHT;
  return theme === "dark" ? BASEMAP_DARK : BASEMAP_LIGHT;
}
