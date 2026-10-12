/**
 * People-per-tower halos: a soft circle behind each tower dot, sized by how many subscribers it serves, coloured by
 * the tower's status. Pure functions only (no React, no kepler), so the Node tests can import this file directly.
 *
 * Calm by design: one size scale for every status (sizes compare across colours), the size follows the zoom so a
 * country view does not turn into a blob, and only a few count chips are shown, never two on top of each other.
 */

export type HaloTower = { enodeb_name: string; lat: number; lng: number; status: string; town?: string | null };
export type HaloLoad = { enodeb_name: string; subscribers_est?: number | null; subscribers_sampled?: number | null };
export type HaloRow = { tower: string; town: string; lat: number; lng: number; status: string; people: number };

/** Kepler dataset ids the halo overlay draws: the area card's and the subscriber chat card's. */
export const AREA_HALO_DATA = "area_people";
export const CHAT_HALO_DATA = "subs_people";
export const HALO_DATA_IDS = [AREA_HALO_DATA, CHAT_HALO_DATA] as const;

const MIN_RADIUS_PX = 12;
const MAX_RADIUS_PX = 38;
const BASE_ZOOM = 12; // a town or district view: halos at their designed size
const MAX_CHIPS = 5;
// a chip is about 90 x 20 px: two chips closer than this box would touch
const CHIP_BOX = { w: 100, h: 28 };
const CHIP_MIN_ZOOM = 10.5;

/** One row per tower that has people on it: tower position and status joined with its subscriber estimate. */
export function haloRows(towers: HaloTower[], loads: HaloLoad[]): HaloRow[] {
  const people = new Map<string, number>();
  for (const load of loads) {
    const n = load.subscribers_est ?? load.subscribers_sampled ?? 0;
    if (n > 0) people.set(load.enodeb_name, Math.max(n, people.get(load.enodeb_name) ?? 0));
  }
  return towers
    .filter((t) => (people.get(t.enodeb_name) ?? 0) > 0 && Number.isFinite(t.lat) && Number.isFinite(t.lng))
    .map((t) => ({ tower: t.enodeb_name, town: t.town ?? "", lat: t.lat, lng: t.lng, status: t.status || "UNKNOWN", people: people.get(t.enodeb_name) ?? 0 }))
    .sort((a, b) => b.people - a.people || a.tower.localeCompare(b.tower));
}

/** 980, 1.2k, 12k: short enough for a chip. */
export function compactCount(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(n / 1000)}k`;
}

/** How much the halos shrink or grow with the zoom: smaller further out, so a wide view stays readable. */
export function zoomFactor(zoom: number): number {
  return Math.min(1.35, Math.max(0.35, 2 ** ((zoom - BASE_ZOOM) * 0.5)));
}

/** Halo radius in pixels: square root of the share of the busiest tower, so the area reads as the count. */
export function haloRadius(people: number, maxPeople: number, zoom: number): number {
  const share = maxPeople > 0 ? Math.sqrt(Math.max(0, people) / maxPeople) : 0;
  return (MIN_RADIUS_PX + (MAX_RADIUS_PX - MIN_RADIUS_PX) * share) * zoomFactor(zoom);
}

export type Placed = { key: string; x: number; y: number; people: number };

/**
 * Which halos get a count chip: the busiest first, at most `max`, none whose chip would touch one already placed, and
 * none when zoomed out too far to read them.
 */
export function chipKeys(points: Placed[], zoom: number, max = MAX_CHIPS, box = CHIP_BOX): Set<string> {
  const chosen: Placed[] = [];
  if (zoom < CHIP_MIN_ZOOM) return new Set();
  for (const p of [...points].sort((a, b) => b.people - a.people || a.key.localeCompare(b.key))) {
    if (chosen.length >= max) break;
    if (chosen.every((c) => Math.abs(c.x - p.x) >= box.w || Math.abs(c.y - p.y) >= box.h)) chosen.push(p);
  }
  return new Set(chosen.map((c) => c.key));
}