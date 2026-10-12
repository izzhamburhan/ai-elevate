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

/** How a tower status reads on screen: the data keeps the tools' `DOWN`, people see `OUTAGE`. */
export function towerStatusLabel(status: string): string {
  return status === "DOWN" ? "OUTAGE" : status;
}

/** `#rrggbb` as the [r, g, b] kepler layer configs take. */
export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Agent investigation findings with no status of their own (matches the Hermes evidence layer). */
export const FINDING_COLOR = "#8b5cf6";

/** Map colour of an investigation site's tone: status hues as the tower layers draw them. */
export const SITE_TONE_COLOR = {
  red: TOWER_STATUS_COLOR.DOWN,
  amber: TOWER_STATUS_COLOR.DEGRADED,
  green: TOWER_STATUS_COLOR.UP,
  blue: "#6aa6ff",
  neutral: FINDING_COLOR,
} as const;
