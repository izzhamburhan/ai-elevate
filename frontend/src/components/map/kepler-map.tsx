"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Provider } from "react-redux";
import { addLayer, mapStyleChange, reorderLayer, wrapTo } from "@kepler.gl/actions";
import "maplibre-gl/dist/maplibre-gl.css";

import { KeplerGl, keplerLocaleMessages } from "./kepler-panels";
import { getTheme, useTheme } from "@/lib/theme";

import { ChatFullscreenContext } from "./chat-fullscreen";
import { ChatMapSync } from "./chat-map-sync";
import { DownTowerCount } from "./down-tower-count";
import { keplerDarkTheme, keplerLightTheme } from "./kepler-theme";
import { basemapFor, useBasemapKind } from "./basemap-choice";
import { MAP_ID, makeKeplerStore } from "./kepler-store";
import { ChatProvider } from "./panels/assistant-panel";
import { TowerPulse } from "./tower-pulse";
import { useKeplerBridge } from "./use-kepler-bridge";
import { runKeplerCommand } from "@/lib/kepler/commands";
import { WEATHER_DEMO_MODE } from "@/lib/weather/demo";

const SIDE_PANEL_WIDTH = 400;
/** kepler pads the panel by this on both sides (see `kepler-theme.ts`). */
const SIDE_PANEL_MARGIN = keplerLightTheme.sidePanel.margin.left;
/** Map left visible beside a narrow-screen panel, so its close button (and some map) stays on screen. */
const COLLAPSE_GUTTER = 40;
const DEMO_GEOGRAPHY_URL = "/data/weather-demo-outline.geojson";

/** Local, coarse Natural Earth context replaces remote tiles only in the opt-in pitch. */
async function loadDemoGeography(store: ReturnType<typeof makeKeplerStore>) {
  const response = await fetch(DEMO_GEOGRAPHY_URL);
  if (!response.ok) throw new Error("Cached demo geography is unavailable");
  const geojson = await response.json();
  const dataId = "weather-demo-outline";
  await runKeplerCommand(store, MAP_ID, "load_data", {
    dataId, label: "Natural Earth geography (public domain, coarse)", geojson,
    autoCreateLayers: false, centerMap: false,
  });
  const layerId = "weather-demo-outline-layer";
  // The saved GeoJSON schema examines visConfig before constructing layer defaults.
  // Supply it in the native action so no intermediate layer has undefined radius settings.
  store.dispatch(wrapTo(MAP_ID, addLayer({
    id: layerId, type: "geojson",
    config: {
      dataId, label: "Local geographic context · Natural Earth", isVisible: true,
      columns: { geojson: "_geojson" }, color: [100, 116, 139],
      visConfig: { filled: true, stroked: true, opacity: 0.12, strokeOpacity: 0.45,
        strokeColor: [148, 163, 184], thickness: 0.6, allowHover: false,
        radius: 10, radiusRange: [0, 50], enable3d: false, wireframe: false },
    },
    visualChannels: { colorField: null, colorScale: "quantile", strokeColorField: null,
      strokeColorScale: "quantile", sizeField: null, sizeScale: "linear",
      heightField: null, heightScale: "linear", radiusField: null, radiusScale: "linear" },
  })));
  const state = store.getState().keplerGl as Record<string, {
    visState: { layerOrder: Parameters<typeof reorderLayer>[0] };
  }>;
  // Kepler renders the order in reverse; keep the geographic context beneath all points.
  const order = state[MAP_ID].visState.layerOrder.filter((entry) => entry !== layerId);
  store.dispatch(wrapTo(MAP_ID, reorderLayer([...order, layerId])));
}

type MapLike = { once(type: string, listener: () => void): unknown; fire(type: string): unknown };
const announced = new WeakSet<object>();

/**
 * kepler shows the basemap's credit ("© OpenStreetMap contributors") from what it collects on the
 * map's `style.load`, but it misses the first one: the inline basemap style has loaded before kepler
 * listens. Once a map first goes idle, announce its style again so kepler collects the credit.
 */
function announceStyleOnFirstIdle(ref: unknown) {
  const map = (ref as { getMap?: () => MapLike } | null)?.getMap?.();
  if (!map || announced.has(map)) return;
  announced.add(map);
  map.once("idle", () => map.fire("style.load"));
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.floor(width), height: Math.floor(height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, size] as const;
}

export default function KeplerMap() {
  const [store] = useState(() => makeKeplerStore(getTheme()));
  const [containerRef, { width, height }] = useElementSize<HTMLDivElement>();
  const theme = useTheme();
  useKeplerBridge(store, MAP_ID);
  const [isFullscreen, setFullscreen] = useState(false);
  const fullscreen = useMemo(() => ({ isFullscreen, setFullscreen }), [isFullscreen]);
  // fullscreen stretches the side panel over the whole map; kepler animates the width change.
  // Never wider than the screen: on a phone the panel shrinks and leaves a strip of map for its
  // close button.
  const fullWidth = Math.max(0, width - 2 * SIDE_PANEL_MARGIN);
  const sidePanelWidth = isFullscreen
    ? fullWidth
    : Math.min(SIDE_PANEL_WIDTH, fullWidth - COLLAPSE_GUTTER);

  // swap the basemap whenever the app theme flips or the user picks the other basemap
  const basemapKind = useBasemapKind();
  useEffect(() => {
    const styleType = basemapFor(theme, basemapKind);
    const keplerGl = store.getState().keplerGl as Record<string, { mapStyle: { styleType: string } }>;
    if (keplerGl[MAP_ID]?.mapStyle.styleType !== styleType) {
      store.dispatch(wrapTo(MAP_ID, mapStyleChange(styleType)));
    }
  }, [store, theme, basemapKind]);

  // opt-in pitch mode (NEXT_PUBLIC_WEATHER_DEMO_MODE=1): local Natural Earth outlines instead of remote tiles
  const demoLoaded = useRef(false);
  useEffect(() => {
    if (!WEATHER_DEMO_MODE || demoLoaded.current) return;
    demoLoaded.current = true;
    loadDemoGeography(store).catch((err) => console.error("Failed to load the demo geography", err));
  }, [store]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      {width > 0 && height > 0 ? (
        <Provider store={store}>
          <ChatProvider>
            <ChatFullscreenContext.Provider value={fullscreen}>
              {/* each chat has its own map, starting from the sample data */}
              <ChatMapSync store={store} mapId={MAP_ID} />
              <KeplerGl
                id={MAP_ID}
                // keep the instance state on unmount: Strict Mode / Fast Refresh remounts would
                // otherwise delete it and crash kepler's selectors ("reading 'visState'")
                mint={false}
                width={width}
                height={height}
                theme={theme === "dark" ? keplerDarkTheme : keplerLightTheme}
                appName="Elevate"
                version="Map"
                sidePanelWidth={sidePanelWidth}
                localeMessages={keplerLocaleMessages}
                getMapboxRef={announceStyleOnFirstIdle}
              />
              <TowerPulse store={store} mapId={MAP_ID} />
              <DownTowerCount store={store} mapId={MAP_ID} panelWidth={sidePanelWidth + 2 * SIDE_PANEL_MARGIN} />
            </ChatFullscreenContext.Provider>
          </ChatProvider>
        </Provider>
      ) : null}
    </div>
  );
}
