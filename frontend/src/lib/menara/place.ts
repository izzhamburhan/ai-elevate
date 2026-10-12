import { callMcp, MenaraCallError, NETOPS_URL } from "./call";

/**
 * Turns a place name into something the map can draw: a real boundary from NetOps (state, district or mukim) or,
 * for a point of interest, a centre and a default radius. Server side only.
 */
export type ResolvedPlace = {
  name: string;
  level: "state" | "district" | "mukim" | "point";
  state: string | null;
  district: string | null;
  center: { lat: number; lng: number };
  /** Radius of a circle that covers the whole area (or the default for a point). */
  radius_km: number;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  /** Outer rings as [lng, lat] pairs; empty for a point. */
  rings: number[][][];
  source: "boundary" | "search" | "given";
};

const LEVEL_RANK: Record<string, number> = { district: 0, mukim: 1, state: 2 };
const POINT_RADIUS_KM = 3;
const MAX_RADIUS_KM = 50;

type Feature = { properties?: { level?: string; name?: string; state?: string; district?: string }; geometry?: { type: string; coordinates: unknown } };

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(a));
}

/** Outer rings of a Polygon or MultiPolygon. */
function ringsOf(geometry: Feature["geometry"]): number[][][] {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [(geometry.coordinates as number[][][])[0]];
  if (geometry.type === "MultiPolygon") return (geometry.coordinates as number[][][][]).map((polygon) => polygon[0]);
  return [];
}

function fromRings(name: string, level: ResolvedPlace["level"], state: string | null, district: string | null, rings: number[][][]): ResolvedPlace {
  const points = rings.flat();
  const lngs = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  const bbox: [number, number, number, number] = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
  const center = { lat: (bbox[1] + bbox[3]) / 2, lng: (bbox[0] + bbox[2]) / 2 };
  const reach = Math.max(
    ...[
      [bbox[1], bbox[0]],
      [bbox[1], bbox[2]],
      [bbox[3], bbox[0]],
      [bbox[3], bbox[2]],
    ].map(([lat, lng]) => haversineKm(center.lat, center.lng, lat, lng)),
  );
  return { name, level, state, district, center, radius_km: Math.min(MAX_RADIUS_KM, Math.max(1, Math.ceil(reach))), bbox, rings, source: "boundary" };
}

function point(name: string, lat: number, lng: number, state: string | null, radiusKm: number, source: ResolvedPlace["source"]): ResolvedPlace {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  return {
    name,
    level: "point",
    state,
    district: null,
    center: { lat, lng },
    radius_km: radiusKm,
    bbox: [lng - dLng, lat - dLat, lng + dLng, lat + dLat],
    rings: [],
    source,
  };
}

/** A circle around a given centre (the user or model gave coordinates and/or a radius). */
export function circleAround(name: string, lat: number, lng: number, radiusKm: number): ResolvedPlace {
  return point(name, lat, lng, null, Math.min(MAX_RADIUS_KM, Math.max(1, radiusKm)), "given");
}

/** Best match for a name: a boundary when NetOps knows the area, otherwise the first place found by keyword search. */
export async function resolvePlace(name: string): Promise<ResolvedPlace> {
  const query = name.trim();
  if (!query) throw new MenaraCallError("Give a place name.");

  const boundary = (await callMcp(NETOPS_URL, "NetOps", "get_admin_boundary", { name: query, include_geometry: true, detail: "low", limit: 10 }).catch(
    () => null,
  )) as { geojson?: { features?: Feature[] } } | null;
  const features = (boundary?.geojson?.features ?? []).filter((f) => ringsOf(f.geometry).length);
  if (features.length) {
    const q = query.toLowerCase();
    const rank = (f: Feature) => {
      const n = (f.properties?.name ?? "").toLowerCase();
      const match = n === q ? 0 : n.replace(/^bandar /, "") === q ? 1 : n.startsWith(q) ? 2 : 3;
      return match * 10 + (LEVEL_RANK[f.properties?.level ?? ""] ?? 5);
    };
    const best = [...features].sort((a, b) => rank(a) - rank(b))[0];
    const level = (best.properties?.level ?? "district") as ResolvedPlace["level"];
    return fromRings(best.properties?.name ?? query, level, best.properties?.state ?? null, best.properties?.district ?? null, ringsOf(best.geometry));
  }

  const found = (await callMcp(NETOPS_URL, "NetOps", "search_locations", { query, kind: "any", page_size: 1 }).catch(() => null)) as {
    items?: { name: string; lat: number; lng: number; state?: string | null }[];
  } | null;
  const first = found?.items?.[0];
  if (first && Number.isFinite(first.lat) && Number.isFinite(first.lng)) {
    return point(first.name, first.lat, first.lng, first.state ?? null, POINT_RADIUS_KM, "search");
  }
  throw new MenaraCallError(`I could not find "${query}". Try another spelling, or give its latitude and longitude.`);
}