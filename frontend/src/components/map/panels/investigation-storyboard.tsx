"use client";

import { useMemo } from "react";
import { Crosshair } from "lucide-react";

import type { HermesJob } from "@/lib/hermes/contracts";
import { investigationSites, investigationStages, type Stage } from "@/lib/hermes/investigation";
import type { EvidenceRow } from "@/lib/hermes/workspace";
import { SITE_TONE_COLOR } from "@/lib/map-colors";
import { cn } from "@/lib/utils";

import { useDeckFocus } from "../command-deck/deck-focus";
import { focusSite } from "../command-deck/investigation-map";
import type { KeplerStore } from "../command-deck/use-kepler";

const STAGE_BAR: Record<Stage["state"], string> = {
  waiting: "bg-foreground/10",
  active: "bg-violet motion-safe:animate-pulse",
  done: "bg-green",
  empty: "bg-foreground/25",
  failed: "bg-red",
};

const TONE_TEXT = { red: "text-red", amber: "text-amber", green: "text-green", blue: "text-blue", neutral: "text-violet" } as const;

/**
 * The investigation as five steps (question → agents → sites → evidence → recommendation), each
 * lit only by what the Hermes job returned, then the affected sites: pick one and the camera flies
 * to it and a reticle marks it. Sites come from the job's validated GeoJSON, never from prose.
 */
export function InvestigationStoryboard({ job, rows, store, panelWidth }: { job: HermesJob; rows: EvidenceRow[]; store: KeplerStore; panelWidth: number }) {
  const stages = useMemo(() => investigationStages(job, { evidence: rows.length }), [job, rows.length]);
  const sites = useMemo(() => investigationSites(job), [job]);
  const focusKey = useDeckFocus((s) => s.focus?.key);
  const shown = sites.slice(0, 12);

  return (
    <div className="space-y-2.5">
      <ol aria-label="Investigation steps" className="grid grid-cols-5 gap-1">
        {stages.map((stage) => (
          <li key={stage.id} aria-label={`${stage.title}: ${stage.detail}`}>
            <span aria-hidden="true" className={cn("block h-1 rounded-full transition-colors duration-500 motion-reduce:transition-none", STAGE_BAR[stage.state])} />
            <span className={cn("mt-1.5 block truncate text-[10.5px] font-medium", stage.state === "waiting" ? "text-muted-foreground" : "text-foreground")}>{stage.title}</span>
            <span className={cn("block truncate text-[10px] tabular-nums", stage.state === "failed" ? "text-red" : "text-muted-foreground")}>{stage.detail}</span>
          </li>
        ))}
      </ol>

      {sites.length ? (
        <div>
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">Affected sites · pick one to fly there</p>
          <ul className="flex flex-wrap gap-1.5">
            {shown.map((site) => (
              <li key={site.key}>
                <button
                  type="button"
                  aria-pressed={focusKey === site.key}
                  onClick={() => focusSite(store, "workspace", site, panelWidth)}
                  title={[site.name, site.siteId, site.detail, site.toneLabel].filter(Boolean).join(" · ")}
                  className={cn(
                    "flex max-w-[15rem] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors hover:bg-accent",
                    focusKey === site.key && "border-foreground/30 bg-accent",
                  )}
                >
                  {focusKey === site.key ? (
                    <Crosshair className="size-3 shrink-0" style={{ color: SITE_TONE_COLOR[site.tone] }} />
                  ) : (
                    <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: SITE_TONE_COLOR[site.tone] }} />
                  )}
                  <span className="truncate">{site.siteId ?? site.name}</span>
                  {site.toneLabel ? <span className={cn("shrink-0 font-medium", TONE_TEXT[site.tone])}>{site.toneLabel}</span> : null}
                </button>
              </li>
            ))}
          </ul>
          {sites.length > shown.length ? <p className="mt-1 text-[11px] text-muted-foreground">and {sites.length - shown.length} more on the map</p> : null}
        </div>
      ) : null}
    </div>
  );
}
