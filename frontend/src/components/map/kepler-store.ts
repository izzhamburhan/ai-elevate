import {
  applyMiddleware,
  combineReducers,
  legacy_createStore as createStore,
} from "redux";
import { enhanceReduxMiddleware, keplerGlReducer } from "@kepler.gl/reducers";

import type { Theme } from "@/lib/theme";
import { weatherDemoBasemap } from "@/lib/weather/demo";

/**
 * Peninsular Malaysia + Sabah/Sarawak (lng ~99.6–119.3). The center sits west of
 * the country's midpoint so it lands in the map area right of the side panel.
 */
export const MALAYSIA_VIEW = {
  latitude: 4.2,
  longitude: 105,
  zoom: 5.3,
  pitch: 0,
  bearing: 0,
};

export const MAP_ID = "workspace";

/** Normal themes use CARTO; the opt-in cached pitch uses Kepler's network-free basemap. */
export const BASEMAP_FOR_THEME = {
  light: weatherDemoBasemap("light"), dark: weatherDemoBasemap("dark"),
} as const;

const makeReducers = (styleType: string) =>
  combineReducers({
    keplerGl: keplerGlReducer.initialState({
      mapState: MALAYSIA_VIEW,
      // open on the chat tab (custom panel, see kepler-panels.tsx)
      uiState: { currentModal: null, activeSidePanel: "assistant" },
      mapStyle: { styleType },
    }),
  });

export type KeplerRootState = ReturnType<ReturnType<typeof makeReducers>>;

export function makeKeplerStore(theme: Theme) {
  return createStore(
    makeReducers(BASEMAP_FOR_THEME[theme]),
    {},
    applyMiddleware(...enhanceReduxMiddleware([])),
  );
}
