"use client";

import { mapStyleChange, removeFilter, wrapTo } from "@kepler.gl/actions";
import { create } from "zustand";

import { runKeplerCommand } from "@/lib/kepler/commands";
import { MAX_SCENES, captureScene, parseScenes, planSceneRestore, type MapInventory, type MapScene, type RestorePlan } from "@/lib/map-scenes";

import { FOLLOWING_BASEMAPS } from "../basemap-choice";
import { flyTo } from "../camera";
import { type DeckInstance, type KeplerStore, readInstance } from "./use-kepler";

/**
 * Named scenes in this browser's localStorage. They hold references only (camera, basemap, layer
 * visibility, filters), so they are small and never carry a chat's data. Every chat's map shares
 * the list; restoring one applies what the open map has and reports the rest.
 */
const STORAGE_KEY = "elevate-map-scenes";

function load(): MapScene[] {
  try {
    return parseScenes(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

function persist(scenes: MapScene[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scenes));
    return true;
  } catch {
    return false;
  }
}

export const useScenes = create<{ scenes: MapScene[]; loaded: boolean; storageError: boolean }>(() => ({
  scenes: [],
  loaded: false,
  storageError: false,
}));

export function loadScenes() {
  if (useScenes.getState().loaded) return;
  useScenes.setState({ scenes: load(), loaded: true });
}

function save(scenes: MapScene[]) {
  useScenes.setState({ scenes, storageError: !persist(scenes) });
}

export function inventory(instance: DeckInstance): MapInventory {
  return {
    layers: instance.visState.layers.map((l) => ({ id: l.id, dataId: l.config.dataId, label: l.config.label })),
    datasets: Object.values(instance.visState.datasets).flatMap((d) => (d ? [{ id: d.id, fields: d.fields.map((f) => f.name) }] : [])),
    basemaps: Object.keys(instance.mapStyle.mapStyles ?? {}),
  };
}

/** Saves the open map as a scene; a scene with the same name is replaced. */
export function saveScene(store: KeplerStore, mapId: string, name: string) {
  const instance = readInstance(store, mapId);
  if (!instance) return null;
  const scene = captureScene(instance, name, `scene-${Date.now().toString(36)}`, Date.now());
  const rest = useScenes.getState().scenes.filter((s) => s.name.toLowerCase() !== scene.name.toLowerCase());
  save([scene, ...rest].slice(0, MAX_SCENES));
  return scene;
}

export function deleteScene(id: string) {
  save(useScenes.getState().scenes.filter((s) => s.id !== id));
}

/**
 * Applies a scene to the open map: basemap, layer visibility and filters for what still exists,
 * then a camera flight. Returns the plan, so the caller can say what was left out.
 */
export function restoreScene(store: KeplerStore, mapId: string, scene: MapScene): RestorePlan | null {
  const instance = readInstance(store, mapId);
  if (!instance) return null;
  const plan = planSceneRestore(scene, inventory(instance));
  const dispatch = (action: { type: string }) => store.dispatch(wrapTo(mapId, action as never));

  // the light/dark basemaps follow the app theme, as a saved chat's map does
  if (plan.basemap && plan.basemap !== instance.mapStyle.styleType && !FOLLOWING_BASEMAPS.includes(plan.basemap)) {
    dispatch(mapStyleChange(plan.basemap));
  }
  for (const { layerId, isVisible } of plan.layers) {
    runKeplerCommand(store, mapId, "update_layer", { layerId, isVisible });
  }
  // the scene's filters replace the map's; last first, so the indices stay valid
  for (let index = instance.visState.filters.length - 1; index >= 0; index--) dispatch(removeFilter(index));
  const applied = plan.filters.filter((filter) => {
    try {
      runKeplerCommand(store, mapId, "add_filter", { dataId: filter.dataId, field: filter.field, value: filter.value });
      return true;
    } catch {
      return false;
    }
  });
  flyTo(store, mapId, plan.camera);
  return {
    ...plan,
    filters: applied,
    missingFilters: [...plan.missingFilters, ...plan.filters.filter((f) => !applied.includes(f)).map((f) => f.field)],
  };
}
