import { callMenaraTool, dataOf } from "./call";

/**
 * Routines worked out from a long trail (default: the last 4 weeks): the counts are computed here, so no model is needed.
 * A routine is a place a subscriber returns to: the home tower (where most of the time is spent), a weekday place
 * (at least 5 weekdays) or a weekend place (at least 3 weekend days across at least 2 completed weekends).
 * A stay under 45 minutes is transit, not a stop. Locations are cell level, so a place is "near" its sites.
 * All data is synthetic. Port of palantir's menara_demo/routines.py.
 */
export const DEFAULT_WINDOW_MIN = 40320;
const MIN_STAY_MIN = 45;
const MIN_WEEKDAYS = 5;
const MIN_WEEKEND_DAYS = 3;
const MIN_WEEKENDS = 2;
const HOME_SHARE = 0.4;
const MAX_SITES_NAMED = 2;
const NEARBY_KM = 2.5;
const MAX_NEARBY = 5;
const DAY_MS = 86_400_000;

type Segment = { enodeb_name: string; cell_lat: number; cell_lng: number; arrived_at: string; left_at: string | null; duration_min: number };
type Trail = { window_start: string; window_min: number; segments: Segment[] };
type Site = { name: string; kind: string; lat: number; lng: number; distance_km: number };

export type Routine = {
  tower: string;
  kind: "home" | "weekday" | "weekend";
  lat: number;
  lng: number;
  days: number | null;
  of: number | null;
  sites: string[];
  sentence: string;
};

/** Wall-clock parts of an ISO stamp. Every stamp of a trail shares one UTC offset, so the local reading is used as is. */
function wall(iso: string) {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(iso);
  if (!m) throw new Error(`Unexpected timestamp "${iso}"`);
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const day = Math.floor(ms / DAY_MS);
  return { ms, day, hour: +m[4], weekday: (new Date(ms).getUTCDay() + 6) % 7 }; // 0 = Monday
}
const weekdayOf = (day: number) => (new Date(day * DAY_MS).getUTCDay() + 6) % 7;

/** Saturdays of the weekends that began and ended inside the window (the clock's own weekend is not complete). */
function completedWeekends(windowStart: string, windowMin: number): number[] {
  const start = wall(windowStart);
  const endDay = Math.floor((start.ms + windowMin * 60_000) / DAY_MS);
  const saturdays: number[] = [];
  for (let day = start.day; day < endDay; day++) {
    if (weekdayOf(day) === 5 && day + 1 < endDay) saturdays.push(day);
  }
  return saturdays;
}

const medianLow = (values: number[]) => (values.length ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)] : null);

type Stats = {
  total: number;
  weekdayDays: number;
  weekendDays: number;
  weekendWeekends: number;
  weekday: { hour: number | null; minutes: number | null };
  weekend: { hour: number | null; minutes: number | null };
};

/** Per tower where the subscriber stayed at least 45 minutes: time spent and the days of arrival. */
function towerStats(trail: Trail): Record<string, Stats> {
  const start = wall(trail.window_start);
  const weekends = new Set(completedWeekends(trail.window_start, trail.window_min));
  const total: Record<string, number> = {};
  const weekdayDays: Record<string, Set<number>> = {};
  const weekendDays: Record<string, Set<number>> = {};
  const hours: Record<string, { weekday: number[]; weekend: number[] }> = {};
  const stays: Record<string, { weekday: number[]; weekend: number[] }> = {};
  const slot = <T>(map: Record<string, T>, key: string, make: () => T) => (map[key] ??= make());

  for (const seg of trail.segments) {
    const minutes = Math.round(seg.duration_min);
    if (minutes < MIN_STAY_MIN) continue;
    const tower = seg.enodeb_name;
    total[tower] = (total[tower] ?? 0) + minutes;
    const arrived = wall(seg.arrived_at);
    if (arrived.ms < start.ms) continue; // began before the window: time counts, but not as an arrival
    if (arrived.weekday < 5) {
      slot(weekdayDays, tower, () => new Set()).add(arrived.day);
      slot(hours, tower, () => ({ weekday: [], weekend: [] })).weekday.push(arrived.hour);
      slot(stays, tower, () => ({ weekday: [], weekend: [] })).weekday.push(minutes);
    } else {
      const saturday = arrived.day - (arrived.weekday - 5);
      if (weekends.has(saturday)) {
        slot(weekendDays, tower, () => new Set()).add(arrived.day);
        slot(hours, tower, () => ({ weekday: [], weekend: [] })).weekend.push(arrived.hour);
        slot(stays, tower, () => ({ weekday: [], weekend: [] })).weekend.push(minutes);
      }
    }
  }

  const result: Record<string, Stats> = {};
  for (const [tower, minutes] of Object.entries(total)) {
    const wkDays = [...(weekendDays[tower] ?? [])];
    result[tower] = {
      total: minutes,
      weekdayDays: weekdayDays[tower]?.size ?? 0,
      weekendDays: wkDays.length,
      weekendWeekends: new Set(wkDays.map((d) => d - (weekdayOf(d) - 5))).size,
      weekday: { hour: medianLow(hours[tower]?.weekday ?? []), minutes: medianLow(stays[tower]?.weekday ?? []) },
      weekend: { hour: medianLow(hours[tower]?.weekend ?? []), minutes: medianLow(stays[tower]?.weekend ?? []) },
    };
  }
  return result;
}

function duration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours} h ${rest} min`;
  return hours ? `${hours} h` : `${rest} min`;
}

const near = (sites: Site[]) => `near ${sites.slice(0, MAX_SITES_NAMED).map((s) => s.name).join(" and ") || "no known site"}`;

function usual(stats: Stats, part: "weekday" | "weekend") {
  const { hour, minutes } = stats[part];
  return minutes == null || hour == null ? "" : `, usually about ${duration(minutes)} from about ${String(hour).padStart(2, "0")}:00`;
}

function routinesFor(trail: Trail, nearby: Record<string, Site[]>, position: Record<string, [number, number]>): Routine[] {
  const stats = towerStats(trail);
  const towers = Object.keys(stats).sort();
  if (!towers.length) return [];
  const weekends = completedWeekends(trail.window_start, trail.window_min).length;
  const everything = towers.reduce((sum, t) => sum + stats[t].total, 0);
  const home = towers.reduce((best, t) => (stats[t].total > stats[best].total ? t : best), towers[0]);
  const names = (t: string) => (nearby[t] ?? []).slice(0, MAX_SITES_NAMED).map((s) => s.name);
  const place = (tower: string) => ({ tower, lat: position[tower][0], lng: position[tower][1], sites: names(tower) });
  const found: Routine[] = [];

  if (stats[home].total >= HOME_SHARE * everything) {
    found.push({ ...place(home), kind: "home", days: null, of: null, sentence: `Most of the time: probably home, ${near(nearby[home] ?? [])}` });
  }
  for (const tower of towers) {
    if (tower === home) continue;
    const s = stats[tower];
    const sites = nearby[tower] ?? [];
    if (s.weekendDays >= MIN_WEEKEND_DAYS && s.weekendWeekends >= MIN_WEEKENDS) {
      found.push({
        ...place(tower),
        kind: "weekend",
        days: s.weekendWeekends,
        of: weekends,
        sentence: `Weekends: ${near(sites)} on ${s.weekendWeekends} of ${weekends} weekends${usual(s, "weekend")}`,
      });
    }
    if (s.weekdayDays >= MIN_WEEKDAYS) {
      found.push({
        ...place(tower),
        kind: "weekday",
        days: s.weekdayDays,
        of: null,
        sentence: `Weekdays: ${near(sites)} on ${s.weekdayDays} weekdays${usual(s, "weekday")}`,
      });
    }
  }
  return found;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(a));
}

/** The routine lines for one subscriber, with the known sites near each place named (cell level, synthetic). */
export async function subscriberRoutines(msisdnHash: string, windowMin = DEFAULT_WINDOW_MIN) {
  const trail = dataOf(await callMenaraTool("user_get_trail", { msisdn_hash: msisdnHash, window_min: windowMin })) as unknown as Trail;
  const position: Record<string, [number, number]> = {};
  for (const seg of trail.segments ?? []) position[seg.enodeb_name] = [seg.cell_lat, seg.cell_lng];

  const nearby: Record<string, Site[]> = {};
  await Promise.all(
    Object.entries(position).map(async ([tower, [lat, lng]]) => {
      const dLat = NEARBY_KM / 111;
      const dLng = NEARBY_KM / (111 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
      const found = ((dataOf(
        await callMenaraTool("sites_list_in_bbox", {
          min_lat: lat - dLat,
          min_lng: lng - dLng,
          max_lat: lat + dLat,
          max_lng: lng + dLng,
          limit: 50,
        }).catch(() => ({})),
      ).sites as { name: string; kind: string; lat: number; lng: number }[] | undefined) ?? [])
        .map((s) => ({ ...s, distance_km: Math.round(haversineKm(lat, lng, s.lat, s.lng) * 100) / 100 }))
        .filter((s) => s.distance_km <= NEARBY_KM)
        .sort((a, b) => a.distance_km - b.distance_km)
        .slice(0, MAX_NEARBY);
      nearby[tower] = found;
    }),
  );
  return { window_start: trail.window_start, window_min: trail.window_min, routines: routinesFor(trail, nearby, position) };
}