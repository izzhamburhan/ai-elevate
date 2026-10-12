"use client";

import { useEffect, useRef, useState } from "react";
import { Provider } from "react-redux";
import { addDataToMap, addLayer, mapStyleChange, reorderLayer, wrapTo } from "@kepler.gl/actions";
import { processCsvData } from "@kepler.gl/processors";
import "maplibre-gl/dist/maplibre-gl.css";

import { KeplerGl, keplerLocaleMessages } from "./kepler-panels";
import { getTheme, useTheme } from "@/lib/theme";

import { keplerDarkTheme, keplerLightTheme } from "./kepler-theme";
import { BASEMAP_FOR_THEME, MALAYSIA_VIEW, MAP_ID, makeKeplerStore } from "./kepler-store";
import { ChatProvider } from "./panels/assistant-panel";
import { useKeplerBridge } from "./use-kepler-bridge";
import { runKeplerCommand } from "@/lib/kepler/commands";
import { WEATHER_DEMO_MODE } from "@/lib/weather/demo";

const SAMPLE_DATA_URL = "/data/world-cities.csv";
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
  const loaded = useRef(false);
  const theme = useTheme();
  useKeplerBridge(store, MAP_ID);

  // swap the basemap whenever the app theme flips
  useEffect(() => {
    const styleType = BASEMAP_FOR_THEME[theme];
    const keplerGl = store.getState().keplerGl as Record<string, { mapStyle: { styleType: string } }>;
    if (keplerGl[MAP_ID]?.mapStyle.styleType !== styleType) {
      store.dispatch(wrapTo(MAP_ID, mapStyleChange(styleType)));
    }
  }, [store, theme]);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;

    fetch(SAMPLE_DATA_URL)
      .then((res) => res.text())
      .then(async (csv) => {
        const data = processCsvData(csv);
        if (!data) throw new Error("Sample CSV could not be parsed");
        store.dispatch(
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
        if (WEATHER_DEMO_MODE) await loadDemoGeography(store);
      })
      .catch((err) => console.error("Failed to load sample data", err));
  }, [store]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      {width > 0 && height > 0 ? (
        <Provider store={store}>
          <ChatProvider>
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
              sidePanelWidth={400}
              localeMessages={keplerLocaleMessages}
            />
          </ChatProvider>
        </Provider>
      ) : null}
    </div>
  );
}
