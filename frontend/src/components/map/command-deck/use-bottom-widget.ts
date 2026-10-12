"use client";

import { useEffect, useState } from "react";

const SELECTOR = ".bottom-widget--container";

/**
 * Height in px of kepler's bottom widget (the time-range filter and the trail playback bar), 0 while it shows
 * nothing. Kepler renders it in its own tree, so this watches the DOM: the deck lifts its bottom row by it instead
 * of covering the timeline.
 */
export function useBottomWidgetHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    let observed: Element | null = null;
    // the border box: the widget's padding is part of what it covers
    const resize = new ResizeObserver(([entry]) => setHeight(Math.round(entry?.borderBoxSize?.[0]?.blockSize ?? 0)));
    const attach = () => {
      const el = document.querySelector(SELECTOR);
      if (el === observed) return;
      if (observed) resize.unobserve(observed);
      observed = el;
      if (el) resize.observe(el, { box: "border-box" });
      else setHeight(0);
    };
    attach();
    // kepler can remount the widget (a new map config, a resize across its mobile breakpoint)
    const mounts = new MutationObserver(attach);
    mounts.observe(document.body, { childList: true, subtree: true });
    return () => {
      mounts.disconnect();
      resize.disconnect();
    };
  }, []);

  return height;
}