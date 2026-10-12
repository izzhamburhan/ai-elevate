"use client";

import { useMemo } from "react";

import { investigationSites } from "@/lib/hermes/investigation";
import { SITE_TONE_COLOR } from "@/lib/map-colors";

import { useHermesSelection } from "../panels/hermes-selection";
import { useDeckFocus } from "./deck-focus";
import { type KeplerStore, projector, useKeplerValue } from "./use-kepler";

/** Dataset `loadHermesOverlay` writes the findings to; the markers follow its layer's visibility. */
const FINDINGS_DATA_ID = "hermes-investigation-findings";

/**
 * Styles live in the component (as `TowerPulse` does): Turbopack's dev cache can keep serving an old
 * globals.css. Markers ripple twice when they arrive and then hold still; the focus reticle locks on
 * once. Nothing loops.
 */
const MARKER_CSS = `
@keyframes deck-arrive { from { transform: scale(0.3); opacity: 0.9; } to { transform: scale(2.4); opacity: 0; } }
@keyframes deck-lock { from { transform: scale(1.9) rotate(-45deg); opacity: 0; } to { transform: scale(1) rotate(0deg); opacity: 1; } }
.deck-site { position: absolute; width: 0; height: 0; }
.deck-site-core, .deck-site-ring, .deck-site-halo { position: absolute; border-radius: 9999px; }
.deck-site-core { left: -6px; top: -6px; width: 12px; height: 12px; background: var(--deck-c); border: 2px solid rgb(20 17 29 / 0.85); box-shadow: 0 0 12px var(--deck-c); }
.deck-site-halo { left: -11px; top: -11px; width: 22px; height: 22px; border: 1.5px solid var(--deck-c); opacity: 0.55; }
.deck-site-ring { left: -14px; top: -14px; width: 28px; height: 28px; border: 2px solid var(--deck-c); opacity: 0; animation: deck-arrive 1.6s ease-out 2; animation-delay: var(--deck-delay); }
.deck-focus { position: absolute; width: 0; height: 0; }
.deck-focus-ring { position: absolute; left: -26px; top: -26px; width: 52px; height: 52px; border-radius: 9999px; border: 1.5px dashed var(--deck-c); animation: deck-lock 650ms cubic-bezier(0.2, 0.7, 0.2, 1) both; }
.deck-focus-tick { position: absolute; background: var(--deck-c); }
@media (prefers-reduced-motion: reduce) {
  .deck-site-ring { animation: none; }
  .deck-focus-ring { animation: none; }
}
`;

type Point = { key: string; x: number; y: number; color: string };

/**
 * The investigation's sites once they are on the map, and the reticle on the site picked from the
 * list. Positions come from kepler's camera, so they move with the map; clicks pass through.
 * Render right after `<KeplerGl>`, with the other map overlays.
 */
export function InvestigationMarkers({ store, mapId }: { store: KeplerStore; mapId: string }) {
  const job = useHermesSelection((s) => s.job);
  const mappedId = useHermesSelection((s) => s.mappedId);
  const focus = useDeckFocus((s) => s.focus);
  const sites = useMemo(() => (job && mappedId === job.investigation_id ? investigationSites(job) : []), [job, mappedId]);

  const layerVisible = useKeplerValue(
    store,
    mapId,
    (i) => [i.visState.layers],
    (i) => i.visState.layers.some((l) => l.config.dataId === FINDINGS_DATA_ID && l.config.isVisible),
  );
  const mapState = useKeplerValue(store, mapId, (i) => [i.mapState], (i) => i.mapState);

  const { points, focusPoint } = useMemo(() => {
    if (!mapState) return { points: [] as Point[], focusPoint: null };
    const project = projector(mapState);
    const onScreen = ([x, y]: [number, number]) => x > -40 && y > -40 && x < mapState.width + 40 && y < mapState.height + 40;
    const points = layerVisible
      ? sites.flatMap((site) => {
          const xy = project(site.lng, site.lat);
          return onScreen(xy) ? [{ key: site.key, x: xy[0], y: xy[1], color: SITE_TONE_COLOR[site.tone] }] : [];
        })
      : [];
    const f = focus ? project(focus.lng, focus.lat) : null;
    return { points, focusPoint: focus && f && onScreen(f) ? { x: f[0], y: f[1], color: SITE_TONE_COLOR[focus.tone] } : null };
  }, [mapState, sites, layerVisible, focus]);

  if (!points.length && !focusPoint) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 1 }}>
      <style href="elevate-deck-markers" precedence="default">
        {MARKER_CSS}
      </style>
      {points.map((p, index) => (
        <span
          key={p.key}
          className="deck-site"
          style={{ left: p.x, top: p.y, ["--deck-c" as string]: p.color, ["--deck-delay" as string]: `${Math.min(index, 12) * 90}ms` }}
        >
          <i className="deck-site-ring" />
          <i className="deck-site-halo" />
          <i className="deck-site-core" />
        </span>
      ))}
      {focusPoint ? (
        <span key={focus?.key} className="deck-focus" style={{ left: focusPoint.x, top: focusPoint.y, ["--deck-c" as string]: focusPoint.color }}>
          <i className="deck-focus-ring" />
          <i className="deck-focus-tick" style={{ left: -38, top: -0.75, width: 10, height: 1.5 }} />
          <i className="deck-focus-tick" style={{ left: 28, top: -0.75, width: 10, height: 1.5 }} />
          <i className="deck-focus-tick" style={{ left: -0.75, top: -38, width: 1.5, height: 10 }} />
          <i className="deck-focus-tick" style={{ left: -0.75, top: 28, width: 1.5, height: 10 }} />
        </span>
      ) : null}
    </div>
  );
}
