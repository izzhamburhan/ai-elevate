/**
 * Colors of things drawn on the map, shared by every layer, halo and legend. They follow the Menara
 * command center's map (menara-command-tower): bright on the dark basemap, still readable on the
 * light one. kepler needs literal hex values here, not CSS variables.
 */
export const TOWER_STATUS_COLOR = {
  UP: "#2ee59d",
  DEGRADED: "#ffc83d",
  DOWN: "#ff4d6d",
  UNKNOWN: "#8a93a8",
} as const;

/** `#rrggbb` as the [r, g, b] kepler layer configs take. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
