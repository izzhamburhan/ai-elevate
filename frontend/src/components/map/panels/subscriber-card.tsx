"use client";

import { useEffect, useRef } from "react";
import { useStore } from "react-redux";
import { useAui } from "@assistant-ui/react";
import { MapPinned, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TOWER_STATUS_COLOR } from "@/lib/map-colors";
import { useMapDraw } from "@/lib/menara/map-draw";
import { CHAT_HALO_DATA, compactCount, haloRows, type HaloTower } from "@/lib/subscribers/halos";
import { loadPeopleHalos } from "@/lib/subscribers/map-overlay";
import { cn } from "@/lib/utils";

import type { makeKeplerStore } from "../kepler-store";
import { intelEnvelope } from "./intel-card";

type KeplerStore = ReturnType<typeof makeKeplerStore>;

type Label = "GOOD" | "FAIR" | "POOR" | "NO_SERVICE";
type AreaSubscriber = { msisdn_hash: string; enodeb_name: string; latest_label: Label | null; cell_changes_24h: number };
type TowerSubscribers = { enodeb_name: string; cell_lat: number; cell_lng: number; subscribers_sampled: number; subscribers_est: number | null };
type SubscriberList = {
  center: { lat: number; lng: number } | null;
  radius_km: number | null;
  enodeb_name: string | null;
  towers: TowerSubscribers[];
  subscribers: AreaSubscriber[];
  subscribers_total: number | null;
  subscribers_est_total: number | null;
  returned: number;
  truncated: boolean;
  withheld: boolean;
};

export const SUBSCRIBER_TOOLS = ["user_list_on_tower", "user_list_in_area"] as const;
export type SubscriberTool = (typeof SUBSCRIBER_TOOLS)[number];

const LABELS: Label[] = ["NO_SERVICE", "POOR", "FAIR", "GOOD"];
const LABEL_WORD: Record<Label, string> = { NO_SERVICE: "No service", POOR: "Poor", FAIR: "Fair", GOOD: "Good" };
const LABEL_CHIP: Record<Label, string> = {
  GOOD: "bg-green/15 text-green",
  FAIR: "bg-amber/15 text-amber",
  POOR: "bg-orange-500/15 text-orange-500",
  NO_SERVICE: "bg-red/15 text-red",
};
const LABEL_BAR: Record<Label, string> = { GOOD: "bg-green", FAIR: "bg-amber", POOR: "bg-orange-500", NO_SERVICE: "bg-red" };
const TOWER_RADIUS: Record<string, number> = { UP: 30, DEGRADED: 45, DOWN: 45 };
const SHOWN = 8;

async function menara<T>(tool: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/menara/call", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, args }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${tool} failed (${res.status})`);
  return body.data as T;
}

// several cards can mount at once (one answer, or a reloaded chat): only the newest one draws on the map
let latestDraw = 0;

/** The listed towers on the map: their dots (by status) and, behind them, a halo sized by the people on each. */
function useDrawPeople(data: SubscriberList | null) {
  const store = useStore() as unknown as KeplerStore;
  const draw = useMapDraw();
  const drawn = useRef(false);
  useEffect(() => {
    if (drawn.current || !data || data.withheld || !data.towers.length) return;
    const mine = ++latestDraw;
    const timer = setTimeout(() => {
      drawn.current = true;
      void (async () => {
        const first = data.towers[0];
        const center = data.center ?? { lat: first.cell_lat, lng: first.cell_lng };
        // tower status and site position come from tower-mcp; user-mcp only knows cell-level positions
        const { towers } = await menara<{ towers: HaloTower[] }>("tower_list_in_radius", {
          lat: center.lat,
          lng: center.lng,
          radius_km: Math.min(100, Math.max(1, (data.radius_km ?? 0) + 0.5)),
          limit: 200,
        }).catch(() => ({ towers: [] as HaloTower[] }));
        if (mine !== latestDraw) return;
        const listed = new Set(data.towers.map((t) => t.enodeb_name));
        const sites = towers.filter((t) => listed.has(t.enodeb_name));
        // a tower tower-mcp did not return still gets its halo, at the cell position
        for (const t of data.towers) {
          if (!sites.some((s) => s.enodeb_name === t.enodeb_name)) sites.push({ enodeb_name: t.enodeb_name, lat: t.cell_lat, lng: t.cell_lng, status: "UNKNOWN" });
        }
        const rows = haloRows(sites, data.towers);
        draw.removeOurs(["subs_"]);
        await loadPeopleHalos(store, CHAT_HALO_DATA, rows);
        for (const status of ["UP", "DEGRADED", "DOWN", "UNKNOWN"]) {
          if (mine !== latestDraw) return;
          const dots = rows.filter((r) => r.status === status).map((r) => ({ name: r.tower, people: r.people, status, lat: r.lat, lng: r.lng }));
          const color = (TOWER_STATUS_COLOR as Record<string, string>)[status];
          await draw.addPoints(`subs_${status.toLowerCase()}`, `Towers ${status.toLowerCase()} (subscribers)`, dots, color, TOWER_RADIUS[status] ?? 30);
        }
        if (rows.length && mine === latestDraw) {
          const lats = rows.map((r) => r.lat);
          const lngs = rows.map((r) => r.lng);
          const pad = 0.012; // about a kilometre, so the halos are not cut at the edge
          draw.fit([Math.min(...lngs) - pad, Math.min(...lats) - pad, Math.max(...lngs) + pad, Math.max(...lats) + pad]);
        }
      })().catch((e) => console.warn("[subscribers] map draw failed", e));
    }, 0);
    return () => clearTimeout(timer);
  }, [data, draw, store]);
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl border bg-foreground/[0.02] px-2 py-1.5">
      <div className={cn("whitespace-nowrap text-[13px] font-semibold tabular-nums", tone)}>{value}</div>
      <div className="truncate text-[10.5px] text-muted-foreground">{label}</div>
    </div>
  );
}

/**
 * A subscriber list from the chat (one tower, or a circle) as a card: how many people, how their service is, the
 * worst-off first, and the same people on the map as halos around their towers. Cell level and synthetic.
 */
export function SubscriberCard({ tool, result }: { tool: SubscriberTool; result: unknown }) {
  const aui = useAui();
  const data = (intelEnvelope(result)?.data ?? null) as SubscriberList | null;
  useDrawPeople(data);

  if (!data) return null;
  const where = tool === "user_list_on_tower" && data.enodeb_name ? `on ${data.enodeb_name}` : data.radius_km ? `within ${data.radius_km} km` : "in the area";
  const people = data.subscribers_est_total ?? data.towers.reduce((sum, t) => sum + (t.subscribers_est ?? 0), 0);
  const counts = Object.fromEntries(LABELS.map((l) => [l, data.subscribers.filter((s) => s.latest_label === l).length])) as Record<Label, number>;
  const labelled = LABELS.reduce((sum, l) => sum + counts[l], 0);
  const rank = (s: AreaSubscriber) => (s.latest_label ? LABELS.indexOf(s.latest_label) : LABELS.length);
  const list = [...data.subscribers].sort((a, b) => rank(a) - rank(b) || a.msisdn_hash.localeCompare(b.msisdn_hash));
  const centre = data.center ?? (data.towers[0] ? { lat: data.towers[0].cell_lat, lng: data.towers[0].cell_lng } : null);

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card/40 p-3 font-sans text-foreground">
      <div className="flex items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-blue/15 text-blue">
          <Users className="size-3.5" />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">Subscribers {where}</h2>
          <p className="text-[11px] text-muted-foreground">
            {data.towers.length} tower{data.towers.length === 1 ? "" : "s"} · shown on the map as halos sized by people
          </p>
        </div>
      </div>

      {data.withheld ? (
        <p className="rounded-lg border bg-foreground/[0.02] px-2.5 py-2 text-[12px] text-muted-foreground">
          Fewer than 5 people here, so the list is withheld to protect privacy.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="People (est.)" value={compactCount(people)} />
            <Stat label="Listed" value={data.returned} />
            <Stat label="No service" value={counts.NO_SERVICE} tone={counts.NO_SERVICE ? "text-red" : undefined} />
          </div>

          {labelled ? (
            <div>
              <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label="Service mix of the listed subscribers">
                {LABELS.filter((l) => counts[l]).map((l) => (
                  <span key={l} className={LABEL_BAR[l]} style={{ width: `${(100 * counts[l]) / labelled}%` }} />
                ))}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                {LABELS.filter((l) => counts[l]).map((l) => (
                  <span key={l} className="flex items-center gap-1">
                    <span className={cn("size-1.5 rounded-full", LABEL_BAR[l])} />
                    {LABEL_WORD[l]} <span className="tabular-nums text-foreground/80">{counts[l]}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <ul className="flex flex-col gap-0.5 text-[12px]">
            {list.slice(0, SHOWN).map((s) => (
              <li key={s.msisdn_hash} className="flex items-center gap-2 rounded px-1.5 py-1">
                <span className="font-mono">{s.msisdn_hash.slice(0, 8)}</span>
                {s.latest_label ? (
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", LABEL_CHIP[s.latest_label])}>{LABEL_WORD[s.latest_label]}</span>
                ) : null}
                <span className="truncate text-muted-foreground">{s.enodeb_name}</span>
                <span className="ml-auto whitespace-nowrap text-muted-foreground">{s.cell_changes_24h} moves</span>
              </li>
            ))}
            {list.length > SHOWN ? <li className="px-1.5 text-[11px] text-muted-foreground">+{list.length - SHOWN} more in the list</li> : null}
          </ul>

          {centre ? (
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() =>
                aui
                  .thread()
                  .append(
                    `Show the towers and subscribers within ${Math.max(1, data.radius_km ?? 1)} km of ${centre.lat.toFixed(4)}, ${centre.lng.toFixed(4)} on the map, so I can open their trails.`,
                  )
              }
            >
              <MapPinned /> Open trails on the map
            </Button>
          ) : null}
        </>
      )}
      <p className="text-[11px] text-muted-foreground">Synthetic data. Cell level only; groups of 1–4 people are withheld.</p>
    </div>
  );
}