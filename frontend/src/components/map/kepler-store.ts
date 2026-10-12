import {
  applyMiddleware,
  combineReducers,
  legacy_createStore as createStore,
} from "redux";
import { enhanceReduxMiddleware, keplerGlReducer } from "@kepler.gl/reducers";

import type { Theme } from "@/lib/theme";

import { basemapFor } from "./basemap-choice";
import { mapStyles } from "./basemaps";

/**
 * Peninsular Malaysia only (lat ~1.2–6.8, lng ~99.6–104.6), so the first view is land rather than
 * the South China Sea. The center sits west of the peninsula's midpoint (102.1) so the peninsula
 * lands in the map area right of the 400px side panel.
 */
export const PENINSULA_VIEW = {
  latitude: 3.95,
  longitude: 100.3,
  zoom: 6.3,
  pitch: 0,
  bearing: 0,
};

export const MAP_ID = "workspace";

const makeReducers = (styleType: string) =>
  combineReducers({
    keplerGl: keplerGlReducer.initialState({
      mapState: PENINSULA_VIEW,
      // open on the chat tab (custom panel, see kepler-panels.tsx)
      uiState: { currentModal: null, activeSidePanel: "assistant" },
      mapStyle: { styleType, mapStyles: mapStyles() },
    }),
  });

export type KeplerRootState = ReturnType<ReturnType<typeof makeReducers>>;

export function makeKeplerStore(theme: Theme) {
  return createStore(
    makeReducers(basemapFor(theme)),
    {},
    applyMiddleware(...enhanceReduxMiddleware([])),
  );
}
