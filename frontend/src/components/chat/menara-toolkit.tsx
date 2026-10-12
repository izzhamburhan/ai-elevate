"use client";

import { defineToolkit } from "@assistant-ui/react";
import { Loader2 } from "lucide-react";
import { z } from "zod";

import { AreaPanel } from "@/components/map/panels/area-panel";
import { HealPanel } from "@/components/map/panels/heal-panel";

/**
 * Two chat tools whose results render as cards inside the answer (instead of side-panel tabs):
 *  - show_area: draws a circle on the map and shows the towers, people and apps in it (Map & area)
 *  - run_self_heal: runs the flood self-heal replay and shows the live 8-stage loop and load chart
 * They run in the browser, so the card and the map are in the same place as the chat.
 */

async function menara<T>(tool: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/menara/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${tool} failed (${res.status})`);
  return body.data as T;
}

function Working({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border bg-card/40 px-3 py-2 text-[12px] text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" /> {text}
    </div>
  );
}

export const menaraToolkit = defineToolkit({
  show_area: {
    type: "frontend",
    display: "standalone",
    description:
      "Show a place on the map as a circle and list the towers, people and apps inside it. Use it whenever the user asks about " +
      "an area, town, neighbourhood or radius (for example \"what is around Kota Bharu\", \"show towers within 5 km of KLCC\"). " +
      "Give the centre as lat/lng (Malaysia: Kuala Lumpur KLCC 3.157,101.713; Kota Bharu 6.125,102.24; Johor Bahru 1.492,103.741; " +
      "George Town 5.415,100.328; Kuching 1.553,110.359; Kota Kinabalu 5.981,116.073) and radius_km from 1 to 50. " +
      "The answer shows an interactive card; summarise it briefly instead of repeating every row.",
    parameters: z.object({
      lat: z.number().describe("Latitude of the centre"),
      lng: z.number().describe("Longitude of the centre"),
      radius_km: z.number().min(1).max(50).describe("Radius in km"),
      place: z.string().optional().describe("Name of the place, for the card title"),
    }),
    execute: async ({ lat, lng, radius_km, place }) => {
      const [towers, people, apps] = await Promise.all([
        menara<{ towers: { status: string }[] }>("tower_list_in_radius", { lat, lng, radius_km, limit: 200 }),
        menara<{ subscribers_total: number; subscribers_est_total: number }>("user_list_in_area", { lat, lng, radius_km, limit: 1 }),
        menara<{ apps: { name: string; reach_pct: number }[]; busiest_hour: number | null }>("usage_top_apps_in_area", { lat, lng, radius_km, limit: 3 }).catch(() => null),
      ]);
      const count = (status: string) => towers.towers.filter((t) => t.status === status).length;
      return {
        place: place ?? null,
        center: { lat, lng },
        radius_km,
        towers: towers.towers.length,
        degraded: count("DEGRADED"),
        down: count("DOWN"),
        people_estimate: people.subscribers_est_total,
        top_apps: apps?.apps.map((a) => `${a.name} (${a.reach_pct}% reach)`) ?? [],
        busiest_hour: apps?.busiest_hour ?? null,
        note: "A card with the circle on the map, towers, sampled people, trails and routines is shown to the user.",
      };
    },
    render: ({ args, result }) =>
      result ? (
        <AreaPanel embedded initial={{ lat: args.lat, lng: args.lng, radius_km: args.radius_km, place: args.place }} />
      ) : (
        <Working text="Looking up the area…" />
      ),
  },

  run_self_heal: {
    type: "frontend",
    display: "standalone",
    description:
      "Run the self-heal replay of the flood incident (detect, diagnose, simulate, approve, apply, verify, roll back, recover) and show it " +
      "live as a diagram with a load chart. Use it when the user asks to run, show or explain self-healing, the flood incident or the " +
      "closed loop. A human approves the risky steps in the card. Do not describe each step yourself: the card shows them.",
    parameters: z.object({}),
    execute: async () => {
      const res = await fetch("/api/menara/heal", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await res.json().catch(() => ({}));
      // a run already in progress is fine: the card shows that one
      if (!res.ok && !String(body.error ?? "").includes("already in progress")) throw new Error(body.error ?? `Could not start (${res.status})`);
      return { started: true, note: "The self-heal diagram is shown to the user. A human approves the risky steps in the card; wait for them." };
    },
    render: ({ result }) => (result ? <HealPanel embedded /> : <Working text="Starting the self-heal replay…" />),
  },
});