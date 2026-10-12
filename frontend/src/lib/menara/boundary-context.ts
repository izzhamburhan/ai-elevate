/**
 * A user-drawn boundary on the map (polygon, rectangle, or circle), written up as chat context.
 * It rides with the next message as a file attachment with a custom media type (text/x-elevate-boundary),
 * rendering as a chip in the composer and in the sent message.
 */

export const BOUNDARY_MEDIA_TYPE = "text/x-elevate-boundary";

export type DrawnFeature = {
  id?: string | number;
  type?: string;
  geometry?: {
    type: string;
    coordinates?: unknown;
  } | null;
  properties?: {
    shape?: string;
    isClosed?: boolean;
    [key: string]: unknown;
  } | null;
};

export type BoundaryMetrics = {
  shape: string;
  vertexCount: number;
  areaKm2: number | null;
  center: { lat: number; lng: number } | null;
  bbox: [number, number, number, number] | null;
  rings: number[][][];
};

/** Approximate area of a ring in square kilometers using mean latitude scaling. Ring points are [lng, lat]. */
export function ringAreaKm2(ring: number[][]): number {
  if (!ring || ring.length < 3) return 0;
  let sumLat = 0;
  for (const pt of ring) {
    sumLat += pt[1];
  }
  const meanLatRad = ((sumLat / ring.length) * Math.PI) / 180;
  const kmPerDegLat = 111.0;
  const kmPerDegLng = 111.0 * Math.cos(meanLatRad);

  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0] * kmPerDegLng;
    const yi = ring[i][1] * kmPerDegLat;
    const xj = ring[j][0] * kmPerDegLng;
    const yj = ring[j][1] * kmPerDegLat;
    area += xj * yi - xi * yj;
  }
  return Math.abs(area) / 2;
}

export function extractFeatureMetrics(feature: DrawnFeature): BoundaryMetrics {
  const shape =
    feature.properties?.shape ??
    (feature.geometry?.type === "Polygon"
      ? "Polygon"
      : feature.geometry?.type === "LineString"
        ? "Line"
        : feature.geometry?.type === "Point"
          ? "Point"
          : "Shape");

  let rings: number[][][] = [];
  const geom = feature.geometry;

  if (geom?.type === "Polygon" && Array.isArray(geom.coordinates)) {
    rings = geom.coordinates as number[][][];
  } else if (geom?.type === "MultiPolygon" && Array.isArray(geom.coordinates)) {
    rings = (geom.coordinates as number[][][][]).map((poly) => poly[0]);
  }

  const allPoints = rings.flat();
  let vertexCount = 0;
  let areaKm2: number | null = null;
  let center: { lat: number; lng: number } | null = null;
  let bbox: [number, number, number, number] | null = null;

  if (rings.length > 0 && rings[0].length > 0) {
    const outer = rings[0];
    const isClosed =
      outer.length > 1 &&
      outer[0][0] === outer[outer.length - 1][0] &&
      outer[0][1] === outer[outer.length - 1][1];
    const uniquePoints = isClosed ? outer.slice(0, -1) : outer;
    vertexCount = uniquePoints.length;

    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity;

    for (const [lng, lat] of allPoints) {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }

    bbox = [minLng, minLat, maxLng, maxLat];
    center = {
      lat: (minLat + maxLat) / 2,
      lng: (minLng + maxLng) / 2,
    };
    areaKm2 = ringAreaKm2(outer);
  } else if (geom?.type === "Point" && Array.isArray(geom.coordinates)) {
    const [lng, lat] = geom.coordinates as [number, number];
    vertexCount = 1;
    center = { lat, lng };
    bbox = [lng, lat, lng, lat];
  }

  return { shape, vertexCount, areaKm2, center, bbox, rings };
}

export function formatBoundaryLabel(metrics: BoundaryMetrics): string {
  const parts: string[] = [metrics.shape];
  if (metrics.vertexCount > 0) {
    parts.push(`${metrics.vertexCount} vertices`);
  }
  if (metrics.areaKm2 != null && metrics.areaKm2 > 0) {
    parts.push(
      metrics.areaKm2 >= 100
        ? `~${Math.round(metrics.areaKm2)} km²`
        : `~${metrics.areaKm2.toFixed(1)} km²`,
    );
  }
  return parts.join(" · ");
}

/** The context block for a drawn boundary sent to the language model. */
export function boundaryContext(feature: DrawnFeature, customLabel?: string): string {
  const metrics = extractFeatureMetrics(feature);
  const label = customLabel || formatBoundaryLabel(metrics);

  const lines = [
    `Map context: User-drawn boundary on the map (${label}).`,
    `- Shape: ${metrics.shape}`,
  ];

  if (metrics.vertexCount > 0) {
    lines.push(`- Vertices: ${metrics.vertexCount}`);
  }
  if (metrics.areaKm2 != null && metrics.areaKm2 > 0) {
    lines.push(`- Approximate Area: ${metrics.areaKm2.toFixed(2)} km²`);
  }
  if (metrics.center) {
    lines.push(`- Centroid: ${metrics.center.lat.toFixed(5)}, ${metrics.center.lng.toFixed(5)}`);
  }
  if (metrics.bbox) {
    lines.push(
      `- Bounding Box [west, south, east, north]: [${metrics.bbox.map((v) => v.toFixed(5)).join(", ")}]`,
    );
  }

  if (feature.geometry) {
    lines.push(
      `- GeoJSON Geometry: ${JSON.stringify(feature.geometry)}`,
    );
  }

  lines.push(
    "- Instructions: When the user asks about towers, subscribers, outages, or conditions in this area, use these coordinates / centroid / bbox to filter or locate sites within this boundary.",
  );

  return lines.join("\n");
}

/** The composer attachment that carries a drawn boundary's context. */
export function boundaryAttachment(feature: DrawnFeature, customLabel?: string) {
  const metrics = extractFeatureMetrics(feature);
  const name = customLabel || formatBoundaryLabel(metrics);
  const text = boundaryContext(feature, name);
  const bytes = new TextEncoder().encode(text);
  const data = `data:${BOUNDARY_MEDIA_TYPE};base64,${btoa(String.fromCharCode(...bytes))}`;

  return {
    id: `boundary-${Date.now().toString(36)}`,
    type: "file",
    name,
    contentType: BOUNDARY_MEDIA_TYPE,
    content: [{ type: "file" as const, mimeType: BOUNDARY_MEDIA_TYPE, filename: name, data }],
  };
}

/** Decodes the context text inside a boundary attachment's data URL ("" when it isn't one). */
export function readBoundaryContext(dataUrl: string): string {
  const prefix = `data:${BOUNDARY_MEDIA_TYPE};base64,`;
  if (!dataUrl.startsWith(prefix)) return "";
  try {
    return new TextDecoder().decode(
      Uint8Array.from(atob(dataUrl.slice(prefix.length)), (c) => c.charCodeAt(0)),
    );
  } catch {
    return "";
  }
}
