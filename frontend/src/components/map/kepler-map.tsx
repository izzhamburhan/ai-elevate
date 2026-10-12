"use client";

import { useEffect, useRef, useState } from "react";
import { Provider } from "react-redux";
import { mapStyleChange, wrapTo } from "@kepler.gl/actions";
import "maplibre-gl/dist/maplibre-gl.css";

import { KeplerGl, keplerLocaleMessages } from "./kepler-panels";
import { getTheme, useTheme } from "@/lib/theme";

import { keplerDarkTheme, keplerLightTheme } from "./kepler-theme";
import { BASEMAP_FOR_THEME, MAP_ID, makeKeplerStore } from "./kepler-store";
import { ChatProvider } from "./panels/assistant-panel";
import { useKeplerBridge } from "./use-kepler-bridge";
import { restoreFocus, showNetworkLayer } from "./network-layer";
import { OVERVIEW_POLL_MS, OVERVIEW_REFRESH_EVENT, refreshOverview } from "@/lib/network-overview";

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

  // swap the basemap whenever the app theme flips
  useEffect(() => {
    const styleType = BASEMAP_FOR_THEME[theme];
    const keplerGl = store.getState().keplerGl as Record<string, { mapStyle: { styleType: string } }>;
    if (keplerGl[MAP_ID]?.mapStyle.styleType !== styleType) {
      store.dispatch(wrapTo(MAP_ID, mapStyleChange(styleType)));
    }
  }, [store, theme]);

  // open on the live network, not an empty map; refreshed with the overview strip in the chat
  useEffect(() => {
    let current = true;
    const load = () =>
      refreshOverview().then((overview) => {
        if (!current || !overview) return;
        if (showNetworkLayer(store, overview)) restoreFocus(store);
      });
    void load();
    const timer = setInterval(load, OVERVIEW_POLL_MS);
    window.addEventListener(OVERVIEW_REFRESH_EVENT, load);
    return () => {
      current = false;
      clearInterval(timer);
      window.removeEventListener(OVERVIEW_REFRESH_EVENT, load);
    };
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
