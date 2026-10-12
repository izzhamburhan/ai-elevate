"use client";

import { ChevronDown, ListTree } from "lucide-react";

import { cn } from "@/lib/utils";

import { useHermesSelection } from "../panels/hermes-selection";
import { useTowerStatus } from "../tower-status";
import { legendGroups, sameLegend } from "./legend-groups";
import { type KeplerStore, formatMyt, formatMytDate, useKeplerValue } from "./use-kepler";

/**
 * The map's key: every visible layer in the colour it is drawn with, grouped as network, weather,
 * investigation and other, each with the time its data is for. Hidden layers drop out, so the
 * legend never describes something the map isn't showing.
 */
export function MapLegend({
  store,
  mapId,
  open,
  onOpenChange,
}: {
  store: KeplerStore;
  mapId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const groups = useKeplerValue(store, mapId, (i) => [i.visState.layers, i.visState.layerOrder, i.visState.datasets], legendGroups, sameLegend) ?? [];
  const { status } = useTowerStatus();
  const job = useHermesSelection((s) => s.job);
  const mappedId = useHermesSelection((s) => s.mappedId);
  const count = groups.reduce((n, g) => n + g.entries.length, 0);

  return (
    <div className="pointer-events-auto w-[17rem] max-w-[calc(100vw-5rem)] overflow-hidden rounded-2xl border bg-background/90 shadow-[0_24px_60px_-28px_rgba(0,0,0,0.45)] backdrop-blur">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="map-legend-body"
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-medium transition-colors hover:bg-accent"
      >
        <ListTree className="size-3.5 text-muted-foreground" />
        Legend
        <span className="text-muted-foreground tabular-nums">· {count} {count === 1 ? "layer" : "layers"}</span>
        <ChevronDown className={cn("ml-auto size-3.5 text-muted-foreground transition-transform motion-reduce:transition-none", open ? "" : "-rotate-90")} />
      </button>
      {open ? (
        <div id="map-legend-body" className="max-h-[min(22rem,45svh)] space-y-3 overflow-y-auto border-t px-3 pt-2.5 pb-3">
          {!groups.length ? <p className="text-[11.5px] leading-relaxed text-muted-foreground">No layers are showing. Turn one on in the Layers tab, or ask the assistant.</p> : null}
          {groups.map((group) => (
            <section key={group.id} aria-label={group.title}>
              <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <h3 className="text-[11px] font-medium text-muted-foreground">{group.title}</h3>
                {group.id === "network" && status?.asOf ? (
                  <span className="text-[10.5px] text-muted-foreground tabular-nums">
                    As of {formatMyt(status.asOf)} MYT{status.synthetic ? " · Synthetic" : ""}
                  </span>
                ) : null}
                {group.id === "investigation" && job && mappedId === job.investigation_id ? (
                  <span className="text-[10.5px] text-muted-foreground tabular-nums">Updated {formatMyt(job.updated_at)} MYT</span>
                ) : null}
              </div>
              <ul className="space-y-1">
                {group.entries.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-2 text-[12px]">
                    <span aria-hidden="true" className="relative grid size-3.5 shrink-0 place-items-center">
                      {entry.ring ? <span className="absolute inset-0 rounded-full border-[1.5px] opacity-60" style={{ borderColor: entry.color }} /> : null}
                      <span className="size-2 rounded-full" style={{ background: entry.color, boxShadow: `0 0 6px ${entry.color}` }} />
                    </span>
                    <span className="truncate">{entry.label}</span>
                  </li>
                ))}
              </ul>
              {group.window || group.mode ? (
                <p className="mt-1.5 text-[10.5px] leading-snug text-muted-foreground">
                  {[group.mode, group.window ? `Valid ${formatMytDate(group.window.start)} – ${formatMyt(group.window.end)} MYT` : undefined].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
