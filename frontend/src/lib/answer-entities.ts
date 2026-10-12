import type { ThreadMessage } from "@assistant-ui/react";

import { unwrapToolResult } from "./ai/tool-result";
import type { OverviewTower } from "./network-overview";

/** A place an answer talked about: a tower, or a site/point that came with coordinates. */
export type AnswerEntity = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  status: string;
  kind: "tower" | "place";
};

const MAX_ENTITIES = 500;
/** Map tools draw on the map themselves; the policy and audit trail have no places worth showing. */
const SKIP_TOOLS = /^(kepler_|policy_)/;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);

type Found = { name?: string; label?: string; lat?: number; lng?: number; status?: string };

/** Walks a tool result and collects every object that names a tower or carries coordinates. */
function collect(value: unknown, out: Found[], depth = 0) {
  if (depth > 8 || out.length > MAX_ENTITIES * 2 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collect(item, out, depth + 1);
    return;
  }
  const o = value as Record<string, unknown>;
  const name = str(o.enodeb_name);
  const lat = num(o.lat ?? o.latitude);
  const lng = num(o.lng ?? o.lon ?? o.long ?? o.longitude);
  const hasCoords = lat !== undefined && lng !== undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  if (name || hasCoords) {
    out.push({
      name,
      label: name ?? str(o.name) ?? str(o.site_name) ?? str(o.site_id) ?? str(o.id),
      lat: hasCoords ? lat : undefined,
      lng: hasCoords ? lng : undefined,
      status: str(o.status)?.toUpperCase(),
    });
  }
  for (const [key, child] of Object.entries(o)) {
    if (key !== "evidence" && child && typeof child === "object") collect(child, out, depth + 1);
  }
}

/**
 * Towers and places in the tool results of the latest assistant message. Towers named without
 * coordinates (alarms, tickets) are placed from the network overview. Undefined while there is no
 * assistant message to read.
 */
export function entitiesFromLastAnswer(
  messages: readonly ThreadMessage[],
  towers: readonly OverviewTower[],
): AnswerEntity[] | undefined {
  const last = [...messages].reverse().find((m) => m.role === "assistant");
  if (!last) return undefined;

  const found: Found[] = [];
  for (const part of last.content) {
    if (part.type !== "tool-call" || part.result === undefined || SKIP_TOOLS.test(part.toolName)) continue;
    collect(unwrapToolResult(part.result), found);
  }

  const byName = new Map(towers.map((t) => [t.enodeb_name, t]));
  const entities = new Map<string, AnswerEntity>();
  for (const f of found) {
    const tower = f.name ? byName.get(f.name) : undefined;
    const lat = f.lat ?? tower?.lat;
    const lng = f.lng ?? tower?.lng;
    const label = f.label ?? tower?.enodeb_name;
    if (lat === undefined || lng === undefined || !label) continue;
    const id = f.name ?? `${label}@${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (entities.has(id)) continue;
    entities.set(id, {
      id,
      label,
      lat,
      lng,
      // live status from the overview wins: a nested neighbour entry may carry an older one
      status: tower?.status ?? f.status ?? (f.name ? "UNKNOWN" : "PLACE"),
      kind: f.name ? "tower" : "place",
    });
    if (entities.size >= MAX_ENTITIES) break;
  }
  return [...entities.values()];
}
