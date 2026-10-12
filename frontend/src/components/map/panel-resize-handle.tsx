"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";

import { keplerLightTheme } from "./kepler-theme";
import { DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH, savePanelWidth, useSidePanelWidth } from "./side-panel-width";

/** kepler pads the panel inside its container by this (see `kepler-theme.ts`). */
const MARGIN = keplerLightTheme.sidePanel.margin;

/** Pixels one arrow key press moves the edge. */
const KEY_STEP = 24;

/**
 * Drag handle on the side panel's right edge: drag to widen or narrow the panel, double-click to
 * reset it, or focus it and use the arrow keys. The width is remembered in this browser.
 */
export function PanelResizeHandle() {
  const { width, maxWidth, setWidth } = useSidePanelWidth();
  const drag = useRef<{ startX: number; startWidth: number; width: number; frame: number } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width, width, frame: 0 };
    // kepler animates width changes over 250ms; follow the pointer instead (globals.css)
    document.body.dataset.panelResizing = "";
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    state.width = state.startWidth + event.clientX - state.startX;
    // one kepler re-render per frame, however fast the pointer moves
    if (!state.frame) {
      state.frame = requestAnimationFrame(() => {
        state.frame = 0;
        setWidth(state.width);
      });
    }
  };

  /** Sets and remembers a width, for the end of a drag, a key press or a reset. */
  const resize = (next: number) => {
    const clamped = Math.min(Math.max(next, MIN_PANEL_WIDTH), maxWidth);
    setWidth(clamped);
    savePanelWidth(clamped);
  };

  const endDrag = () => {
    const state = drag.current;
    if (!state) return;
    cancelAnimationFrame(state.frame);
    drag.current = null;
    delete document.body.dataset.panelResizing;
    resize(state.width);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -KEY_STEP, ArrowRight: KEY_STEP }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    resize(width + step);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuenow={width}
      aria-valuemin={MIN_PANEL_WIDTH}
      aria-valuemax={maxWidth}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => resize(DEFAULT_PANEL_WIDTH)}
      onKeyDown={onKeyDown}
      // positioned against kepler's panel container, which pads the panel by MARGIN on each side;
      // a 12px hit area centred on the panel's right edge, its 2px line shown on hover, drag and focus
      className="group absolute z-10 w-3 -translate-x-1/2 cursor-col-resize touch-none outline-none max-sm:hidden"
      style={{ top: MARGIN.top, bottom: MARGIN.bottom, left: `calc(100% - ${MARGIN.right}px)` }}
    >
      <div className="bg-ring mx-auto h-full w-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100 motion-reduce:transition-none" />
    </div>
  );
}
