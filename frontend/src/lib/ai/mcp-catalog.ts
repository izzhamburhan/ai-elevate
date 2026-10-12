import type { McpServerRequest } from "./mcp-config";

/**
 * MCP servers that ship with Elevate. They always appear in the connectors dialog (users can
 * switch them and their tools off, but not edit or remove them). Bundled into the browser, so
 * keep secrets out; URLs come from NEXT_PUBLIC_* env vars.
 */
export type BuiltinConnector = {
  /** Stable id; user preferences (enabled, disabled tools) are saved under it. */
  id: string;
  name: string;
  description: string;
  url: string;
  transport: McpServerRequest["transport"];
  /** Shown when the server can't be reached. */
  setupHint?: string;
  /** Send this tab's map session so the server's tools act on the map the user sees. */
  mapSession?: boolean;
};

export const BUILTIN_CONNECTORS: readonly BuiltinConnector[] = [
  {
    id: "builtin:netops",
    name: "NetOps",
    description:
      "Network operations: coverage, sites, tickets, BIN and subscriber analytics, next-best-action, RAN KPIs, Malaysian place search and state/district/mukim boundaries.",
    url: process.env.NEXT_PUBLIC_NETOPS_MCP_URL ?? "http://127.0.0.1:8000/mcp",
    transport: "http",
    setupHint: "cd netops-mcp && uv run python -m netops_mcp.server --http",
  },
  {
    id: "builtin:weather-ml",
    name: "Weather ML",
    description:
      "Local Chronos machine-learning rainfall and temperature forecasts, evaluation metrics, and weather exposure overlays. Experimental research forecasts; historical replay is labeled. Site exposure does not predict outages.",
    url: process.env.NEXT_PUBLIC_WEATHER_MCP_URL ?? "http://127.0.0.1:8002/mcp",
    transport: "http",
    setupHint: "cd weather-ml-mcp && docker compose -p ai-elevate-weather up -d (bootstrap model and data first).",
  },
  {
    id: "builtin:kepler",
    name: "Kepler.gl Map",
    description:
      "Control the map: load data, add and style layers, filter, move the camera, change the basemap, split view.",
    // served by this app (src/app/api/kepler/mcp); relative URLs resolve against the page origin
    url: process.env.NEXT_PUBLIC_KEPLER_MCP_URL ?? "/api/kepler/mcp",
    transport: "http",
    setupHint: "Served by this app. Keep the map open in this tab; tool calls run on it.",
    mapSession: true,
  },
];

export function findBuiltinConnector(id: string): BuiltinConnector | undefined {
  return BUILTIN_CONNECTORS.find((c) => c.id === id);
}
