/**
 * What the map legend lists: every visible layer in the colour it is drawn with, grouped as network,
 * Weather ML, investigation and other, with the weather forecast's valid window read from its rows.
 * Pure (no imports), so `node --test` can check it against fake kepler state.
 */

export type LegendLayer = { id: string; config: { dataId: string; label?: string; isVisible: boolean; color?: number[] } };
export type LegendDataset = {
  fields: { name: string }[];
  dataContainer: { numRows(): number; valueAt(row: number, column: number): unknown };
};
export type LegendSource = {
  visState: { layers: LegendLayer[]; layerOrder: string[]; datasets: Record<string, LegendDataset | undefined> };
};

export type LegendEntry = { id: string; label: string; color: string; ring?: boolean };
export type LegendGroup = {
  id: "network" | "weather" | "investigation" | "other";
  title: string;
  entries: LegendEntry[];
  /** Weather only: the forecast's valid window and mode, from the first row. */
  window?: { start: string; end: string };
  mode?: "Historical replay" | "Live · experimental";
};

const TITLES: Record<LegendGroup["id"], string> = {
  network: "Network",
  weather: "Weather ML",
  investigation: "Investigation",
  other: "Other layers",
};

/** Entries per group before the rest are left to the Layers tab. */
const MAX_ENTRIES = 6;

const groupOf = (dataId: string): LegendGroup["id"] =>
  dataId.startsWith("towers_") ? "network" : dataId.startsWith("weather-ml-") ? "weather" : dataId.startsWith("hermes-") ? "investigation" : "other";

const rgb = (color?: number[]) => (color && color.length >= 3 ? `rgb(${color[0]} ${color[1]} ${color[2]})` : "var(--muted-foreground)");

function firstValue(source: LegendSource, dataId: string, field: string) {
  const dataset = source.visState.datasets[dataId];
  const column = dataset?.fields.findIndex((f) => f.name === field) ?? -1;
  if (!dataset || column < 0 || !dataset.dataContainer.numRows()) return undefined;
  const value = dataset.dataContainer.valueAt(0, column);
  return typeof value === "string" ? value : undefined;
}

/** Visible layers, grouped by what they show, top of the map first. Hidden layers are left out. */
export function legendGroups(source: LegendSource): LegendGroup[] {
  const order = source.visState.layerOrder;
  const layers = source.visState.layers
    .filter((l) => l.config.isVisible)
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const groups = new Map<LegendGroup["id"], LegendGroup>();
  for (const layer of layers) {
    const id = groupOf(layer.config.dataId);
    const group = groups.get(id) ?? { id, title: TITLES[id], entries: [] };
    groups.set(id, group);
    if (group.entries.length >= MAX_ENTRIES) continue;
    group.entries.push({ id: layer.id, label: layer.config.label ?? layer.id, color: rgb(layer.config.color), ring: layer.config.dataId === "towers_down" });
  }

  const weather = groups.get("weather");
  if (weather) {
    const dataId = layers.find((l) => groupOf(l.config.dataId) === "weather")!.config.dataId;
    const start = firstValue(source, dataId, "forecast_start");
    const end = firstValue(source, dataId, "forecast_end");
    if (start && end) weather.window = { start, end };
    const mode = firstValue(source, dataId, "mode");
    weather.mode = mode === "replay" ? "Historical replay" : mode === "live" ? "Live · experimental" : undefined;
  }
  return (["network", "weather", "investigation", "other"] as const).flatMap((id) => (groups.get(id) ? [groups.get(id)!] : []));
}

export const sameLegend = (a: LegendGroup[], b: LegendGroup[]) => JSON.stringify(a) === JSON.stringify(b);
