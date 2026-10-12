"use client";

import { toggleSidePanel, wrapTo } from "@kepler.gl/actions";

import type { HermesJob } from "@/lib/hermes/contracts";
import { investigationSites, sitesBounds, type InvestigationSite } from "@/lib/hermes/investigation";
import { loadHermesOverlay } from "@/lib/hermes/map-overlay";

import { flyToBounds } from "../camera";
import { useHermesSelection } from "../panels/hermes-selection";
import { keplerLightTheme } from "../kepler-theme";
import { setDeckFocus } from "./deck-focus";
import { type KeplerStore, readInstance } from "./use-kepler";

/** kepler pads the side panel by this on both sides. */
export const SIDE_PANEL_MARGIN = keplerLightTheme.sidePanel.margin.left;

/**
 * Puts the investigation's source-backed sites on the map (the existing Hermes evidence layer, which
 * replaces only its own dataset) and flies to frame them. Throws when there is nothing to map.
 */
export async function showInvestigationOnMap(store: KeplerStore, mapId: string, job: HermesJob, panelWidth: number) {
  await loadHermesOverlay(store, job);
  useHermesSelection.setState({ mappedId: job.investigation_id });
  const bounds = sitesBounds(investigationSites(job));
  if (bounds) flyToBounds(store, mapId, bounds, { panelWidth, maxZoom: 11.5 });
}

/** Flies to one site and puts the reticle on it. */
export function focusSite(store: KeplerStore, mapId: string, site: InvestigationSite, panelWidth: number) {
  setDeckFocus({ key: site.key, lng: site.lng, lat: site.lat, label: site.name, detail: site.detail, tone: site.tone });
  flyToBounds(store, mapId, [site.lng, site.lat, site.lng, site.lat], { panelWidth, maxZoom: 12.5 });
}

/** Opens a side-panel tab (kepler's toggle would close it if it were already open). */
export function openSidePanel(store: KeplerStore, mapId: string, panel: string) {
  if (readInstance(store, mapId)?.uiState.activeSidePanel !== panel) store.dispatch(wrapTo(mapId, toggleSidePanel(panel)));
}
