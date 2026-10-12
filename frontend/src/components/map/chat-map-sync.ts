"use client";

import { useEffect, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import { ActionTypes, addDataToMap, mapStyleChange, resetMapConfig, updateMap, wrapTo } from "@kepler.gl/actions";
import KeplerGlSchema from "@kepler.gl/schemas";

import { loadMapSnapshot, saveMapSnapshot } from "@/components/chat/chat-history";
import { getTheme } from "@/lib/theme";

import { towerLayersAction } from "./down-towers";
import { basemapFor, FOLLOWING_BASEMAPS } from "./basemap-choice";
import { PENINSULA_VIEW, type makeKeplerStore } from "./kepler-store";

type KeplerStore = ReturnType<typeof makeKeplerStore>;
type KeplerAction = { type: (typeof ActionTypes)[keyof typeof ActionTypes] };

/** The parts of kepler's instance state that make up a chat's map. */
type KeplerInstance = {
  visState: {
    datasets: Record<string, unknown>;
    layers: unknown[];
    layerOrder: unknown[];
    filters: unknown[];
    interactionConfig: unknown;
    layerBlending: unknown;
    splitMaps: unknown[];
    animationConfig: unknown;
  };
  mapState: unknown;
  mapStyle: { styleType: string };
};

/** Panning fires many updates; save once the map has been still for this long. */
const SAVE_DELAY_MS = 1000;

/** Changes to any of these mean the chat's map changed (hover/selection state is left out). */
const signature = ({ visState: v, mapState, mapStyle }: KeplerInstance) => [
  v.datasets,
  v.layers,
  v.layerOrder,
  v.filters,
  v.interactionConfig,
  v.layerBlending,
  v.splitMaps,
  v.animationConfig,
  mapState,
  mapStyle.styleType,
];

/** Resolves once `ready()` is true; kepler adds datasets asynchronously. */
function waitFor(store: KeplerStore, ready: () => boolean, timeoutMs = 15_000) {
  return new Promise<void>((resolve, reject) => {
    if (ready()) return resolve();
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("kepler did not finish loading the map in time."));
    }, timeoutMs);
    const unsubscribe = store.subscribe(() => {
      if (!ready()) return;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });
}

/**
 * The map a new chat starts with: the network as it is right now (outages on top), over Peninsular
 * Malaysia. Resolves to the datasets added; without the tower MCP the map starts empty on the same view.
 */
async function addStartingData(dispatch: (action: KeplerAction) => void, isCurrent: () => boolean) {
  const towers = await towerLayersAction();
  if (!isCurrent()) return [];
  if (!towers) {
    dispatch(updateMap(PENINSULA_VIEW));
    return [];
  }
  dispatch(towers.action);
  return towers.dataIds;
}

/**
 * Keeps one map per chat: saves the map (debounced) under the open chat and, on a chat switch,
 * saves the outgoing chat's map and swaps in the incoming one's, or a fresh map for a new chat.
 * A chat is only stored once it has a message, so a new chat's map is saved from then on.
 */
function createChatMapSync(store: KeplerStore, mapId: string) {
  const read = () => (store.getState().keplerGl as unknown as Record<string, KeplerInstance | undefined>)[mapId];
  const dispatch = (action: KeplerAction) => store.dispatch(wrapTo(mapId, action));

  let current: { threadId?: string; remoteId?: string } = {};
  let generation = 0;
  let restoring = false;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSignature: unknown[] | undefined;
  // datasets rarely change while the view does, so only re-serialise them when they do
  let savedDatasets: { source: unknown; saved: unknown } | undefined;

  function flush() {
    clearTimeout(timer);
    timer = undefined;
    const instance = read();
    if (!dirty || restoring || !current.remoteId || !instance) return;
    dirty = false;
    if (savedDatasets?.source !== instance.visState.datasets) {
      savedDatasets = { source: instance.visState.datasets, saved: KeplerGlSchema.getDatasetToSave(instance) };
    }
    void saveMapSnapshot(current.remoteId, {
      datasets: savedDatasets.saved,
      config: KeplerGlSchema.getConfigToSave(instance),
      savedAt: Date.now(),
    });
  }

  function onStoreChange() {
    const instance = read();
    if (restoring || !instance) return;
    const next = signature(instance);
    if (lastSignature?.every((part, i) => part === next[i])) return;
    lastSignature = next;
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DELAY_MS);
  }

  async function show(remoteId: string | undefined, isCurrent: () => boolean) {
    const snapshot = remoteId ? await loadMapSnapshot(remoteId) : undefined;
    await waitFor(store, () => Boolean(read()));
    if (!isCurrent()) return;

    dispatch(resetMapConfig());
    if (!snapshot) {
      dispatch(mapStyleChange(basemapFor(getTheme())));
      const ids = await addStartingData(dispatch, isCurrent);
      await waitFor(store, () => ids.every((id) => read()?.visState.datasets[id]));
      return;
    }

    const { datasets, config } = KeplerGlSchema.load(snapshot.datasets, snapshot.config);
    dispatch(
      addDataToMap({ datasets: datasets ?? [], config: config ?? undefined, options: { centerMap: false, keepExistingConfig: false } }),
    );
    // the light/dark basemaps follow the app theme and basemap pick, not those the map was saved with
    const themed = basemapFor(getTheme());
    const styleType = read()?.mapStyle.styleType;
    if (styleType && styleType !== themed && FOLLOWING_BASEMAPS.includes(styleType)) dispatch(mapStyleChange(themed));
    const ids = (datasets ?? []).map((d) => d.info.id).filter((id): id is string => Boolean(id));
    await waitFor(store, () => ids.every((id) => read()?.visState.datasets[id]));
  }

  return {
    async select(threadId: string, remoteId: string | undefined) {
      if (threadId === current.threadId) {
        // a new chat got stored with its first message: save the map it has so far
        current.remoteId = remoteId;
        flush();
        return;
      }

      flush(); // the outgoing chat's map, before it is replaced
      const run = ++generation;
      current = { threadId, remoteId };
      restoring = true;
      try {
        await show(remoteId, () => run === generation);
      } catch (error) {
        console.warn("[chat-map] Could not restore this chat's map:", error);
      } finally {
        if (run === generation) {
          restoring = false;
          dirty = false;
          const instance = read();
          lastSignature = instance ? signature(instance) : undefined;
        }
      }
    },
    /** Starts saving map changes; the returned cleanup saves anything pending and stops. */
    watch() {
      const unsubscribe = store.subscribe(onStoreChange);
      return () => {
        unsubscribe();
        flush();
      };
    },
  };
}

/** Gives every chat its own map; render inside `<ChatProvider>`. */
export function ChatMapSync({ store, mapId }: { store: KeplerStore; mapId: string }) {
  const [sync] = useState(() => createChatMapSync(store, mapId));
  const threadId = useAuiState((s) => s.threads.mainThreadId);
  const remoteId = useAuiState(
    (s) => s.threads.threadItems.find((t) => t.id === s.threads.mainThreadId)?.remoteId,
  );

  useEffect(() => {
    void sync.select(threadId, remoteId);
  }, [sync, threadId, remoteId]);

  useEffect(() => sync.watch(), [sync]);

  return null;
}
