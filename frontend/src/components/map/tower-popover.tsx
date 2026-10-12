"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useStore } from "react-redux";
import { toggleSidePanel, wrapTo } from "@kepler.gl/actions";
import { MapPopoverContentFactory, MapPopoverFactory } from "@kepler.gl/components";
import { getLayerHoverPropValue, type LayerHoverProp } from "@kepler.gl/reducers";
import { useAui, useAuiState } from "@assistant-ui/react";
import { Check, Loader2, MessageSquarePlus, MousePointerClick, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { focusTower } from "@/lib/hermes/map-focus";
import { isTowerName, TOWER_MEDIA_TYPE, towerAttachment, towerContext, type TowerRow } from "@/lib/menara/tower-context";

import { MAP_ID } from "./kepler-store";

/** Statuses the self-heal loop works on. */
const HEALABLE = new Set(["DOWN", "DEGRADED"]);
/** Columns a tower layer names its eNodeB by: the down-tower layer, the self-heal layers, the area card. */
const NAME_FIELDS = ["tower", "enodeb_name", "name"];

/** Whether kepler's popover is pinned (clicked), and how to unpin it; the content can't see either. */
const PopoverContext = createContext<{ frozen: boolean; onClose: () => void }>({ frozen: false, onClose: () => {} });

/** The tower behind a hovered or clicked map row, when the row is one. */
function towerOf(hover: LayerHoverProp | null): TowerRow | null {
  if (!hover?.data || !hover.fields?.length) return null;
  const value = (name: string) => {
    const i = hover.fields.findIndex((f) => f.name === name);
    return i < 0 ? undefined : getLayerHoverPropValue(hover.data, i);
  };
  const name = NAME_FIELDS.map(value).find(isTowerName);
  if (!name) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return { name, town: str(value("town")), state: str(value("state")), status: str(value("status"))?.toUpperCase(), lat: num(value("lat")), lng: num(value("lng")) };
}

/** A pinned point that the Agents tab can show evidence for: a tower, or a site on an agent or opportunity layer. */
function siteOf(hover: LayerHoverProp | null): { name: string; lat: number; lng: number } | null {
  if (!hover?.data || !hover.fields?.length) return null;
  const value = (name: string) => {
    const i = hover.fields.findIndex((f) => f.name === name);
    return i < 0 ? undefined : getLayerHoverPropValue(hover.data, i);
  };
  const name = ["tower", "enodeb_name", "site_id", "id", "name"].map(value).find((v) => typeof v === "string" && v);
  const lat = [value("lat"), value("latitude")].find((v) => typeof v === "number");
  const lng = [value("lng"), value("longitude")].find((v) => typeof v === "number");
  return typeof name === "string" && typeof lat === "number" && typeof lng === "number" ? { name, lat, lng } : null;
}

/** Clicking (pinning) a point tells the Agents tab, which shows the run's evidence near it. */
function FocusOnPin({ hover }: { hover: LayerHoverProp | null }) {
  const { frozen } = useContext(PopoverContext);
  const site = frozen ? siteOf(hover) : null;
  useEffect(() => { if (site) focusTower(site); }, [site?.name, site?.lat, site?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Opens the chat tab when another tab, or no panel, is showing. */
function useShowChat() {
  const store = useStore();
  return () => {
    const keplerGl = (store.getState() as { keplerGl: Record<string, { uiState: { activeSidePanel: string | null } } | undefined> }).keplerGl;
    if (keplerGl[MAP_ID]?.uiState.activeSidePanel !== "assistant") store.dispatch(wrapTo(MAP_ID, toggleSidePanel("assistant")));
    // after the tab has mounted
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(".aui-composer-input")?.focus());
  };
}

/**
 * Actions under a tower's map tooltip. Hovering shows a hint; clicking the tower pins the tooltip
 * and offers "Start self-heal" (DOWN or DEGRADED towers: asks the chat, which starts the self-heal
 * card) and "Add to chat" (the tower's live status, alarms, KPI and neighbours go in the composer
 * as a chip, sent with the next message).
 */
function TowerActions({ tower }: { tower: TowerRow }) {
  const { frozen, onClose } = useContext(PopoverContext);
  const aui = useAui();
  const showChat = useShowChat();
  const running = useAuiState((s) => s.thread.isRunning);
  const attached = useAuiState((s) => s.thread.composer.attachments.some((a) => a.contentType === TOWER_MEDIA_TYPE && a.name === tower.name));
  const [adding, setAdding] = useState(false);
  const healable = tower.status ? HEALABLE.has(tower.status) : false;

  if (!frozen) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <MousePointerClick className="size-3.5" /> Click the tower for actions
      </p>
    );
  }

  const heal = () => {
    const where = [tower.status, tower.town, tower.state].filter(Boolean).join(", ");
    aui.thread().append(`Heal tower ${tower.name}${where ? ` (${where})` : ""}.`);
    showChat();
    onClose();
  };

  const addToChat = async () => {
    setAdding(true);
    try {
      await aui.thread().composer().addAttachment(towerAttachment(tower.name, await towerContext(tower)));
      showChat();
      onClose();
    } finally {
      setAdding(false);
    }
  };

  return (
    // the tooltip's own styles space every child; keep the buttons' gap ours
    <div className="flex flex-wrap gap-2 border-t pt-2.5 [&>*+*]:!mt-0">
      {healable ? (
        <Button size="sm" variant="brand" onClick={heal} disabled={running} title={running ? "Wait for the current answer to finish" : undefined}>
          <Wrench /> Start self-heal
        </Button>
      ) : null}
      <Button size="sm" variant="outline" onClick={addToChat} disabled={adding || attached}>
        {adding ? <Loader2 className="animate-spin" /> : attached ? <Check /> : <MessageSquarePlus />}
        {attached ? "In the chat" : "Add to chat"}
      </Button>
    </div>
  );
}

/** kepler's tooltip, with the tower actions under a tower's rows. */
function ElevateMapPopoverContentFactory(...deps: Parameters<typeof MapPopoverContentFactory>) {
  const MapPopoverContent = MapPopoverContentFactory(...deps);
  const ElevateMapPopoverContent = (props: React.ComponentProps<typeof MapPopoverContent>) => {
    const tower = towerOf(props.layerHoverProp);
    return (
      <>
        <MapPopoverContent {...props} />
        <FocusOnPin hover={props.layerHoverProp} />
        {tower ? <TowerActions tower={tower} /> : null}
      </>
    );
  };
  return ElevateMapPopoverContent;
}
ElevateMapPopoverContentFactory.deps = MapPopoverContentFactory.deps;

/**
 * kepler's popover, handing whether it is pinned down to the content. No popover for decorative
 * boundary outlines or layers with no tooltip fields: it would be an empty box.
 */
function ElevateMapPopoverFactory(...deps: Parameters<typeof MapPopoverFactory>) {
  const MapPopover = MapPopoverFactory(...deps);
  const ElevateMapPopover = (props: React.ComponentProps<typeof MapPopover>) => {
    const dataId = props.layerHoverProp?.layer?.config?.dataId;
    const fields = props.layerHoverProp?.fieldsToShow;
    if (dataId?.startsWith("area_boundary") || (Array.isArray(fields) && fields.length === 0)) return null;
    return (
      <PopoverContext.Provider value={{ frozen: Boolean(props.frozen), onClose: props.onClose }}>
        <MapPopover {...props} />
      </PopoverContext.Provider>
    );
  };
  return ElevateMapPopover;
}
ElevateMapPopoverFactory.deps = MapPopoverFactory.deps;

/** Inject the popover before its content: injecting it re-provides the default content factory. */
export const towerPopoverFactories = [
  [MapPopoverFactory, ElevateMapPopoverFactory],
  [MapPopoverContentFactory, ElevateMapPopoverContentFactory],
] as const;