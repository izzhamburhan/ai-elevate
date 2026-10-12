"use client";

import { useEffect, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import { ActionTypes, addDataToMap, mapStyleChange, resetMapConfig, wrapTo } from "@kepler.gl/actions";
import { processCsvData } from "@kepler.gl/processors";
import KeplerGlSchema from "@kepler.gl/schemas";

import { loadMapSnapshot, saveMapSnapshot } from "@/components/chat/chat-history";
import { getTheme } from "@/lib/theme";

import { BASEMAP_FOR_THEME, MALAYSIA_VIEW, type makeKeplerStore } from "./kepler-store";

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

const SAMPLE_DATA_URL = "/data/world-cities.csv";
/** Panning fires many updates; save once the map has been still for this long. */
const SAVE_DELAY_MS = 1000;

const THEME_BASEMAPS: readonly string[] = Object.values(BASEMAP_FOR_THEME);

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

let sampleCsv: Promise<string> | undefined;

/** The map a new chat starts with: the sample cities over Malaysia. */
async function addSampleData(dispatch: (action: KeplerAction) => void) {
  sampleCsv ??= fetch(SAMPLE_DATA_URL).then((res) => res.text());
  const data = processCsvData(await sampleCsv);
  if (!data) throw new Error("Sample CSV could not be parsed");
  dispatch(
    addDataToMap({
      datasets: {
        info: { id: "cities", label: "World cities (sample)" },
        data,
      },
      // keep the Malaysia view instead of fitting to the (world-wide) sample data
      options: { centerMap: false },
      config: {
        version: "v1",
        config: {
          mapState: MALAYSIA_VIEW,
          visState: {
            layers: [
              {
                id: "cities-points",
                type: "point",
                config: {
                  dataId: "cities",
                  label: "Cities",
                  columns: { lat: "lat", lng: "lng" },
                  isVisible: true,
                  color: [124, 92, 255],
                  visConfig: {
                    radius: 14,
                    opacity: 0.8,
                    filled: true,
                    outline: false,
                    radiusRange: [4, 36],
                    colorRange: {
                      name: "Lavender",
                      type: "sequential",
                      category: "Custom",
                      colors: ["#e2d6ff", "#bd9fff", "#9b7bff", "#7c5cff", "#5b3fd6", "#3d2a99"],
                    },
                  },
                },
                visualChannels: {
                  colorField: { name: "population", type: "integer" },
                  colorScale: "quantile",
                  sizeField: { name: "population", type: "integer" },
                  sizeScale: "sqrt",
                },
              },
            ],
          },
        },
      },
    }),
  );
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
      dispatch(mapStyleChange(BASEMAP_FOR_THEME[getTheme()]));
      await addSampleData(dispatch);
      if (!isCurrent()) return;
      await waitFor(store, () => Boolean(read()?.visState.datasets.cities));
      return;
    }

    const { datasets, config } = KeplerGlSchema.load(snapshot.datasets, snapshot.config);
    dispatch(
      addDataToMap({ datasets: datasets ?? [], config: config ?? undefined, options: { centerMap: false, keepExistingConfig: false } }),
    );
    // the light/dark basemaps follow the app theme rather than the theme the map was saved in
    const themed = BASEMAP_FOR_THEME[getTheme()];
    const styleType = read()?.mapStyle.styleType;
    if (styleType && styleType !== themed && THEME_BASEMAPS.includes(styleType)) dispatch(mapStyleChange(themed));
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
