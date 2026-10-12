"use client";

import { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { useAui } from "@assistant-ui/react";
import { onMapClick, wrapTo } from "@kepler.gl/actions";
import { BatteryLowIcon, PlugZapIcon, XIcon } from "lucide-react";

import { MAP_ID } from "@/components/map/kepler-store";
import { useClickedEntity } from "@/components/map/use-clicked-entity";
import { useMapActions } from "@/components/map/use-map-actions";
import { cn } from "@/lib/utils";

type TowerDetail = {
  enodeb_name: string;
  name: string;
  town: string;
  state: string;
  status: string;
  vendor: string;
  battery_pct: number | null;
  mains_ok: boolean | null;
  active_alarm_count: number;
  latest_kpi: { prb_util: number; drop_rate: number; throughput_mbps: number } | null;
  neighbours: { enodeb_name: string; status: string; prb_util: number | null }[];
};

const STATUS_STYLE: Record<string, string> = {
  DOWN: "bg-red-500/15 text-red-600 dark:text-red-400",
  DEGRADED: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  UP: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  UNKNOWN: "bg-muted text-muted-foreground",
};

/** Neighbours this loaded are likely absorbing the traffic of a tower that is down. */
const HOT_PRB = 85;

function useTowerDetail(name: string | undefined) {
  const [state, setState] = useState<{ name?: string; detail?: TowerDetail; error?: string }>({});
  useEffect(() => {
    if (!name) return;
    let current = true;
    fetch(`/api/tower?name=${encodeURIComponent(name)}`)
      .then(async (res) => {
        const body = await res.json();
        if (!current) return;
        setState(res.ok ? { name, detail: body as TowerDetail } : { name, error: body.error ?? "Lookup failed." });
      })
      .catch(() => current && setState({ name, error: "Lookup failed." }));
    return () => {
      current = false;
    };
  }, [name]);
  return state.name === name ? state : {};
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div className={cn("text-sm font-semibold tabular-nums", warn && "text-red-600 dark:text-red-400")}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

/**
 * What the engineer clicked on the map. A tower gets its live state and one-click next steps;
 * anything else (a site, a point the assistant loaded) gets an "ask about it" line.
 */
export function SelectionCard() {
  const aui = useAui();
  const dispatch = useDispatch();
  const selected = useClickedEntity();
  const { knownTowers } = useMapActions();
  const isTower = selected ? knownTowers.has(selected.label) : false;
  const { detail, error } = useTowerDetail(isTower ? selected?.label : undefined);

  if (!selected) return null;
  const close = () => dispatch(wrapTo(MAP_ID, onMapClick() as never));
  const ask = (prompt: string) => aui.thread().append(prompt);

  if (!isTower) {
    return (
      <button
        type="button"
        onClick={() => ask(`Tell me about ${selected.label} (selected on the map): what it is, its state and what it affects.`)}
        className="flex w-full items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-start text-xs hover:bg-muted"
      >
        <span className="text-muted-foreground">Selected</span>
        <span className="truncate font-medium">{selected.label}</span>
        <span className="ms-auto font-medium">Ask about it</span>
      </button>
    );
  }

  const name = selected.label;
  const hot = detail?.neighbours.filter((n) => (n.prb_util ?? 0) >= HOT_PRB) ?? [];
  const kpi = detail?.latest_kpi;
  const actions = [
    { label: "Investigate", primary: true, prompt: `Triage tower ${name}: alarms, blast radius, impact on critical sites and customers, likely cause, and simulate a fix. Recommend one action with your confidence.` },
    { label: "Blast radius", prompt: `What is the blast radius of ${name}: neighbours, shared power feeder, nearest river gauge, subscribers and critical sites affected?` },
    { label: "Simulate failure", prompt: `Simulate ${name} failing completely. Which neighbours take the load, do any overload, and who loses service?` },
  ];

  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            <span className="font-mono font-semibold">{name}</span>
            {detail && <span className={cn("rounded px-1.5 py-px text-[11px] font-medium", STATUS_STYLE[detail.status] ?? STATUS_STYLE.UNKNOWN)}>{detail.status}</span>}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {detail ? `${detail.town}, ${detail.state} · ${detail.vendor}` : error ?? "Loading…"}
          </p>
        </div>
        <button type="button" onClick={close} aria-label="Close" className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
          <XIcon className="size-3.5" />
        </button>
      </div>

      {detail && (
        <>
          <div className="mt-2.5 grid grid-cols-4 gap-1">
            <Metric label="alarms" value={String(detail.active_alarm_count)} warn={detail.active_alarm_count > 0} />
            <Metric label="PRB load" value={kpi ? `${Math.round(kpi.prb_util)}%` : "–"} warn={(kpi?.prb_util ?? 0) >= HOT_PRB} />
            <Metric label="drop rate" value={kpi ? `${kpi.drop_rate.toFixed(1)}%` : "–"} />
            <Metric label="Mbps" value={kpi ? String(Math.round(kpi.throughput_mbps)) : "–"} />
          </div>
          {(detail.mains_ok === false || hot.length > 0) && (
            <ul className="mt-2 space-y-0.5 text-xs">
              {detail.mains_ok === false && (
                <li className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                  <PlugZapIcon className="size-3.5" /> Mains power lost
                  {detail.battery_pct != null && (
                    <span className="inline-flex items-center gap-0.5">
                      · <BatteryLowIcon className="size-3.5" /> {detail.battery_pct}% battery
                    </span>
                  )}
                </li>
              )}
              {hot.length > 0 && (
                <li className="text-orange-600 dark:text-orange-400">
                  {hot.length} neighbour{hot.length === 1 ? "" : "s"} over {HOT_PRB}% load:{" "}
                  <span className="font-mono">{hot.map((n) => n.enodeb_name).join(", ")}</span>
                </li>
              )}
            </ul>
          )}
        </>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => ask(a.prompt)}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-medium",
              a.primary ? "bg-foreground text-background hover:bg-foreground/85" : "border hover:bg-muted",
            )}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
