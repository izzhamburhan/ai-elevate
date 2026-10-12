"use client";

import { areaContains, haversineKm, sitesInArea, type AreaSite, type MapArea } from "./workspace";

/**
 * What the selected map area holds, straight from the existing MCP tools (all synthetic data). Each block keeps its
 * own source and kind, so recorded network facts, weather, commercial data and ML predictions are never mixed.
 */

export type Sourced<T> = { ok: true; value: T; tool: string; server: string } | { ok: false; error: string; tool: string; server: string };
export type SiteRisk = AreaSite & { risk_score: number; risk_level: string; cluster?: string };
export type CongestedCell = { cell_name: string; site_id: string; severity: string; congested_hours: number; peak_prb_pct: number };
export type DemandSignal = {
  area_id: string; name: string; cluster: string; lat: number; lng: number; signal: string; secondary_flags: string[];
  investigation_priority: number; demand_index: number; capacity_pressure: number; reliability_risk: number;
  recommended_investigation: string; evidence: string[]; confidence: string;
  indicators: { footfall_p50: number; footfall_uplift_pct: number | null; event_attendance_in_reach: number };
  window: { day_myt: string };
};
export type AreaInsights = {
  sites: Sourced<{ sites: SiteRisk[]; scored: number; horizon: string }>;
  network: Sourced<{ summary: string; cells: CongestedCell[]; total: number }>;
  weather: Sourced<{ station: string; distanceKm: number; rain24h: number; intensity: string; at: string }>;
  forecast: Sourced<{ summary: string; hot: number; cells: number; worst: { cell_name: string; peak: number; risk: string } | null; window: string;
                      all: { cell_name: string; site_id: string; risk: string; forecast_peak_prb_pct: number }[] }>;
  demand: Sourced<{ signal: DemandSignal; inside: boolean; distanceKm: number }>;
};

async function call(server: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal) {
  // run_all starts every server with --search, so its tools sit behind <server>_call_tool
  const direct = server === "weather";
  const response = await fetch("/api/menara/call", {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal,
    body: JSON.stringify(direct ? { tool, args } : { tool: `${server}_call_tool`, args: { name: tool, arguments: args } }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `${tool} failed`);
  return payload as { data?: Record<string, unknown>; synthetic?: boolean };
}

async function sourced<T>(server: string, tool: string, run: () => Promise<T>): Promise<Sourced<T>> {
  try {
    return { ok: true, value: await run(), tool, server };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return { ok: false, error: /unknown tool|has no tool/i.test(text) ? `${tool} is not available on the running ${server} server (restart it on the latest main).` : text, tool, server };
  }
}

const searchRadius = (area: MapArea) => Math.min(100, Math.max(0.5, Math.ceil(area.radiusKm * 10) / 10));

export async function fetchAreaInsights(area: MapArea, signal?: AbortSignal): Promise<AreaInsights> {
  const near = { lat: area.center.lat, lng: area.center.lng, radius_km: searchRadius(area) };
  const [sites, network, weather, forecast, demand] = await Promise.all([
    sourced("mlpredict", "predict_site_failure_risk", async () => {
      const d = (await call("mlpredict", "predict_site_failure_risk", { ...near, limit: 100 }, signal)).data ?? {};
      const rows = sitesInArea(area, (d.sites as SiteRisk[]) ?? []);
      const horizon = (d.horizon as { start?: { myt?: string } } | undefined)?.start?.myt ?? "";
      return { sites: rows.sort((a, b) => b.risk_score - a.risk_score), scored: rows.length, horizon };
    }),
    sourced("netintel", "analyze_network_congestion", async () => {
      const d = (await call("netintel", "analyze_network_congestion", { ...near, days: 7 }, signal)).data ?? {};
      const all = (d.cells as CongestedCell[]) ?? [];
      return { summary: String(d.summary ?? ""), cells: all, total: all.length };
    }),
    sourced("weather", "weather_get_rainfall", async () => {
      const d = (await call("weather", "weather_get_rainfall", { lat: area.center.lat, lng: area.center.lng }, signal)).data ?? {};
      const station = d.station as { name: string; distance_km: number };
      const points = (d.points as { at: string }[]) ?? [];
      return { station: station.name, distanceKm: station.distance_km, rain24h: Number(d.rain_24h_mm), intensity: String(d.intensity), at: points.at(-1)?.at ?? "" };
    }),
    sourced("mlpredict", "forecast_network_congestion", async () => {
      const d = (await call("mlpredict", "forecast_network_congestion", { ...near, limit: 100 }, signal)).data ?? {};
      const cells = ((d.cells as { cell_name: string; site_id: string; risk: string; forecast_peak_prb_pct: number }[]) ?? []);
      const w = d.window as { start?: { myt?: string }; end?: { myt?: string } } | undefined;
      return { summary: String(d.summary ?? ""), hot: cells.filter((c) => c.risk === "CRITICAL" || c.risk === "HIGH").length, cells: cells.length, all: cells,
               worst: cells[0] ? { cell_name: cells[0].cell_name, peak: cells[0].forecast_peak_prb_pct, risk: cells[0].risk } : null,
               window: `${w?.start?.myt?.slice(0, 16).replace("T", " ") ?? ""} → ${w?.end?.myt?.slice(0, 16).replace("T", " ") ?? ""} MYT` };
    }),
    sourced("mlpredict", "get_business_demand_signals", async () => {
      const d = (await call("mlpredict", "get_business_demand_signals", { limit: 50 }, signal)).data ?? {};
      const signals = (d.signals as DemandSignal[]) ?? [];
      const inside = signals.filter((s) => areaContains(area, s.lat, s.lng));
      const pick = inside[0] ?? [...signals].sort((a, b) => haversineKm(area.center, a) - haversineKm(area.center, b))[0];
      if (!pick) throw new Error("No demand signals returned.");
      return { signal: pick, inside: inside.length > 0, distanceKm: Math.round(haversineKm(area.center, pick) * 10) / 10 };
    }),
  ]);
  // the tools search the enclosing circle; keep only cells on the area's own sites (polygons and rectangles)
  if (sites.ok) {
    const inside = new Set(sites.value.sites.map((s) => s.site_id));
    if (network.ok) network.value = { ...network.value, cells: network.value.cells.filter((c) => inside.has(c.site_id)) };
    if (network.ok) network.value.total = network.value.cells.length;
    if (forecast.ok) {
      const kept = forecast.value.all.filter((c) => inside.has(c.site_id));
      forecast.value = { ...forecast.value, all: kept, cells: kept.length, hot: kept.filter((c) => c.risk === "CRITICAL" || c.risk === "HIGH").length,
                         worst: kept[0] ? { cell_name: kept[0].cell_name, peak: kept[0].forecast_peak_prb_pct, risk: kept[0].risk } : null };
    }
  }
  return { sites, network, weather, forecast, demand };
}

/** Coordinates of NetOps sites by ID, from the synthetic site inventory (read-only MLPredict call), for evidence pins. */
export async function siteLocations(siteIds: string[], signal?: AbortSignal): Promise<Map<string, { lat: number; lng: number }>> {
  const ids = [...new Set(siteIds.map((s) => s.toUpperCase()))].slice(0, 50);
  if (!ids.length) return new Map();
  const d = (await call("mlpredict", "predict_site_failure_risk", { site_ids: ids, limit: 50 }, signal)).data ?? {};
  return new Map(((d.sites as AreaSite[]) ?? []).map((s) => [s.site_id.toUpperCase(), { lat: s.lat, lng: s.lng }]));
}
