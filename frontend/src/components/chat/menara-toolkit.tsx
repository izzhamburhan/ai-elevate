"use client";

import { defineToolkit } from "@assistant-ui/react";
import { Loader2 } from "lucide-react";
import { z } from "zod";

import { AreaCard } from "@/components/map/panels/area-card";
import { HealPanel } from "@/components/map/panels/heal-panel";
import { pointInRing } from "@/lib/menara/geometry";

/**
 * Chat tools whose results render as cards inside the answer:
 *  - show_area: draws a place on the map and shows its towers, people, trails, routines and app usage
 *  - describe_trail: gives the model the facts to put one subscriber's trail into words
 *  - run_self_heal: runs the flood self-heal replay and shows the live 8-stage loop and load chart
 * They run in the browser, so the cards and the map are in the same place as the chat.
 */

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `${url} failed (${res.status})`);
  return data as T;
}
const menara = async <T,>(tool: string, args: Record<string, unknown>) => (await post<{ data: T }>("/api/menara/call", { tool, args })).data;

function Working({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border bg-card/40 px-3 py-2 text-[12px] text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" /> {text}
    </div>
  );
}

type ResolvedPlace = {
  name: string;
  level: string;
  state: string | null;
  district: string | null;
  center: { lat: number; lng: number };
  radius_km: number;
  rings: number[][][];
};

export const menaraToolkit = defineToolkit({
  show_area: {
    type: "frontend",
    display: "standalone",
    description:
      "Draw a place on the map and show its towers, the people there, what they use, and each subscriber's trail and routine, as an interactive " +
      "card. Use it whenever the user asks about towers, people or usage in a place, town, district or neighbourhood (for example " +
      "\"list the towers in Cyberjaya\", \"what is around Kota Bharu\", \"towers within 5 km of KLCC\"). " +
      "Give `place` as the name only (Cyberjaya, Kota Bharu, Selangor...): the real boundary is drawn and only the towers inside it are listed. " +
      "Give `radius_km` only when the user asks for a distance; then a circle of that radius is drawn around the place. " +
      "Give `lat` and `lng` only for a point that is not an administrative area (for example KLCC 3.157,101.713). " +
      "The answer shows the card; summarise it in a sentence or two instead of repeating the rows, and tell the user they can click a subscriber for the trail.",
    parameters: z.object({
      place: z.string().describe("Name of the place, e.g. Cyberjaya"),
      radius_km: z.number().min(1).max(50).optional().describe("Only when the user gives a distance"),
      lat: z.number().optional().describe("Only for a point that is not an administrative area"),
      lng: z.number().optional().describe("Only for a point that is not an administrative area"),
    }),
    execute: async ({ place, radius_km, lat, lng }) => {
      const resolved = await post<ResolvedPlace>("/api/menara/place", { name: place, radius_km, lat, lng });
      const { center } = resolved;
      const [towers, people, apps] = await Promise.all([
        menara<{ towers: { enodeb_name: string; status: string; lat: number; lng: number }[] }>("tower_list_in_radius", { lat: center.lat, lng: center.lng, radius_km: resolved.radius_km, limit: 200 }),
        menara<{ towers: { enodeb_name: string; subscribers_est: number }[] }>("user_list_in_area", { lat: center.lat, lng: center.lng, radius_km: resolved.radius_km, limit: 1 }),
        menara<{ apps: { name: string; reach_pct: number }[] }>("usage_top_apps_in_area", { lat: center.lat, lng: center.lng, radius_km: resolved.radius_km, limit: 3 }).catch(() => null),
      ]);
      const within = resolved.rings.length ? towers.towers.filter((t) => resolved.rings.some((ring) => pointInRing(ring, t.lat, t.lng))) : towers.towers;
      const names = new Set(within.map((t) => t.enodeb_name));
      return {
        place: resolved.name,
        level: resolved.level,
        state: resolved.state,
        shape: resolved.rings.length ? "boundary" : `circle of ${resolved.radius_km} km`,
        towers: within.length,
        degraded: within.filter((t) => t.status === "DEGRADED").length,
        down: within.filter((t) => t.status === "DOWN").length,
        down_towers: within.filter((t) => t.status !== "UP").map((t) => `${t.enodeb_name} ${t.status}`),
        people_estimate: people.towers.filter((t) => names.has(t.enodeb_name)).reduce((sum, t) => sum + t.subscribers_est, 0),
        top_apps: apps?.apps.map((a) => `${a.name} (${a.reach_pct}% reach)`) ?? [],
        note: "A card with the map outline, the towers, people, trails and routines is shown to the user.",
      };
    },
    render: ({ args, result }) =>
      result ? <AreaCard place={args.place} lat={args.lat} lng={args.lng} radiusKm={args.radius_km} /> : <Working text={`Finding ${args.place ?? "the place"}…`} />,
  },

  describe_trail: {
    type: "frontend",
    description:
      "Get the facts to describe one subscriber's movements: the last 24 hours, the known sites near each tower, and the 4-week routine. " +
      "Call it when the user asks you to explain or describe a subscriber's trail (the Map & area card has an 'Explain this trail' button that asks for it). " +
      "Then answer in a few short plain sentences and follow the `rules` in the result exactly.",
    parameters: z.object({ msisdn_hash: z.string().regex(/^[0-9a-f]{16}$/).describe("16 hex characters, from the Map & area card") }),
    execute: async ({ msisdn_hash }) => post("/api/menara/trail-facts", { msisdn_hash }),
    render: () => null,
  },

  run_self_heal: {
    type: "frontend",
    display: "standalone",
    description:
      "Run the self-heal replay of the flood incident (detect, diagnose, simulate, approve, apply, verify, roll back, recover) and show it " +
      "live as a diagram with a load chart. Use it when the user asks to run, show or explain self-healing, the flood incident or the " +
      "closed loop. The card shows every step, so do not describe them yourself; add at most one sentence. Risky steps wait for a human to " +
      "approve in the card; set `auto_approve` to true only when the user explicitly asks to run it without asking for approval.",
    parameters: z.object({ auto_approve: z.boolean().optional().describe("True only when the user asks to skip the approval prompts") }),
    execute: async ({ auto_approve }) => {
      const res = await fetch("/api/menara/heal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoApprove: auto_approve === true }),
      });
      const body = await res.json().catch(() => ({}));
      // a run already in progress is fine: the card shows that one
      if (!res.ok && !String(body.error ?? "").includes("already in progress")) throw new Error(body.error ?? `Could not start (${res.status})`);
      return {
        started: true,
        auto_approve: auto_approve === true,
        note: auto_approve ? "The diagram is shown to the user; approvals are automatic." : "The diagram is shown to the user; a human approves the risky steps in the card.",
      };
    },
    render: ({ result }) => (result ? <HealPanel embedded /> : <Working text="Starting the self-heal replay…" />),
  },
});
