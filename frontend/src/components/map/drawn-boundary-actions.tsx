"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useStore } from "react-redux";
import { deleteFeature, toggleSidePanel, wrapTo } from "@kepler.gl/actions";
import { WebMercatorViewport } from "@math.gl/web-mercator";
import { useAui, useAuiState } from "@assistant-ui/react";
import { Check, MessageSquarePlus, Shapes, Trash2 } from "lucide-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import {
  boundaryAttachment,
  BOUNDARY_MEDIA_TYPE,
  extractFeatureMetrics,
  formatBoundaryLabel,
  type DrawnFeature,
} from "@/lib/menara/boundary-context";
import { cn } from "@/lib/utils";

import { MAP_ID, type makeKeplerStore } from "./kepler-store";

type KeplerStore = ReturnType<typeof makeKeplerStore>;

type EditorState = {
  features: DrawnFeature[];
  selectedFeature: DrawnFeature | null;
  mode: string;
};

type Instance = {
  mapState: {
    width: number;
    height: number;
    latitude: number;
    longitude: number;
    zoom: number;
    pitch: number;
    bearing: number;
  };
  visState: {
    editor: EditorState;
  };
  uiState: {
    activeSidePanel: string | null;
  };
};

function readInstance(store: KeplerStore, mapId: string): Instance | null {
  const keplerGl = (store.getState() as { keplerGl?: Record<string, Instance | undefined> })
    ?.keplerGl;
  return keplerGl?.[mapId] ?? null;
}

/** Hook to observe the active drawn shape on the Kepler map. */
export function useActiveDrawnFeature(store: KeplerStore, mapId = MAP_ID) {
  const instance = useSyncExternalStore(
    store.subscribe,
    () => readInstance(store, mapId),
    () => null,
  );

  const editor = instance?.visState?.editor;
  const features = editor?.features ?? [];
  const selected = editor?.selectedFeature;

  // Prioritize the latest coordinates in features array matching the selected feature,
  // falling back to the last feature in the list.
  const activeFeature: DrawnFeature | null =
    (selected ? features.find((f) => f.id === selected.id) ?? selected : null) ??
    (features.length > 0 ? features[features.length - 1] : null);

  return {
    instance,
    editor,
    features,
    activeFeature,
    count: features.length,
  };
}

/** Opens the assistant chat panel and focuses the input. */
export function useShowChat() {
  const store = useStore();
  return () => {
    const keplerGl = (
      store.getState() as {
        keplerGl?: Record<string, { uiState?: { activeSidePanel?: string | null } }>;
      }
    )?.keplerGl;
    if (keplerGl?.[MAP_ID]?.uiState?.activeSidePanel !== "assistant") {
      store.dispatch(wrapTo(MAP_ID, toggleSidePanel("assistant")));
    }
    requestAnimationFrame(() =>
      document.querySelector<HTMLTextAreaElement>(".aui-composer-input")?.focus(),
    );
  };
}

/**
 * Button rendered in the composer actions toolbar (next to model selector).
 * Lets the operator attach the active drawn polygon to the chat.
 */
export function AttachBoundaryButton() {
  const store = useStore() as KeplerStore;
  const aui = useAui();
  const showChat = useShowChat();
  const { activeFeature } = useActiveDrawnFeature(store);

  const isAttached = useAuiState((s) =>
    s.thread.composer.attachments.some((a) => a.contentType === BOUNDARY_MEDIA_TYPE),
  );

  if (!activeFeature) return null;

  const metrics = extractFeatureMetrics(activeFeature);
  const label = formatBoundaryLabel(metrics);

  const handleAttach = () => {
    aui.thread().composer().addAttachment(boundaryAttachment(activeFeature, label));
    showChat();
  };

  return (
    <TooltipIconButton
      tooltip={isAttached ? "Boundary attached to chat" : `Attach drawn boundary (${label})`}
      side="bottom"
      variant="ghost"
      size="sm"
      onClick={handleAttach}
      disabled={isAttached}
      className={cn(
        "h-7 gap-1.5 rounded-full px-2 text-[12px] transition-colors",
        isAttached
          ? "text-sky-400 cursor-default opacity-80"
          : "text-muted-foreground hover:bg-sky-500/15 hover:text-sky-300",
      )}
    >
      {isAttached ? <Check className="size-3.5 text-sky-400" /> : <Shapes className="size-3.5 text-sky-400" />}
      <span className="font-mono text-[11px]">{isAttached ? "Boundary attached" : "Attach area"}</span>
    </TooltipIconButton>
  );
}

/**
 * Floating glassmorphic banner anchored directly and centered above the user's drawn shape.
 * Features:
 * - Horizontally centered above the shape's midpoint.
 * - Follows the shape in real-time when moved, edited, panned, or zoomed.
 * - Quick-delete button to delete the shape without right-clicking.
 * - 1-click Add to Chat button.
 */
export function DrawnBoundaryBanner({
  store,
  mapId = MAP_ID,
}: {
  store: KeplerStore;
  mapId?: string;
}) {
  const aui = useAui();
  const showChat = useShowChat();
  const { instance, activeFeature, count } = useActiveDrawnFeature(store, mapId);

  // Re-read smoothly on mouse moves while dragging/translating the shape
  const [, setDragTick] = useState(0);
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (e.buttons > 0) {
        setDragTick((t) => (t + 1) % 1000000);
      }
    };
    window.addEventListener("pointermove", onPointerMove);
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, []);

  const isAttached = useAuiState((s) =>
    s.thread.composer.attachments.some((a) => a.contentType === BOUNDARY_MEDIA_TYPE),
  );

  if (!activeFeature || !instance?.mapState) return null;

  const { width, height, latitude, longitude, zoom, pitch, bearing } = instance.mapState;
  if (width <= 0 || height <= 0) return null;

  const metrics = extractFeatureMetrics(activeFeature);
  if (!metrics.bbox || !metrics.center) return null;

  // Anchor horizontally at the exact midpoint of the bounding box, and vertically at the northernmost edge
  const anchorLng = metrics.center.lng;
  const anchorLat = metrics.bbox[3];

  const viewport = new WebMercatorViewport({ width, height, latitude, longitude, zoom, pitch, bearing });
  const [screenX, screenY] = viewport.project([anchorLng, anchorLat]);

  // Hide if panned completely out of the map viewport
  if (screenX < -150 || screenX > width + 150 || screenY < -150 || screenY > height + 150) {
    return null;
  }

  const label = formatBoundaryLabel(metrics);

  const handleAttach = () => {
    aui.thread().composer().addAttachment(boundaryAttachment(activeFeature, label));
    showChat();
  };

  const handleDelete = () => {
    store.dispatch(wrapTo(mapId, deleteFeature(activeFeature as never)));
  };

  // If the top edge is close to the top navigation bar, flip below the shape
  const isNearTop = screenY < 85;
  const halfWidth = 140;
  const clampedX = Math.max(halfWidth + 12, Math.min(width - halfWidth - 12, screenX));
  const clampedY = isNearTop
    ? Math.min(height - 40, screenY + 14)
    : Math.max(60, screenY - 14);

  return (
    <aside
      aria-label="Drawn boundary context"
      style={{
        left: `${clampedX}px`,
        top: `${clampedY}px`,
      }}
      className={cn(
        "pointer-events-auto absolute z-30 flex items-center gap-1.5 rounded-full border border-sky-500/35 bg-background/95 py-1.5 pl-3 pr-2 text-[12px] shadow-[0_8px_30px_rgb(0,0,0,0.35)] backdrop-blur transition-all duration-75",
        isNearTop ? "translate-y-1" : "-translate-y-full",
        "-translate-x-1/2",
      )}
    >
      <span className="grid size-5.5 place-items-center rounded-full bg-sky-500/20 text-sky-400">
        <Shapes className="size-3" />
      </span>
      <div className="flex items-center gap-1.5 whitespace-nowrap pr-1">
        <span className="font-medium text-foreground">{label}</span>
        {count > 1 ? (
          <span className="text-[11px] text-muted-foreground">({count})</span>
        ) : null}
      </div>

      <Button
        size="sm"
        variant={isAttached ? "ghost" : "brand"}
        onClick={handleAttach}
        disabled={isAttached}
        className={cn(
          "h-6.5 rounded-full px-2.5 text-[11px] font-medium shadow-none",
          isAttached && "text-sky-400 bg-sky-500/10 hover:bg-sky-500/15",
        )}
      >
        {isAttached ? (
          <>
            <Check className="size-3 mr-1" /> In chat
          </>
        ) : (
          <>
            <MessageSquarePlus className="size-3 mr-1" /> Add to chat
          </>
        )}
      </Button>

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleDelete}
              aria-label="Delete drawn shape"
              className="grid size-6 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive active:scale-95"
            >
              <Trash2 className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Delete shape</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Centered pointer caret pointing directly to the shape's top center edge */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute left-1/2 -translate-x-1/2 size-0 border-x-4 border-x-transparent",
          isNearTop
            ? "-top-1.5 border-b-[6px] border-b-background/95"
            : "-bottom-1.5 border-t-[6px] border-t-background/95",
        )}
      />
    </aside>
  );
}
