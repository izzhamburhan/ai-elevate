"use client";

import { useEffect, useState } from "react";
import { useStore } from "react-redux";
import { create } from "zustand";
import { CloudRain, Layers, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { makeKeplerStore } from "../kepler-store";
import {
  EXPOSURE_STYLES, WEATHER_HORIZONS, formatWeatherTime, weatherForecastSchema, weatherStatusSchema,
  type WeatherForecast, type WeatherHorizon, type WeatherStatus,
} from "@/lib/weather/contracts";
import { hasWeatherOverlay, loadWeatherOverlay, setWeatherOverlayVisible } from "@/lib/weather/map-overlay";
import { WEATHER_DEMO_MODE } from "@/lib/weather/demo";

type PanelState = { region: string; horizon: WeatherHorizon; forecast: WeatherForecast | null };
// Keep the selected forecast when users switch between Assistant, Weather and Layers tabs.
const useWeatherSelection = create<PanelState>(() => ({ region: "all", horizon: 6, forecast: null }));

async function requestWeather(search: URLSearchParams, signal?: AbortSignal) {
  const response = await fetch(`/api/weather?${search}`, { cache: "no-store", signal });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Weather ML is unavailable.");
  return payload;
}

export function WeatherPanel({ uiStateActions }: { uiStateActions?: { toggleSidePanel: (id: string) => void } }) {
  const store = useStore() as ReturnType<typeof makeKeplerStore>;
  const { region, horizon, forecast } = useWeatherSelection();
  const [status, setStatus] = useState<WeatherStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(() => { try { return hasWeatherOverlay(store); } catch { return false; } });

  async function checkStatus(signal?: AbortSignal) {
    try { setStatus(weatherStatusSchema.parse(await requestWeather(new URLSearchParams({ action: "status" }), signal))); }
    catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Weather status unavailable."); }
    finally { if (!signal?.aborted) setStatusLoading(false); }
  }

  useEffect(() => {
    const controller = new AbortController();
    requestWeather(new URLSearchParams({ action: "status" }), controller.signal)
      .then((data) => setStatus(weatherStatusSchema.parse(data)))
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Weather status unavailable."); })
      .finally(() => { if (!controller.signal.aborted) setStatusLoading(false); });
    return () => controller.abort();
  }, []);

  async function loadForecast() {
    setLoading(true); setError(null);
    try {
      const data = weatherForecastSchema.parse(await requestWeather(new URLSearchParams({ action: "forecast", region, horizon_hours: String(horizon) })));
      if (!data.geojson.features.length) throw new Error("No cached weather geography is available for this selection.");
      await loadWeatherOverlay(store, data);
      useWeatherSelection.setState({ forecast: data });
      setVisible(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Forecast unavailable. No values were generated.");
    } finally { setLoading(false); }
  }

  const stations = forecast?.geojson.features.filter((feature) => feature.properties.kind === "weather_location") ?? [];
  const sites = forecast?.geojson.features.filter((feature) => feature.properties.kind === "telecom_site") ?? [];
  const valid = forecast?.geojson.features[0]?.properties;

  return (
    <section aria-label="Weather intelligence" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-1 font-sans text-foreground [&>*]:shrink-0">
      <div className="flex items-center gap-2"><CloudRain className="size-5 text-sky-500" /><h2 className="text-base font-semibold">Weather intelligence</h2></div>
      <p className="text-xs leading-relaxed text-muted-foreground">Local Chronos ML predictions. Experimental research output, never an official meteorological forecast.</p>
      {WEATHER_DEMO_MODE ? <p className="text-xs leading-relaxed text-muted-foreground">Cached pitch mode · local geographic context from <a href="https://www.naturalearthdata.com/about/terms-of-use/" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Natural Earth (public domain)</a>. Coarse outlines are for orientation.</p> : null}
      <div className="rounded-lg border bg-muted/30 p-3 text-xs">
        <div className="flex items-center justify-between"><p className="font-medium">{statusLoading ? "Checking local model…" : status?.ready ? "Local model ready" : "Local model unavailable"}</p><button type="button" aria-label="Refresh weather readiness" onClick={() => { setStatusLoading(true); setError(null); void checkStatus(); }} disabled={statusLoading || loading} className="rounded p-1 hover:bg-accent disabled:opacity-50"><RefreshCw className={`size-3.5 ${statusLoading ? "animate-spin" : ""}`} /></button></div>
        {status ? <p className="mt-1 text-muted-foreground">{status.mode === "replay" ? "Historical replay · forecasts from a past cutoff" : "Live inference · requires fresh observations"}</p> : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium">Cached location
          <select aria-label="Weather region" value={region} onChange={(event) => useWeatherSelection.setState({ region: event.target.value })} disabled={loading} className="h-9 min-w-0 rounded-md border bg-background px-2 text-xs">
            <option value="all">All cached locations</option>
            {(status?.locations ?? []).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">Forecast horizon
          <select aria-label="Weather horizon" value={horizon} onChange={(event) => useWeatherSelection.setState({ horizon: Number(event.target.value) as WeatherHorizon })} disabled={loading} className="h-9 rounded-md border bg-background px-2 text-xs">
            {WEATHER_HORIZONS.map((hours) => <option key={hours} value={hours}>{hours} hours</option>)}
          </select>
        </label>
      </div>
      <Button onClick={loadForecast} disabled={loading || statusLoading || !status?.ready} className="w-full">
        {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}{loading ? "Running local inference…" : "Generate weather overlay"}
      </Button>
      {error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{error}</p> : null}
      <div className="flex items-center justify-between gap-2 text-xs">
        <label htmlFor="weather-overlay-visible" className="flex items-center gap-2"><Switch id="weather-overlay-visible" checked={visible} disabled={!forecast || loading} onCheckedChange={(checked) => { setWeatherOverlayVisible(store, checked); setVisible(checked); }} />Weather overlay</label>
        <Button size="sm" variant="ghost" onClick={() => uiStateActions?.toggleSidePanel("layer")}><Layers />Network layers</Button>
      </div>
      {forecast && valid ? <>
        <div className="rounded-lg border p-3 text-xs leading-relaxed">
          <span className="rounded bg-sky-500/10 px-2 py-1 font-semibold text-sky-600 dark:text-sky-400">{forecast.mode === "replay" ? "HISTORICAL REPLAY" : "LIVE · EXPERIMENTAL"}</span>
          <p className="mt-3 font-medium">{formatWeatherTime(valid.forecast_start)} – {formatWeatherTime(valid.forecast_end)} MYT</p>
          <p className="mt-1 text-muted-foreground">Observations through {formatWeatherTime(forecast.dataset.last_observation_timestamp)} MYT</p>
          <p className="text-muted-foreground">Generated {formatWeatherTime(forecast.generated_at)} MYT · {sites.length} network sites</p>
        </div>
        {stations.length ? <div className="overflow-hidden rounded-lg border"><table className="w-full text-xs"><caption className="px-3 py-2 text-left font-medium">Forecast medians for valid period</caption><thead className="bg-muted/50 text-muted-foreground"><tr><th className="p-2 text-left">Location</th><th className="p-2 text-right">Total mm</th><th className="p-2 text-right">Mean °C</th></tr></thead><tbody>{stations.map((feature, index) => <tr key={`${feature.properties.location_name}-${index}`} className="border-t"><td className="p-2">{feature.properties.location_name}</td><td className="p-2 text-right tabular-nums">{feature.properties.rainfall_mm.toFixed(2)}</td><td className="p-2 text-right tabular-nums">{feature.properties.temperature_c.toFixed(1)}</td></tr>)}</tbody></table></div> : null}
        <p className="text-xs leading-relaxed text-muted-foreground">ML predictions derived from <a href="https://open-meteo.com/en/docs/historical-weather-api" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Open-Meteo ERA5 data</a>, licensed under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">CC BY 4.0</a>. Forecast values are model transformations of that data.</p>
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer font-medium text-foreground">Model & data attribution</summary><div className="mt-2 space-y-1 break-words"><p><a href="https://huggingface.co/autogluon/chronos-2-small" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{forecast.model.id}</a> · {forecast.model.framework} · {forecast.model.license}</p><p>Revision: {forecast.model.revision}</p><p>{forecast.dataset.attribution} · {forecast.dataset.license}</p><p>Source: {forecast.dataset.source}</p><p>Acquired {formatWeatherTime(forecast.dataset.acquired_at)} MYT</p></div></details>
      </> : null}
      <div className="rounded-lg border p-3 text-xs">
        <p className="mb-2 font-medium">Weather exposure</p>
        <div className="flex gap-3">{Object.entries(EXPOSURE_STYLES).map(([key, style]) => <span key={key} className="flex items-center gap-1"><span className="size-2.5 rounded-full" style={{ background: style.color }} />{style.label}</span>)}</div>
        <p className="mt-2 leading-relaxed text-muted-foreground">Colors apply transparent rainfall threshold rules. Large circles: weather locations. Small points: network sites. Exposure does not predict actual outages.</p>
        {sites.some((feature) => feature.properties.synthetic_network_data) ? <p className="mt-2 font-medium">Telecom site data is synthetic.</p> : null}
        {forecast?.legend ? <p className="mt-2 text-muted-foreground">Peak hourly median: low &lt; {forecast.legend.thresholds.elevated} {forecast.legend.thresholds.units}; elevated ≥ {forecast.legend.thresholds.elevated}; high ≥ {forecast.legend.thresholds.high}.</p> : null}
      </div>
      {[...new Set([...(status?.warnings ?? []), ...(forecast?.warnings ?? [])])].map((warning) => <p key={warning} className="rounded-md bg-amber-500/10 p-2 text-xs leading-relaxed text-amber-800 dark:text-amber-300">{warning}</p>)}
    </section>
  );
}
