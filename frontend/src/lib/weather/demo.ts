/** Opt-in pitch defaults. NEXT_PUBLIC values must be set before the frontend build. */
export const WEATHER_DEMO_MODE = process.env.NEXT_PUBLIC_WEATHER_DEMO_MODE === "1";

export function weatherDemoBasemap(theme: "light" | "dark", demoMode = WEATHER_DEMO_MODE) {
  // elevate-light / elevate-dark: the OSM basemaps in components/map/basemaps.ts
  return demoMode ? "no_map" : theme === "light" ? "elevate-light" : "elevate-dark";
}

export function weatherDemoChatModel(defaultModel: string, demoMode = WEATHER_DEMO_MODE) {
  return demoMode ? "local/gemma4" : defaultModel;
}

export function localModelLabel(label?: string) {
  return label?.trim() || "Gemma 4 (local)";
}
