"use client";

import { useEffect, useState } from "react";
import { Crosshair, X } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import { cn } from "@/lib/utils";

import { panelInset } from "../camera";
import { AgentBriefing } from "./agent-briefing";
import { InvestigationMarkers } from "./investigation-markers";
import { MapLegend } from "./map-legend";
import { setDeckFocus, useDeckFocus } from "./deck-focus";
import { ScenesMenu } from "./scenes-menu";
import { SceneTitle } from "./scene-title";
import { useBottomWidgetHeight } from "./use-bottom-widget";
import { type KeplerStore, useKeplerValue } from "./use-kepler";

const PREFS_KEY = "elevate-command-deck";
/** Narrower than this, the deck stacks in one column and the title steps aside for the map. */
const NARROW = 760;

function loadLegendOpen(): boolean | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as { legendOpen?: unknown };
    return typeof saved.legendOpen === "boolean" ? saved.legendOpen : undefined;
  } catch {
    return undefined;
  }
}

function saveLegendOpen(legendOpen: boolean) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ legendOpen }));
  } catch {
    // storage unavailable: the legend just opens at its default next time
  }
}

/**
 * Atmosphere for the map: a soft vignette at the edges only, so the middle stays true to the
 * basemap. No scrim behind the caption: it shaded the map under it. Static, so it costs nothing
 * per frame.
 */
const VIGNETTE_CSS = `
.deck-vignette { position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(130% 110% at 55% 50%, transparent 70%, rgb(31 27 45 / 0.06) 100%); }
.dark .deck-vignette {
  background: radial-gradient(130% 110% at 55% 50%, transparent 65%, rgb(8 6 14 / 0.35) 100%); }
`;

/**
 * The command deck over the kepler map: the region caption, the legend, scenes, the focused site
 * and the agents' briefing. It sits in the map area beside the side panel and leaves the middle of
 * the map free. DOM only; the map itself stays kepler's one WebGL canvas.
 * Render right after `<KeplerGl>`, with the other map overlays.
 */
export function CommandDeck({ store, mapId, panelWidth }: { store: KeplerStore; mapId: string; panelWidth: number }) {
  const layout = useKeplerValue(
    store,
    mapId,
    (i) => [i.mapState.width, i.mapState.height, i.uiState.activeSidePanel],
    (i) => ({ inset: panelInset(i, panelWidth), width: i.mapState.width, panel: i.uiState.activeSidePanel }),
    (a, b) => a.inset === b.inset && a.width === b.width && a.panel === b.panel,
  );
  const focus = useDeckFocus((s) => s.focus);
  const bottomWidget = useBottomWidgetHeight();
  const [legendOpen, setLegendOpen] = useState(true);

  // the saved choice, or open when there's room for it
  useEffect(() => {
    const saved = loadLegendOpen();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after hydration
    setLegendOpen(saved ?? window.innerWidth >= 1024);
  }, []);

  useEffect(() => {
    if (!focus) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setDeckFocus(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus]);

  if (!layout) return null;
  const mapWidth = layout.width - layout.inset;
  const narrow = mapWidth < NARROW;
  // the full-width chat (or a phone's panel) leaves no map to dress
  if (mapWidth < 200) return null;

  const onLegendChange = (open: boolean) => {
    setLegendOpen(open);
    saveLegendOpen(open);
  };

  const focusChip = focus ? (
    <div className="pointer-events-auto flex h-9 max-w-full items-center gap-2 rounded-full border bg-background/90 pr-1 pl-3 text-[12px] shadow-[0_24px_60px_-28px_rgba(0,0,0,0.45)] backdrop-blur">
      <Crosshair className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">{focus.label}</span>
      {focus.detail ? <span className="truncate text-muted-foreground max-sm:hidden">{focus.detail}</span> : null}
      <TooltipIconButton tooltip="Clear focus (Esc)" side="top" onClick={() => setDeckFocus(null)} className="size-7 text-muted-foreground hover:text-foreground">
        <X className="size-3.5" />
      </TooltipIconButton>
    </div>
  ) : null;

  const briefing = (
    <AgentBriefing store={store} mapId={mapId} panelWidth={panelWidth} agentsTabOpen={layout.panel === "hermes"} />
  );

  return (
    <>
      <style href="elevate-deck-vignette" precedence="default">
        {VIGNETTE_CSS}
      </style>
      <div aria-hidden="true" className="deck-vignette" style={{ left: layout.inset, zIndex: 1 }} />
      <InvestigationMarkers store={store} mapId={mapId} />

      <div
        role="region"
        aria-label="Map command deck"
        className="pointer-events-none absolute top-0 bottom-0"
        // right-14 clears kepler's control column; the side panel's toggle button sits at the left
        style={{ left: layout.inset, right: 56, zIndex: 2 }}
      >
        {!narrow ? (
          <div className="absolute top-3 left-12 max-w-[min(30rem,calc(100%-22rem))]">
            <SceneTitle store={store} mapId={mapId} />
          </div>
        ) : null}

        <div
          // sits above kepler's time panel when one is open, instead of on top of it
          style={{ bottom: bottomWidget > 0 ? bottomWidget + 8 : 36 }}
          className={cn(
            "absolute bottom-9 flex gap-2",
            "absolute flex gap-2",
            // on phones the panel's open button sits at the map's bottom left (kepler-panels.tsx); clear it
            narrow ? "right-0 left-3 flex-col items-start max-sm:left-12" : "right-0 left-3 items-end justify-between",
          )}
        >
          {narrow ? <div className="flex w-full justify-start empty:hidden">{briefing}</div> : null}
          <div className="flex min-w-0 flex-col items-start gap-2">
            <div className="flex max-w-full flex-wrap items-center gap-2">
              <ScenesMenu store={store} mapId={mapId} panelWidth={panelWidth} />
              {focusChip}
            </div>
            <MapLegend store={store} mapId={mapId} open={legendOpen} onOpenChange={onLegendChange} />
          </div>
          {!narrow ? <div className="flex min-w-0 justify-end">{briefing}</div> : null}
        </div>
      </div>
    </>
  );
}