"use client";

import { updateMap, wrapTo } from "@kepler.gl/actions";
import { WebMercatorViewport, flyToViewport, getFlyToDuration } from "@math.gl/web-mercator";

import type { makeKeplerStore } from "./kepler-store";

type KeplerStore = ReturnType<typeof makeKeplerStore>;
type MapState = { width: number; height: number; latitude: number; longitude: number; zoom: number; pitch: number; bearing: number };
type Instance = { mapState: MapState; uiState: { activeSidePanel: string | null } };

export type CameraView = { longitude: number; latitude: number; zoom: number; pitch?: number; bearing?: number };

/** Bounds of a flight's length: short hops still ease, long ones don't drag. */
const FLY_MIN_MS = 1100;
const FLY_MAX_MS = 2400;

const read = (store: KeplerStore, mapId: string) =>
  (store.getState().keplerGl as unknown as Record<string, Instance | undefined>)[mapId];

/** Screen pixels the open side panel covers on the map's left; zero once it is closed or would leave no map. */
export function panelInset(instance: Instance, panelWidth: number) {
  return instance.uiState.activeSidePanel && panelWidth < instance.mapState.width - 160 ? panelWidth : 0;
}

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The flight in progress, so a new one replaces it. */
let flight = 0;

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const sameView = (a: CameraView, b: CameraView) =>
  Math.abs(a.longitude - b.longitude) < 1e-6 && Math.abs(a.latitude - b.latitude) < 1e-6 && Math.abs(a.zoom - b.zoom) < 1e-6;

/**
 * Flies the camera along one smooth zoom-out, pan, zoom-in curve, easing pitch and bearing too.
 * kepler keeps its own view state and drops deck.gl's transition props, so this steps the view each
 * frame. Grabbing the map mid-flight (or another flight) stops it where it is. With reduced motion
 * the camera cuts straight to the end.
 */
export function flyTo(store: KeplerStore, mapId: string, end: CameraView) {
  const instance = read(store, mapId);
  if (!instance) return;
  cancelAnimationFrame(flight);
  const set = (view: CameraView) => store.dispatch(wrapTo(mapId, updateMap(view as Parameters<typeof updateMap>[0])));
  if (prefersReducedMotion()) return void set(end);

  const { width, height, pitch, bearing, longitude, latitude, zoom } = instance.mapState;
  const from = { width, height, longitude, latitude, zoom };
  const to = { ...from, longitude: end.longitude, latitude: end.latitude, zoom: end.zoom };
  const endPitch = end.pitch ?? pitch;
  const endBearing = end.bearing ?? bearing;
  const duration = Math.min(FLY_MAX_MS, Math.max(FLY_MIN_MS, getFlyToDuration(from, to)));
  const startedAt = performance.now();
  let last: CameraView = { longitude, latitude, zoom };

  const step = (now: number) => {
    const current = read(store, mapId)?.mapState;
    if (!current || !sameView(current, last)) return;
    const t = Math.min(1, (now - startedAt) / duration);
    const eased = easeInOutCubic(t);
    const path = t < 1 ? flyToViewport(from, to, eased) : end;
    last = { longitude: path.longitude, latitude: path.latitude, zoom: path.zoom };
    set({ ...last, pitch: lerp(pitch, endPitch, eased), bearing: lerp(bearing, endBearing, eased) });
    if (t < 1) flight = requestAnimationFrame(step);
  };
  flight = requestAnimationFrame(step);
}

/**
 * Flies to frame [minLng, minLat, maxLng, maxLat] in the map beside the side panel. A single point
 * (or a tiny box) opens at `maxZoom`.
 */
export function flyToBounds(
  store: KeplerStore,
  mapId: string,
  bounds: [number, number, number, number],
  { panelWidth, padding = 64, maxZoom = 12 }: { panelWidth: number; padding?: number; maxZoom?: number },
) {
  const instance = read(store, mapId);
  if (!instance) return;
  const { width, height } = instance.mapState;
  const left = panelInset(instance, panelWidth);
  // keep the padding sane on small maps, where 64px on each side would leave nothing
  const pad = Math.max(16, Math.min(padding, (width - left) / 6, height / 6));
  const [minLng, minLat, maxLng, maxLat] = bounds;
  const span = Math.max(maxLng - minLng, maxLat - minLat);
  let view: CameraView;
  if (span < 1e-4) {
    const viewport = new WebMercatorViewport({ width, height, longitude: minLng, latitude: minLat, zoom: maxZoom });
    const [longitude, latitude] = viewport.unproject([width / 2 - left / 2, height / 2]);
    view = { longitude, latitude, zoom: maxZoom };
  } else {
    const viewport = new WebMercatorViewport({ width, height }).fitBounds(
      [[minLng, minLat], [maxLng, maxLat]],
      { padding: { top: pad + 48, bottom: pad + 48, left: left + pad, right: pad + 48 }, maxZoom },
    );
    view = { longitude: viewport.longitude, latitude: viewport.latitude, zoom: viewport.zoom };
  }
  flyTo(store, mapId, { ...view, pitch: 0, bearing: 0 });
}
