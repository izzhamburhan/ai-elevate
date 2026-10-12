"use client";

import { useAui } from "@assistant-ui/react";
import { ArrowRightIcon, EyeIcon, FileWarningIcon, RefreshCwIcon, ShieldAlertIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";

import { useMapActions } from "@/components/map/use-map-actions";
import { OVERVIEW_REFRESH_EVENT, useNetworkOverview, type Hotspot } from "@/lib/network-overview";
import { cn } from "@/lib/utils";

const fmtTime = (value: string | number | null | undefined) =>
  value == null ? undefined : new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

const list = (names: string[], max = 4) =>
  names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} and ${names.length - max} more`;

function triagePrompt(h: Hotspot) {
  const parts = [
    h.down.length && `${h.down.length} down (${list(h.down, 6)})`,
    h.degraded.length && `${h.degraded.length} degraded (${list(h.degraded, 6)})`,
    h.critical && `${h.critical} critical alarms`,
    h.major && `${h.major} major alarms`,
  ].filter(Boolean);
  return `Triage ${h.town}, ${h.state}: ${parts.join(", ")}. Is there a common cause? What is the impact on critical sites, customers and enterprise SLAs? Recommend one action with your confidence.`;
}

function Badge({ n, label, tone }: { n: number; label: string; tone: string }) {
  if (!n) return null;
  return (
    <span className={cn("rounded px-1.5 py-px text-[11px] font-medium tabular-nums", tone)}>
      {n} {label}
    </span>
  );
}

const RED = "bg-red-500/15 text-red-600 dark:text-red-400";
const ORANGE = "bg-orange-500/15 text-orange-600 dark:text-orange-400";

function HotspotRow({ spot, rank }: { spot: Hotspot; rank: number }) {
  const aui = useAui();
  const { focusTowers } = useMapActions();
  return (
    <li className="group flex items-center gap-2 py-1.5">
      <span className="w-4 shrink-0 text-center text-xs text-muted-foreground tabular-nums">{rank}</span>
      <button
        type="button"
        onClick={() => focusTowers(spot.towers)}
        className="min-w-0 flex-1 text-start"
        title="Show on the map"
      >
        <span className="block truncate text-sm font-medium">
          {spot.town} <span className="font-normal text-muted-foreground">· {spot.state}</span>
        </span>
        <span className="mt-0.5 flex flex-wrap gap-1">
          <Badge n={spot.down.length} label="down" tone={RED} />
          <Badge n={spot.critical} label="critical" tone={RED} />
          <Badge n={spot.degraded.length} label="degraded" tone={ORANGE} />
          <Badge n={spot.major} label="major" tone={ORANGE} />
          {spot.incidents > 0 && <Badge n={spot.incidents} label="in incident" tone="bg-sky-500/15 text-sky-700 dark:text-sky-400" />}
        </span>
      </button>
      <button
        type="button"
        onClick={() => focusTowers(spot.towers)}
        aria-label={`Show ${spot.town} on the map`}
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <EyeIcon className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={() => {
          focusTowers(spot.towers);
          aui.thread().append(triagePrompt(spot));
        }}
        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background hover:bg-foreground/85"
      >
        Investigate <ArrowRightIcon className="size-3" />
      </button>
    </li>
  );
}

/**
 * Home screen of the assistant: the state of the network, where to look first and what is waiting
 * on the engineer. Built from the backend directly (no model call), refreshed every minute.
 */
export function SituationBoard() {
  const aui = useAui();
  const { focusTowers } = useMapActions();
  const { overview, delta, error, loading, fetchedAt } = useNetworkOverview();
  const [showAll, setShowAll] = useState(false);
  const refresh = () => window.dispatchEvent(new Event(OVERVIEW_REFRESH_EVENT));

  if (!overview) {
    return (
      <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        {error ? (
          <>
            <p className="text-amber-600 dark:text-amber-400">Network status unavailable: {error}</p>
            <button type="button" onClick={refresh} className="mt-1 underline underline-offset-2">
              Try again
            </button>
          </>
        ) : (
          "Loading network status…"
        )}
      </div>
    );
  }

  const total = overview.towers.length;
  const down = overview.towersByStatus.DOWN ?? 0;
  const degraded = overview.towersByStatus.DEGRADED ?? 0;
  const critical = overview.alarmsBySeverity.CRITICAL ?? 0;
  const upPct = total ? Math.round(((overview.towersByStatus.UP ?? 0) / total) * 1000) / 10 : 0;
  const spots = showAll ? overview.hotspots : overview.hotspots.slice(0, 4);
  const approvals = overview.pendingApprovals.length;
  const incidents = overview.openIncidents.length;

  return (
    <div className="mt-4 space-y-3">
      {/* health line */}
      <div className="rounded-lg border bg-muted/30 p-3">
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className={cn("size-1.5 rounded-full", error ? "bg-amber-500" : "bg-emerald-500 animate-pulse")} />
            {error ? "Refresh failed" : "Live"} · {fmtTime(fetchedAt)}
            {overview.truncated ? " · partial" : ""}
          </span>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            aria-label="Refresh network status"
            className="grid size-6 place-items-center rounded hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <RefreshCwIcon className={cn("size-3", loading && "animate-spin")} />
          </button>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1 text-center">
          {[
            { n: `${upPct}%`, label: "up", tone: "text-emerald-600 dark:text-emerald-400" },
            { n: down, label: "down", tone: down ? "text-red-600 dark:text-red-400" : "" },
            { n: degraded, label: "degraded", tone: degraded ? "text-orange-600 dark:text-orange-400" : "" },
            { n: critical, label: "critical", tone: critical ? "text-red-600 dark:text-red-400" : "" },
          ].map((s) => (
            <div key={s.label}>
              <div className={cn("text-lg leading-tight font-semibold tabular-nums", s.tone || "text-muted-foreground")}>{s.n}</div>
              <div className="text-[11px] text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">{total.toLocaleString()} towers</p>
      </div>

      {/* what changed since the last refresh */}
      {delta && (delta.newlyDown.length > 0 || delta.recovered.length > 0) && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-2.5 text-xs">
          {delta.newlyDown.length > 0 && (
            <p>
              <span className="font-medium text-red-600 dark:text-red-400">{delta.newlyDown.length} newly down</span> since{" "}
              {fmtTime(delta.since)}: <span className="font-mono">{list(delta.newlyDown)}</span>
            </p>
          )}
          {delta.recovered.length > 0 && (
            <p className="mt-0.5">
              <span className="font-medium text-emerald-600 dark:text-emerald-400">{delta.recovered.length} recovered</span>:{" "}
              <span className="font-mono">{list(delta.recovered)}</span>
            </p>
          )}
          {delta.newlyDown.length > 0 && (
            <button
              type="button"
              onClick={() => {
                focusTowers(delta.newlyDown);
                aui.thread().append(`These towers just went down: ${delta.newlyDown.join(", ")}. Why, and what is affected?`);
              }}
              className="mt-1.5 font-medium underline underline-offset-2"
            >
              Investigate what just went down
            </button>
          )}
        </div>
      )}

      {/* waiting on the engineer */}
      {(approvals > 0 || incidents > 0) && (
        <div className="space-y-1.5">
          {approvals > 0 && (
            <button
              type="button"
              onClick={() => aui.thread().append("Show the actions waiting for my approval, with what each would change and its risk.")}
              className="flex w-full items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-start text-sm hover:bg-amber-500/15"
            >
              <ShieldAlertIcon className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span className="flex-1">
                <span className="font-medium">{approvals}</span> action{approvals === 1 ? "" : "s"} waiting for your approval
              </span>
              <ArrowRightIcon className="size-3.5 text-muted-foreground" />
            </button>
          )}
          {incidents > 0 && (
            <button
              type="button"
              onClick={() => {
                focusTowers(overview.openIncidents.map((i) => i.enodeb_name));
                aui.thread().append("Summarise the open incidents: cause, status, what has been done and what is next for each.");
              }}
              className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-start text-sm hover:bg-muted"
            >
              <FileWarningIcon className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />
              <span className="flex-1">
                <span className="font-medium">{incidents}</span> open incident{incidents === 1 ? "" : "s"}
              </span>
              <ArrowRightIcon className="size-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
      )}

      {/* where to look first */}
      {overview.hotspots.length > 0 ? (
        <div>
          <div className="flex items-baseline justify-between px-0.5">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Where to look first</h3>
            {overview.hotspots.length > 4 && (
              <button type="button" onClick={() => setShowAll((v) => !v)} className="text-xs text-muted-foreground hover:text-foreground">
                {showAll ? "Top 4" : `All ${overview.hotspots.length}`}
              </button>
            )}
          </div>
          <ol className="mt-1 divide-y divide-border/60">
            {spots.map((spot, i) => (
              <HotspotRow key={spot.id} spot={spot} rank={i + 1} />
            ))}
          </ol>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
          <SparklesIcon className="size-4" /> All towers are up and no major alarms are active.
        </p>
      )}
    </div>
  );
}
