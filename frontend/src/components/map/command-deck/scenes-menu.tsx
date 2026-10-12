"use client";

import { useEffect, useState } from "react";
import { Bookmark, Check, Compass, Trash2, TriangleAlert } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { REGIONS, sceneCoverage, type MapScene, type Region, type RestorePlan } from "@/lib/map-scenes";

import { flyToBounds } from "../camera";
import { deleteScene, inventory, loadScenes, restoreScene, saveScene, useScenes } from "./scenes";
import { type KeplerStore, formatMytDate, readInstance } from "./use-kepler";

type Notice = { tone: "green" | "amber"; text: string };

function describeRestore(scene: MapScene, plan: RestorePlan): Notice {
  const missing = [
    ...plan.missingLayers.map((label) => `layer “${label}”`),
    ...plan.missingFilters.map((field) => `filter on “${field}”`),
    ...(plan.missingBasemap ? ["its basemap"] : []),
  ];
  if (!missing.length) return { tone: "green", text: `Restored “${scene.name}”.` };
  const shown = missing.slice(0, 3).join(", ");
  const more = missing.length > 3 ? ` and ${missing.length - 3} more` : "";
  return {
    tone: "amber",
    text: `Restored “${scene.name}” without ${shown}${more}: not on this chat's map. Nothing else was changed.`,
  };
}

/**
 * Region quick-jumps and named scenes, from one pill on the map. A region only moves the camera.
 * A scene also sets layer visibility, filters and the basemap, for whatever this map still has.
 */
export function ScenesMenu({ store, mapId, panelWidth }: { store: KeplerStore; mapId: string; panelWidth: number }) {
  const { scenes, storageError } = useScenes();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => loadScenes(), []);

  const instance = open ? readInstance(store, mapId) : undefined;
  const map = instance ? inventory(instance) : undefined;

  const goToRegion = (region: Region) => {
    flyToBounds(store, mapId, region.bounds, { panelWidth, padding: 32 });
    setNotice(null);
  };

  const onSave = (event: React.FormEvent) => {
    event.preventDefault();
    const scene = saveScene(store, mapId, name || `Scene ${scenes.length + 1}`);
    if (scene) {
      setName("");
      setNotice({ tone: "green", text: `Saved “${scene.name}” with ${scene.layers.length} ${scene.layers.length === 1 ? "layer" : "layers"}.` });
    }
  };

  const onRestore = (scene: MapScene) => {
    const plan = restoreScene(store, mapId, scene);
    setNotice(plan ? describeRestore(scene, plan) : { tone: "amber", text: "The map is still loading. Try again in a moment." });
  };

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setNotice(null); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="pointer-events-auto flex h-9 items-center gap-2 rounded-full border bg-background/90 px-3 text-[12px] font-medium shadow-[0_24px_60px_-28px_rgba(0,0,0,0.45)] backdrop-blur transition-colors hover:bg-accent"
        >
          <Compass className="size-3.5 text-muted-foreground" />
          Scenes
          {scenes.length ? <span className="text-muted-foreground tabular-nums">· {scenes.length}</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={8} className="w-[22rem] max-w-[calc(100vw-2rem)] gap-3 rounded-2xl p-3">
        <section aria-label="Regions">
          <h3 className="mb-2 text-[12px] font-medium text-muted-foreground">Fly to a region</h3>
          <div className="flex flex-wrap gap-1.5">
            {REGIONS.map((region) => (
              <button
                key={region.id}
                type="button"
                title={region.caption}
                onClick={() => goToRegion(region)}
                className="rounded-full border px-2.5 py-1 text-[12px] transition-colors hover:bg-accent"
              >
                {region.name}
              </button>
            ))}
          </div>
        </section>

        <section aria-label="Saved scenes" className="border-t pt-3">
          <h3 className="mb-1 text-[12px] font-medium text-muted-foreground">Saved scenes</h3>
          {!scenes.length ? (
            <p className="py-1 text-[12px] leading-relaxed text-muted-foreground">
              None yet. A scene keeps the camera, which layers show, filters and the basemap. It never copies data.
            </p>
          ) : (
            <ul className="-mx-1 max-h-56 overflow-y-auto">
              {scenes.map((scene) => {
                const coverage = map ? sceneCoverage(scene, map) : undefined;
                return (
                  <li key={scene.id} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-accent/60">
                    <button type="button" onClick={() => onRestore(scene)} className="min-w-0 flex-1 rounded-md text-left">
                      <span className="block truncate text-[13px] font-medium">{scene.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground tabular-nums">
                        {formatMytDate(scene.createdAt)} MYT
                        {coverage && coverage.total ? (
                          coverage.complete ? " · All layers on this map" : ` · ${coverage.found} of ${coverage.total} on this map`
                        ) : " · Camera only"}
                      </span>
                    </button>
                    <TooltipIconButton tooltip={`Delete “${scene.name}”`} side="left" onClick={() => deleteScene(scene.id)} className="size-7 text-muted-foreground hover:text-foreground">
                      <Trash2 className="size-3.5" />
                    </TooltipIconButton>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {notice ? (
          <p
            role="status"
            className={
              notice.tone === "green"
                ? "flex gap-1.5 rounded-xl border border-green/30 bg-green/10 px-2.5 py-2 text-[12px] text-green"
                : "flex gap-1.5 rounded-xl border border-amber/30 bg-amber/10 px-2.5 py-2 text-[12px] text-foreground"
            }
          >
            {notice.tone === "green" ? <Check className="mt-0.5 size-3.5 shrink-0" /> : <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber" />}
            {notice.text}
          </p>
        ) : null}
        {storageError ? (
          <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-[12px] text-destructive">
            This browser didn&apos;t keep the change, so scenes won&apos;t survive a reload here.
          </p>
        ) : null}

        <form onSubmit={onSave} className="flex items-center gap-2 border-t pt-3">
          <label htmlFor="scene-name" className="sr-only">Scene name</label>
          <Input
            id="scene-name"
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name this view"
            className="h-8 flex-1 text-[13px]"
          />
          <Button type="submit" variant="brand" size="sm">
            <Bookmark />
            Save
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
