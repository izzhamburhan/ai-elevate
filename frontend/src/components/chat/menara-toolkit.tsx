"use client";

import { defineToolkit } from "@assistant-ui/react";
import { Loader2 } from "lucide-react";
import { z } from "zod";

import { AreaCard, type Section } from "@/components/map/panels/area-card";
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
      "Draw a place on the map and show what the user asked about it as an interactive card. Use it whenever the user asks about towers, " +
      "subscribers (people, users, trails, movements) or usage (apps, data, what people use) in a place, town, district, neighbourhood or radius " +
      "(for example \"list the towers in Cyberjaya\", \"towers and subscribers in Gombak\", \"what do people use around KLCC\"). " +
      "`show` lists ONLY the parts the user asked for: [\"towers\"] when they ask about towers or sites; add \"subscribers\" only when they " +
      "ask about subscribers, people, users or trails; add \"usage\" only when they ask about apps, data or usage. Use all three only when " +
      "they ask for everything. " +
      "Give `place` as the name only (Cyberjaya, Gombak, Selangor...): the real boundary is drawn and only what is inside it is listed. " +
      "Give `radius_km` only when the user asks for a distance; then a circle of that radius is drawn around the place. " +
      "Give `lat` and `lng` only for a point that is not an administrative area (for example KLCC 3.157,101.713). " +
      "The answer shows the card; summarise it in a sentence or two instead of repeating the rows.",
    parameters: z.object({
      place: z.string().describe("Name of the place, e.g. Cyberjaya"),
      show: z
        .array(z.enum(["towers", "subscribers", "usage"]))
        .min(1)
        .describe("Only the parts the user asked for, e.g. [\"towers\"] or [\"towers\", \"subscribers\"]"),
      radius_km: z.number().min(1).max(50).optional().describe("Only when the user gives a distance"),
      lat: z.number().optional().describe("Only for a point that is not an administrative area"),
      lng: z.number().optional().describe("Only for a point that is not an administrative area"),
    }),
    execute: async ({ place, show, radius_km, lat, lng }) => {
      const want = new Set<Section>(show?.length ? show : ["towers"]);
      const resolved = await post<ResolvedPlace>("/api/menara/place", { name: place, radius_km, lat, lng });
      const { center } = resolved;
      const towers = await menara<{ towers: { enodeb_name: string; status: string; lat: number; lng: number }[] }>("tower_list_in_radius", {
        lat: center.lat,
        lng: center.lng,
        radius_km: resolved.radius_km,
        limit: 200,
      });
      const within = resolved.rings.length ? towers.towers.filter((t) => resolved.rings.some((ring) => pointInRing(ring, t.lat, t.lng))) : towers.towers;
      const summary: Record<string, unknown> = {
        place: resolved.name,
        level: resolved.level,
        state: resolved.state,
        shape: resolved.rings.length ? "boundary" : `circle of ${resolved.radius_km} km`,
        shown: [...want],
      };
      if (want.has("towers")) {
        summary.towers = within.length;
        summary.degraded = within.filter((t) => t.status === "DEGRADED").length;
        summary.down = within.filter((t) => t.status === "DOWN").length;
        summary.not_up = within.filter((t) => t.status !== "UP").map((t) => `${t.enodeb_name} ${t.status}`);
      }
      if (want.has("subscribers")) {
        const loads = await Promise.all(
          within.slice(0, 25).map((t) => menara<{ towers: { subscribers_est: number }[] }>("user_list_on_tower", { enodeb_name: t.enodeb_name, limit: 1 }).catch(() => null)),
        );
        summary.people_estimate = loads.reduce((sum, r) => sum + (r?.towers?.[0]?.subscribers_est ?? 0), 0);
        summary.hint = "The user can click a subscriber in the card for the 24 h trail and 4-week routine.";
      }
      if (want.has("usage")) {
        const apps = await menara<{ apps: { name: string; reach_pct: number }[] }>("usage_top_apps_in_area", {
          lat: center.lat,
          lng: center.lng,
          radius_km: resolved.radius_km,
          limit: 3,
        }).catch(() => null);
        summary.top_apps = apps?.apps.map((a) => `${a.name} (${a.reach_pct}% reach)`) ?? [];
      }
      return summary;
    },
    render: ({ args, result }) =>
      result ? (
        <AreaCard place={args.place} lat={args.lat} lng={args.lng} radiusKm={args.radius_km} show={args.show} />
      ) : (
        <Working text={`Finding ${args.place ?? "the place"}…`} />
      ),
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
      "live: the loop in the chat, the incident on the map and the load chart at the bottom right. Use it when the user asks to run, show or " +
      "explain self-healing, the flood incident or the closed loop. Human in the loop: every risky step waits for the user to approve or " +
      "reject in the card; it cannot be skipped. The card shows every step, so do not describe them yourself; add at most one sentence, " +
      "and remind the user to approve in the card.",
    parameters: z.object({}),
    execute: async () => {
      const started = await post<{ runId: string; existing: boolean }>("/api/menara/heal", {});
      return {
        run_id: started.runId,
        already_running: started.existing,
        note: "The self-heal card is shown to the user. A human must approve each risky step in the card (human in the loop).",
      };
    },
    render: ({ result }) => (result ? <HealPanel runId={(result as { run_id?: string }).run_id} /> : <Working text="Starting the self-heal replay…" />),
  },
});
