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
const MENARA_CONNECTORS: readonly BuiltinConnector[] = (
  [
    ["tower", "Tower", 8101, "Cell tower status, KPIs, alarms and neighbours."],
    ["ticket", "Ticket", 8102, "UniFi Mobile tickets, location clustering and notes."],
    ["user", "User", 8103, "Subscriber serving cell and experience, PII masked."],
    ["ontology", "Ontology", 8104, "Linked objects for towers: blast radius, neighbours, upstream dependencies and incidents."],
    ["weather", "Weather", 8105, "Rainfall and lightning near a location."],
    ["grid", "Grid", 8106, "Power feeder status and outages for tower sites."],
    ["flood", "Flood", 8107, "River gauges and flood extent."],
    ["twin", "Twin", 8108, "Digital twin: simulate a tower failure or a tilt change before acting."],
    ["policy", "Policy", 8109, "Policy engine: allow, ask or deny actions, approvals, signed tokens, kill switch and audit log."],
    ["drone", "Drone", 8110, "Simulated drones: dispatch a tower inspection and read canned vision findings."],
    ["ran", "RAN", 8111, "Sandboxed RAN changes (tilt, cell reset, rollback) that need a signed policy token."],
    ["sites", "Sites", 8112, "Critical sites (clinics, police, schools, SLA customers) and the towers that serve them."],
    ["usage", "Usage", 8113, "What people use on the internet, by area and tower."],
    ["energy", "Energy", 8114, "Tower power draw, battery and generator time, and night-time sleep savings."],
    ["care", "Care", 8115, "Customer impact, drafted notices in four languages, and sending them."],
    ["enterprise", "Enterprise", 8116, "Business customers, revenue and SLA penalty at risk, and service credits."],
    ["exposure", "Exposure", 8117, "Quality on demand: profiles, a feasibility quote and a booking."],
    ["field", "Field", 8118, "Which technician to send, road or boat, parts and safety, and dispatching them."],
    ["events", "Events", 8119, "Crowd events ahead and the load they put on nearby towers."],
    ["sensors", "Sensors", 8120, "Smart-city sensors and early-warning alerts."],
    ["scam", "Scam", 8121, "Scam hotspots (counts only) and how many customers a shield would protect."],
  ] as const
).map(([key, name, port, description]) => ({
  id: `builtin:menara-${key}`,
  name,
  description: `${description} (synthetic data)`,
  url: `http://127.0.0.1:${port}/mcp`,
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
