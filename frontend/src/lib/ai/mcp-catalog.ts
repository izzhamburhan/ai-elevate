import { MENARA_HOST, MENARA_SERVERS } from "@/lib/menara/servers";

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

/** Menara synthetic-data MCPs (backend/*-mcp), started together by `python backend/run_all.py`. */
const MENARA_CONNECTORS: readonly BuiltinConnector[] = MENARA_SERVERS.map((s) => ({
  id: `builtin:menara-${s.key}`,
  name: s.name,
  description: `${s.description} (synthetic data)`,
  url: `${MENARA_HOST}:${s.port}/mcp`,
  transport: "http",
  setupHint: "cd backend && python run_all.py",
}));

export const BUILTIN_CONNECTORS: readonly BuiltinConnector[] = [
  {
    id: "builtin:netops",
    name: "NetOps",
    description:
      "Network operations: coverage, sites, tickets, BIN and subscriber analytics, next-best-action, RAN KPIs, Malaysian place search and state/district/mukim boundaries.",
    url: process.env.NEXT_PUBLIC_NETOPS_MCP_URL ?? "http://127.0.0.1:8000/mcp",
    transport: "http",
    setupHint: "cd backend/netops-mcp && uv run python -m netops_mcp.server --http",
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
  ...MENARA_CONNECTORS,
  {
    id: "builtin:menara-ookla",
    name: "Ookla Speed",
    description:
      "Real measured download/upload Mbps and latency in Malaysia as an H3 hex layer, per quarter (Ookla Open Data, all providers combined).",
    url: "http://127.0.0.1:8122/mcp",
    transport: "http",
    setupHint:
      "cd backend && python run_all.py ookla (build a layer first: uv run python -m ookla_mcp.build_layer --type mobile --year 2026 --quarter 3)",
  },
  {
    id: "builtin:menara-dosm",
    name: "DOSM Statistics",
    description:
      "Official Malaysian statistics from DOSM/OpenDOSM: population, household income, poverty, labour force, CPI, GDP, trade, internet access and PriceCatcher prices, by state and district (real data).",
    url: "http://127.0.0.1:8123/mcp",
    transport: "http",
    setupHint:
      "cd backend && python run_all.py dosm (first run downloads the data; refresh with: uv run python -m dosm_mcp.download)",
  },
];

export function findBuiltinConnector(id: string): BuiltinConnector | undefined {
  return BUILTIN_CONNECTORS.find((c) => c.id === id);
}
