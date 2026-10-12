"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Provider } from "react-redux";
import { mapStyleChange, wrapTo } from "@kepler.gl/actions";
import "maplibre-gl/dist/maplibre-gl.css";

import { KeplerGl, keplerLocaleMessages } from "./kepler-panels";
import { getTheme, useTheme } from "@/lib/theme";

import { ChatFullscreenContext } from "./chat-fullscreen";
import { ChatMapSync } from "./chat-map-sync";
import { keplerDarkTheme, keplerLightTheme } from "./kepler-theme";
import { BASEMAP_FOR_THEME, makeKeplerStore } from "./kepler-store";
import { ChatProvider } from "./panels/assistant-panel";
import { useKeplerBridge } from "./use-kepler-bridge";

const MAP_ID = "workspace";
const SIDE_PANEL_WIDTH = 400;
/** kepler pads the panel by this on both sides (see `kepler-theme.ts`). */
const SIDE_PANEL_MARGIN = keplerLightTheme.sidePanel.margin.left;

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
  // fullscreen stretches the side panel over the whole map; kepler animates the width change
  const sidePanelWidth = isFullscreen
    ? Math.max(SIDE_PANEL_WIDTH, width - 2 * SIDE_PANEL_MARGIN)
    : SIDE_PANEL_WIDTH;

  // swap the basemap whenever the app theme flips
  useEffect(() => {
    const styleType = BASEMAP_FOR_THEME[theme];
    const keplerGl = store.getState().keplerGl as Record<string, { mapStyle: { styleType: string } }>;
    if (keplerGl[MAP_ID]?.mapStyle.styleType !== styleType) {
      store.dispatch(wrapTo(MAP_ID, mapStyleChange(styleType)));
    }
  }, [store, theme]);

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
              />
            </ChatFullscreenContext.Provider>
          </ChatProvider>
        </Provider>
      ) : null}
    </div>
  );
}
