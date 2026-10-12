import { parseWeatherQuery, weatherBackendUrl, weatherForecastSchema, weatherStatusSchema } from "@/lib/weather/contracts";

export const maxDuration = 90;

/** Read-only proxy to one operator-configured service. It never accepts browser-supplied URLs. */
export async function GET(request: Request) {
  const query = parseWeatherQuery(new URL(request.url).searchParams);
  const headers = { "Cache-Control": "no-store" };
  if (!query) {
    return Response.json({ error: "Choose status, metrics, or a forecast with a valid region and 6, 12, or 24 hour horizon." }, { status: 400, headers });
  }

  try {
    const url = weatherBackendUrl(process.env.WEATHER_ML_HTTP_URL ?? "http://127.0.0.1:8002", query);
    const response = await fetch(url, {
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(query.action === "forecast" ? 80_000 : 10_000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return Response.json({ error: "Weather ML is unavailable. Check model/data readiness and the replay/live configuration." }, { status: response.status === 400 || response.status === 422 ? 400 : 503, headers });
    }
    const data: unknown = await response.json();
    if (query.action === "forecast") {
      const parsed = weatherForecastSchema.safeParse(data);
      if (!parsed.success) {
        console.warn("[weather-ml] upstream forecast did not match its validated contract");
        return Response.json({ error: "Weather ML returned an invalid forecast. No forecast was added to the map." }, { status: 502, headers });
      }
      return Response.json(parsed.data, { headers });
    }
    if (query.action === "status") {
      const parsed = weatherStatusSchema.safeParse(data);
      if (!parsed.success) return Response.json({ error: "Weather ML returned an invalid readiness status." }, { status: 502, headers });
      return Response.json(parsed.data, { headers });
    }
    return Response.json(data, { headers });
  } catch {
    // Avoid leaking backend URLs, model-cache paths, or other operator configuration.
    return Response.json({ error: "Could not reach Weather ML. Start its container, check readiness, then retry." }, { status: 503, headers });
  }
}
