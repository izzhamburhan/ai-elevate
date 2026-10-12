import { z } from "zod";

export const WEATHER_HORIZONS = [6, 12, 24] as const;
export type WeatherHorizon = (typeof WEATHER_HORIZONS)[number];

export const EXPOSURE_STYLES = {
  low: { label: "Low", color: "#22c55e" },
  elevated: { label: "Elevated", color: "#f59e0b" },
  high: { label: "High", color: "#ef4444" },
} as const;
export type WeatherExposure = keyof typeof EXPOSURE_STYLES;

const timestamp = z.string().datetime({ offset: true });
const forecastMode = z.enum(["replay", "live"]);

export const weatherStatusSchema = z.object({
  ready: z.boolean(), mode: forecastMode, model_loaded: z.boolean(),
  locations: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()),
  warnings: z.array(z.string()),
}).passthrough();
export type WeatherStatus = z.infer<typeof weatherStatusSchema>;

export const weatherFeatureSchema = z.object({
  type: z.literal("Feature"),
  geometry: z.object({
    type: z.literal("Point"),
    // GeoJSON uses longitude, latitude in WGS84, unlike tool argument order.
    coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  }),
  properties: z.object({
    kind: z.enum(["weather_location", "telecom_site"]),
    location_name: z.string(),
    rainfall_mm: z.number().nonnegative(),
    peak_rainfall_mm: z.number().nonnegative(),
    temperature_c: z.number(),
    exposure: z.enum(["low", "elevated", "high"]),
    forecast_start: timestamp,
    forecast_end: timestamp,
    mode: forecastMode,
    synthetic_network_data: z.boolean(),
    source: z.string(),
    model_id: z.string(),
    units: z.literal("mm"),
    site_id: z.string().optional(),
  }).passthrough(),
}).passthrough();

export const weatherForecastSchema = z.object({
  geojson: z.object({ type: z.literal("FeatureCollection"), features: z.array(weatherFeatureSchema).max(25_000) }),
  mode: forecastMode,
  research_only: z.literal(true),
  model: z.object({ id: z.string(), revision: z.string(), framework: z.string(), license: z.string() }).passthrough(),
  dataset: z.object({
    source: z.string(),
    last_observation_timestamp: timestamp,
    acquired_at: timestamp,
    license: z.string(),
    attribution: z.string(),
  }).passthrough(),
  generated_at: timestamp,
  warnings: z.array(z.string()),
  legend: z.object({
    thresholds: z.object({
      statistic: z.string(), units: z.string(), elevated: z.number(), high: z.number(),
    }).passthrough(),
  }).passthrough().optional(),
}).passthrough().superRefine((forecast, context) => {
  for (const [index, feature] of forecast.geojson.features.entries()) {
    const properties = feature.properties;
    if (Date.parse(properties.forecast_start) <= Date.parse(forecast.dataset.last_observation_timestamp) || Date.parse(properties.forecast_end) < Date.parse(properties.forecast_start)) {
      context.addIssue({ code: "custom", path: ["geojson", "features", index], message: "Forecast valid times must follow the observation cutoff." });
    }
    if (properties.mode !== forecast.mode || properties.model_id !== forecast.model.id) {
      context.addIssue({ code: "custom", path: ["geojson", "features", index], message: "Feature and envelope provenance must agree." });
    }
  }
});
export type WeatherForecast = z.infer<typeof weatherForecastSchema>;
export type WeatherFeature = z.infer<typeof weatherFeatureSchema>;

/** Reject unsupported horizons and malformed regions before contacting the fixed backend. */
export function parseWeatherQuery(search: URLSearchParams) {
  const action = search.get("action") ?? "status";
  if (action !== "status" && action !== "metrics" && action !== "forecast") return null;
  if (action !== "forecast") return { action } as const;
  const region = search.get("region") ?? "all";
  const horizon = Number(search.get("horizon_hours") ?? "6");
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(region) || !WEATHER_HORIZONS.includes(horizon as WeatherHorizon)) return null;
  return { action, region, horizon_hours: horizon as WeatherHorizon } as const;
}

/** A server-controlled origin only; browser query parameters can never choose a host. */
export function weatherBackendUrl(base: string, query: NonNullable<ReturnType<typeof parseWeatherQuery>>) {
  const url = new URL(base);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid weather service configuration");
  url.pathname = query.action === "forecast" ? "/api/forecast-geojson" : `/api/${query.action}`;
  url.search = "";
  url.hash = "";
  if (query.action === "forecast") {
    url.searchParams.set("region", query.region);
    url.searchParams.set("horizon_hours", String(query.horizon_hours));
  }
  return url;
}

export function weatherRowsByExposure(forecast: WeatherForecast, exposure: WeatherExposure) {
  return forecast.geojson.features.filter((feature) => feature.properties.exposure === exposure).map((feature) => ({
    ...feature.properties,
    longitude: feature.geometry.coordinates[0],
    latitude: feature.geometry.coordinates[1],
    // Sites are compact points; larger circles represent weather-data locations.
    marker_radius: feature.properties.kind === "telecom_site" ? 5 : 14,
  }));
}

export function formatWeatherTime(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}
