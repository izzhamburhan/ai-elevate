/**
 * The Menara synthetic-data MCP servers (backend/*-mcp), started together by `python backend/run_all.py`.
 * Plain data, safe for the browser: the connector catalog lists them and the server routes look up ports here.
 */
export const MENARA_HOST = "http://127.0.0.1";

export const MENARA_SERVERS = [
  { key: "tower", name: "Tower", port: 8101, description: "Cell tower status, KPIs, alarms and neighbours." },
  { key: "ticket", name: "Ticket", port: 8102, description: "UniFi Mobile tickets, location clustering and notes." },
  { key: "user", name: "User", port: 8103, description: "Subscriber serving cell and experience, PII masked." },
  { key: "ontology", name: "Ontology", port: 8104, description: "Linked objects for towers: blast radius, neighbours, upstream dependencies and incidents." },
  { key: "weather", name: "Weather", port: 8105, description: "Rainfall and lightning near a location." },
  { key: "grid", name: "Grid", port: 8106, description: "Power feeder status and outages for tower sites." },
  { key: "flood", name: "Flood", port: 8107, description: "River gauges and flood extent." },
  { key: "twin", name: "Twin", port: 8108, description: "Digital twin: simulate a tower failure or a tilt change before acting." },
  { key: "policy", name: "Policy", port: 8109, description: "Policy engine: allow, ask or deny actions, approvals, signed tokens, kill switch and audit log." },
  { key: "drone", name: "Drone", port: 8110, description: "Simulated drones: dispatch a tower inspection and read canned vision findings." },
  { key: "ran", name: "RAN", port: 8111, description: "Sandboxed RAN changes (tilt, cell reset, rollback) that need a signed policy token." },
  { key: "sites", name: "Sites", port: 8112, description: "Critical sites (clinics, police, schools, SLA customers) and the towers that serve them." },
  { key: "usage", name: "Usage", port: 8113, description: "What people use on the internet, by area and tower." },
  { key: "energy", name: "Energy", port: 8114, description: "Tower power draw, battery and generator time, and night-time sleep savings." },
  { key: "care", name: "Care", port: 8115, description: "Customer impact, drafted notices in four languages, and sending them." },
  { key: "enterprise", name: "Enterprise", port: 8116, description: "Business customers, revenue and SLA penalty at risk, and service credits." },
  { key: "exposure", name: "Exposure", port: 8117, description: "Quality on demand: profiles, a feasibility quote and a booking." },
  { key: "field", name: "Field", port: 8118, description: "Which technician to send, road or boat, parts and safety, and dispatching them." },
  { key: "events", name: "Events", port: 8119, description: "Crowd events ahead and the load they put on nearby towers." },
  { key: "sensors", name: "Sensors", port: 8120, description: "Smart-city sensors and early-warning alerts." },
  { key: "scam", name: "Scam", port: 8121, description: "Scam hotspots (counts only) and how many customers a shield would protect." },
  { key: "demo", name: "Demo", port: 8122, description: "Scenario clock and reset: move time forward so slow things can finish." },
] as const;

/** Tools only the human UI may call. The chat agent never sees them (policy approval, settings, resets). */
export const AGENT_HIDDEN_TOOLS: ReadonlySet<string> = new Set([
  "policy_approve",
  "policy_reject",
  "policy_update_setting",
  "policy_set_kill_switch",
  "demo_set_clock",
  "demo_reset",
]);

/** Tools are named `<server>_<verb>`; returns the server a tool belongs to. */
export function menaraServerForTool(tool: string) {
  const key = tool.split("_", 1)[0];
  return MENARA_SERVERS.find((s) => s.key === key);
}