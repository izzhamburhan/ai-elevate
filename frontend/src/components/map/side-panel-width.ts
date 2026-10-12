"use client";

import { createContext, useContext } from "react";

/** Width the side panel opens at, and returns to on a double-click of its resize handle. */
export const DEFAULT_PANEL_WIDTH = 400;
/** Narrower than this and the chat's cards and composer start to wrap badly. */
export const MIN_PANEL_WIDTH = 320;

const STORAGE_KEY = "elevate-side-panel-width";

/** The width the user last dragged the panel to, or the default. */
export function loadPanelWidth(): number {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return saved >= MIN_PANEL_WIDTH ? saved : DEFAULT_PANEL_WIDTH;
  } catch {
    return DEFAULT_PANEL_WIDTH;
  }
}

export function savePanelWidth(width: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(Math.round(width)));
  } catch {
    // storage unavailable (private mode etc.) — the width just won't persist
  }
}

type SidePanelWidthValue = {
  /** Width kepler renders the panel at now. */
  width: number;
  /** Widest the panel may be dragged, leaving some map beside it. */
  maxWidth: number;
  /** Clamped to `MIN_PANEL_WIDTH`..`maxWidth`. */
  setWidth: (width: number) => void;
};

/**
 * The side panel's width, owned by `KeplerMap` (it sets kepler's `sidePanelWidth`); changed by
 * the drag handle on the panel's right edge.
 */
export const SidePanelWidthContext = createContext<SidePanelWidthValue>({
  width: DEFAULT_PANEL_WIDTH,
  maxWidth: DEFAULT_PANEL_WIDTH,
  setWidth: () => {},
});

export function useSidePanelWidth() {
  return useContext(SidePanelWidthContext);
}
