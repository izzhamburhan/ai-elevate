import { MENARA_HOST, MENARA_SERVERS } from "@/lib/menara/servers";

import type { McpServerRequest } from "./mcp-config";

/** Topics the connectors dialog groups the built-in connectors under, in display order. */
export const CONNECTOR_CATEGORIES = [
  {
    id: "industry",
    title: "AI for industry & operations",
    blurb: "Automate field work and run risky changes safely: drones, digital twins and policy checks.",
  },
  {
    id: "workforce",
    title: "AI for workforce productivity",
    blurb: "Help engineers and care staff work faster: tickets and field dispatch.",
  },
  {
    id: "customer",
    title: "AI for customer experience",
    blurb: "Understand what subscribers feel, tell them what is happening and keep them safe.",
  },
  {
    id: "network",
    title: "AI for networks & infrastructure",
    blurb: "Towers, coverage, RAN changes and the links between network objects.",
  },
  {
    id: "sustainability",
    title: "AI for sustainability & smart nation",
    blurb: "Weather, floods, energy, critical sites and official statistics.",
  },
  {
    id: "revenue",
    title: "Potential revenue streams",
    blurb: "Enterprise SLAs, network APIs, events and location intelligence.",
  },
  {
    id: "others",
    title: "Others",
    blurb: "Connectors the app's own UI runs on: the map and the demo scenario clock.",
  },
] as const;

export type ConnectorCategory = (typeof CONNECTOR_CATEGORIES)[number]["id"];

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
  category: ConnectorCategory;
  /** Who runs the server or owns its data, shown as "by …". */
  publisher: string;
  /** Where the data comes from; synthetic and experimental output is always labeled. */
  data: "synthetic" | "real" | "experimental" | "live";
};

type MenaraKey = (typeof MENARA_SERVERS)[number]["key"];

const MENARA_CATEGORY: Record<MenaraKey, ConnectorCategory> = {
  tower: "network",
  ticket: "workforce",
  user: "customer",
  ontology: "network",
  weather: "sustainability",
  grid: "industry",
  flood: "sustainability",
  twin: "industry",
  policy: "industry",
  drone: "industry",
  ran: "network",
  sites: "sustainability",
  usage: "customer",
  energy: "sustainability",
  care: "customer",
  enterprise: "revenue",
  exposure: "revenue",
  field: "workforce",
  events: "revenue",
  sensors: "sustainability",
  scam: "customer",
  netintel: "network",
  mlpredict: "revenue",
  opportunity: "revenue",
  demo: "others",
};

/** Menara synthetic-data MCPs (backend/*-mcp), started together by `python backend/run_all.py`. */
const MENARA_CONNECTORS: readonly BuiltinConnector[] = MENARA_SERVERS.map((s) => ({
  id: `builtin:menara-${s.key}`,
  name: s.name,
  description: s.description,
  url: `${MENARA_HOST}:${s.port}/mcp`,
  transport: "http",
  setupHint: "cd backend && python run_all.py",
  category: MENARA_CATEGORY[s.key],
  publisher: "Menara",
  data: "synthetic",
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
    category: "network",
    publisher: "Elevate",
    data: "synthetic",
  },
  {
    id: "builtin:weather-ml",
    name: "Weather ML",
    description:
      "Local Chronos machine-learning rainfall and temperature forecasts, evaluation metrics, and weather exposure overlays. Experimental research forecasts; historical replay is labeled. Site exposure does not predict outages.",
    url: process.env.NEXT_PUBLIC_WEATHER_MCP_URL ?? "http://127.0.0.1:8002/mcp",
    transport: "http",
    setupHint: "cd weather-ml-mcp && docker compose -p ai-elevate-weather up -d (bootstrap model and data first).",
    category: "sustainability",
    publisher: "Elevate",
    data: "experimental",
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
    category: "others",
    publisher: "Elevate",
    data: "live",
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
    category: "network",
    publisher: "Ookla Open Data",
    data: "real",
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
    category: "sustainability",
    publisher: "DOSM",
    data: "real",
  },
];

export function findBuiltinConnector(id: string): BuiltinConnector | undefined {
  return BUILTIN_CONNECTORS.find((c) => c.id === id);
}

/** The built-in connector served at `url` (absolute, as the chat route connects to it). */
export function findBuiltinConnectorByUrl(url: string): BuiltinConnector | undefined {
  const trim = (u: string) => u.replace(/\/+$/, "");
  // app-relative built-ins (the kepler MCP) arrive with the page origin in front
  return BUILTIN_CONNECTORS.find((c) => trim(url) === trim(c.url) || trim(url).endsWith(trim(c.url)));
}
