"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, Loader2, MapPinned, TriangleAlert, X } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { requestHermes, wantsFixture } from "@/lib/hermes/adapter";
import { hermesJobSchema, isHermesJobActive } from "@/lib/hermes/contracts";
import { AGENT_NAMES, formatElapsed, investigationSites } from "@/lib/hermes/investigation";
import { digest, evidenceRows } from "@/lib/hermes/workspace";

import { applyPolledJob, useHermesSelection } from "../panels/hermes-selection";
import { openSidePanel, showInvestigationOnMap } from "./investigation-map";
import { JOB_STATUS_CHIP, useElapsed } from "./investigation-ui";
import type { KeplerStore } from "./use-kepler";

const POLL_MS = 1_500;

/**
 * Keeps following the open investigation while the Agents tab is closed (kepler unmounts it, and
 * with it the tab's own poll). Results go through the tab's `applyPolledJob`, so reopening the tab
 * shows the same job. A failed read is reported, never treated as progress.
 */
function useBackgroundPoll(enabled: boolean) {
  const investigationId = useHermesSelection((s) => s.investigationId);
  const running = useHermesSelection((s) => !s.job || isHermesJobActive(s.job));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !investigationId || !running) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const result = hermesJobSchema.parse(await requestHermes(new URLSearchParams({ action: "investigation", id: investigationId }), controller.signal));
        if (controller.signal.aborted || useHermesSelection.getState().investigationId !== investigationId) return;
        applyPolledJob(result);
        setError(null);
        if (!isHermesJobActive(result)) return;
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Could not read the investigation.");
      }
      timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [enabled, investigationId, running]);

  return enabled ? error : null;
}

/**
 * The agents' work, over the map. While they work: a pill naming the agent and the tool the service
 * reports running. When they finish: a briefing with the same headline and counts the Agents tab
 * derives (`digest`), and the step that puts the findings on the map. Hidden while the Agents tab
 * is open, which shows all of it.
 */
export function AgentBriefing({
  store,
  mapId,
  panelWidth,
  agentsTabOpen,
}: {
  store: KeplerStore;
  mapId: string;
  panelWidth: number;
  agentsTabOpen: boolean;
}) {
  const job = useHermesSelection((s) => s.job);
  const investigationId = useHermesSelection((s) => s.investigationId);
  const mappedId = useHermesSelection((s) => s.mappedId);
  const closedId = useHermesSelection((s) => s.briefingClosedId);
  const [fixture] = useState(wantsFixture);
  const [mapping, setMapping] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const pollError = useBackgroundPoll(!agentsTabOpen);

  const active = Boolean(investigationId && (!job || isHermesJobActive(job)));
  const elapsed = useElapsed(job?.created_at, job?.updated_at, active);
  const summary = useMemo(() => (job && !isHermesJobActive(job) ? digest(job, evidenceRows(job)) : null), [job]);
  const sites = useMemo(() => investigationSites(job), [job]);

  if (agentsTabOpen || !investigationId) return null;
  const openAgents = () => openSidePanel(store, mapId, "hermes");

  if (active) {
    // the specialist doing the work leads; the orchestrator shows while it plans alone
    const running = (job?.tasks ?? []).filter((t) => t.status === "running");
    const lead = running.find((t) => t.agent_id !== "orchestrator") ?? running[0];
    return (
      <button
        type="button"
        onClick={openAgents}
        className="pointer-events-auto flex h-9 max-w-full items-center gap-2 rounded-full border bg-background/90 px-3 text-[12.5px] shadow-[0_24px_60px_-28px_rgba(0,0,0,0.45)] backdrop-blur transition-colors duration-200 animate-in fade-in slide-in-from-bottom-2 hover:bg-accent motion-reduce:animate-none"
      >
        {pollError ? (
          <TriangleAlert className="size-3.5 shrink-0 text-amber" />
        ) : (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-violet motion-reduce:animate-none" />
        )}
        <span className="truncate">
          {pollError ? (
            "Lost contact with Hermes · retrying"
          ) : !job || job.status === "queued" ? (
            "Queued with Hermes"
          ) : lead ? (
            <>
              <span className="font-medium">{AGENT_NAMES[lead.agent_id]}</span>
              {lead.active_tool ? <> · <span className="font-mono text-[11.5px]">{lead.active_tool}</span></> : " · thinking"}
            </>
          ) : (
            "Agents working"
          )}
        </span>
        {job ? <span className="shrink-0 text-muted-foreground tabular-nums">{formatElapsed(elapsed)}</span> : null}
        {fixture ? <span className="shrink-0 rounded bg-amber/15 px-1 py-0.5 text-[10px] leading-none font-medium text-amber">Fixture</span> : null}
      </button>
    );
  }

  if (!job || !summary || closedId === job.investigation_id) return null;

  const chip = JOB_STATUS_CHIP[job.status];
  const onMap = mappedId === job.investigation_id;
  const showOnMap = async () => {
    setMapping(true);
    setMapError(null);
    try {
      await showInvestigationOnMap(store, mapId, job, panelWidth);
    } catch (cause) {
      setMapError(cause instanceof Error ? cause.message : "Could not add the findings to the map.");
    } finally {
      setMapping(false);
    }
  };

  return (
    <section
      aria-label="Investigation briefing"
      className="pointer-events-auto w-[26rem] max-w-full rounded-2xl border bg-background/95 p-3.5 shadow-[0_24px_60px_-28px_rgba(0,0,0,0.45)] backdrop-blur duration-300 animate-in fade-in slide-in-from-bottom-3 motion-reduce:animate-none"
    >
      <div className="flex items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-violet/15 text-violet">
          <Bot className="size-3.5" />
        </span>
        <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${chip.className}`}>{chip.label}</span>
        <span className="truncate text-[11.5px] text-muted-foreground tabular-nums">
          {AGENT_NAMES[job.agent_id]} · {formatElapsed(elapsed)}
        </span>
        {fixture ? <span className="shrink-0 rounded bg-amber/15 px-1 py-0.5 text-[10px] leading-none font-medium text-amber">Fixture · not Hermes</span> : null}
        <TooltipIconButton
          tooltip="Close briefing"
          side="top"
          onClick={() => useHermesSelection.setState({ briefingClosedId: job.investigation_id })}
          className="ml-auto size-7 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </TooltipIconButton>
      </div>

      <p className="mt-2.5 line-clamp-4 text-[16px] leading-snug font-medium tracking-[-0.01em]">
        {job.status === "failed" ? job.error ?? summary.headline : summary.headline}
      </p>
      {summary.recommendation && !summary.headline.includes(summary.recommendation) ? (
        <p className="mt-2 line-clamp-3 border-l-2 border-violet/50 pl-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
          {summary.recommendation}
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-3 gap-2">
        {[
          { value: String(sites.length), label: sites.length === 1 ? "Site mapped" : "Sites mapped" },
          { value: String(summary.okCalls), label: summary.failedCalls ? `Tool calls ok · ${summary.failedCalls} failed` : "Tool calls ok" },
          { value: summary.risk === "unknown" ? "—" : summary.risk, label: "Risk, from results" },
        ].map((tile) => (
          <div key={tile.label} className="min-w-0 rounded-xl border bg-foreground/[0.02] px-2 py-1.5">
            <div className="text-[18px] leading-tight font-semibold capitalize tabular-nums">{tile.value}</div>
            <div className="truncate text-[10.5px] text-muted-foreground" title={tile.label}>{tile.label}</div>
          </div>
        ))}
      </div>

      {mapError ? (
        <p role="alert" className="mt-2 rounded-xl border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-[12px] text-destructive">
          {mapError}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {sites.length && !onMap ? (
          <Button size="sm" variant="brand" disabled={mapping} onClick={() => void showOnMap()}>
            {mapping ? <Loader2 className="animate-spin" /> : <MapPinned />}
            Show {sites.length} {sites.length === 1 ? "site" : "sites"} on the map
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={openAgents}>
          Open the investigation
        </Button>
      </div>
    </section>
  );
}
