import { MenaraCallError } from "@/lib/menara/call";
import { circleAround, resolvePlace } from "@/lib/menara/place";

/**
 * Resolves a place for the Map & area card. A name alone gives the real boundary when NetOps knows the area;
 * a centre (lat, lng) with a radius gives a circle.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { name?: string; lat?: number; lng?: number; radius_km?: number };
  try {
    if (typeof body.lat === "number" && typeof body.lng === "number") {
      return Response.json(circleAround(body.name ?? "Selected area", body.lat, body.lng, body.radius_km ?? 5));
    }
    if (!body.name) return Response.json({ error: "Give a place name, or lat and lng." }, { status: 400 });
    const place = await resolvePlace(body.name);
    // an explicit radius means "around the centre of this place", not the boundary
    if (typeof body.radius_km === "number") return Response.json(circleAround(place.name, place.center.lat, place.center.lng, body.radius_km));
    return Response.json(place);
  } catch (error) {
    const status = error instanceof MenaraCallError ? 404 : 500;
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}