import {
  applyMiddleware,
  combineReducers,
  legacy_createStore as createStore,
} from "redux";
import { enhanceReduxMiddleware, keplerGlReducer, uiStateUpdaters } from "@kepler.gl/reducers";

const { DEFAULT_MAP_CONTROLS } = uiStateUpdaters;

import type { Theme } from "@/lib/theme";

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

/** Id of the one kepler instance in this app. */
export const MAP_ID = "workspace";

/** CARTO basemaps (no Mapbox token needed) matching the app theme. */
export const BASEMAP_FOR_THEME = { light: "positron", dark: "dark-matter" } as const;

const makeReducers = (styleType: string) =>
  combineReducers({
    keplerGl: keplerGlReducer.initialState({
      mapState: MALAYSIA_VIEW,
      // open on the chat tab (custom panel, see kepler-panels.tsx)
      uiState: {
        currentModal: null,
        activeSidePanel: "assistant",
        // legend open from the start: plotted towers are colored by status/severity and need a key
        mapControls: {
          ...DEFAULT_MAP_CONTROLS,
          mapLegend: { ...DEFAULT_MAP_CONTROLS.mapLegend, active: true },
        },
      },
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
