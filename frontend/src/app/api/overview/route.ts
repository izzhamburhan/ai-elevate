import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";

import { menaraData } from "@/lib/ai/tool-result";
import type { Hotspot, NetworkOverview, OverviewTower } from "@/lib/network-overview";

export const maxDuration = 30;

const TOWER_MCP_URL = process.env.TOWER_MCP_URL ?? "http://127.0.0.1:8101/mcp";
const ONTOLOGY_MCP_URL = process.env.ONTOLOGY_MCP_URL ?? "http://127.0.0.1:8104/mcp";
const POLICY_MCP_URL = process.env.POLICY_MCP_URL ?? "http://127.0.0.1:8109/mcp";
const LIMIT = 2000;

/** Malaysia, Peninsular and Borneo. */
const BBOX = { min_lat: 0.5, min_lng: 99, max_lat: 7.5, max_lng: 119.5 };

type TowerList = { towers: OverviewTower[]; truncated: boolean };
type AlarmList = { alarms: { enodeb_name: string; severity: string }[]; truncated: boolean };
type IncidentList = { incidents: { incident_id: string; enodeb_name: string; status: string; cause: string; summary: string }[] };
type ApprovalList = { approvals: { approval_id: string; action: string; target: string }[] };

/** Calls one tool on one server. Optional servers return undefined when they are down. */
async function callTool(url: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  let client: MCPClient | undefined;
  try {
    client = await createMCPClient({ transport: { type: "http", url } });
    const tool = (await client.tools())[name];
    if (!tool?.execute) throw new Error(`${url} has no ${name}`);
    return await tool.execute(args, { toolCallId: `overview-${name}`, messages: [], context: undefined });
  } finally {
    await client?.close().catch(() => {});
  }
}

const optional = (p: Promise<unknown>) => p.catch(() => undefined);

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}

/**
 * Problem towers grouped by town and ranked, so the first screen says where to look first.
 * Weights: a tower down outweighs alarms on a working one.
 */
function hotspots(towers: OverviewTower[], alarms: AlarmList["alarms"], incidentTowers: Set<string>): Hotspot[] {
  const alarmsByTower = new Map<string, { critical: number; major: number }>();
  for (const a of alarms) {
    const entry = alarmsByTower.get(a.enodeb_name) ?? { critical: 0, major: 0 };
    if (a.severity === "CRITICAL") entry.critical += 1;
    if (a.severity === "MAJOR") entry.major += 1;
    alarmsByTower.set(a.enodeb_name, entry);
  }

  const byTown = new Map<string, Hotspot>();
  for (const t of towers) {
    const a = alarmsByTower.get(t.enodeb_name);
    const problem = t.status === "DOWN" || t.status === "DEGRADED" || (a && a.critical + a.major > 0);
    if (!problem) continue;
    const key = `${t.town}|${t.state}`;
    const spot =
      byTown.get(key) ??
      ({ id: key, town: t.town, state: t.state, score: 0, down: [], degraded: [], critical: 0, major: 0, towers: [], incidents: 0, lat: 0, lng: 0 } satisfies Hotspot);
    if (t.status === "DOWN") spot.down.push(t.enodeb_name);
    if (t.status === "DEGRADED") spot.degraded.push(t.enodeb_name);
    spot.critical += a?.critical ?? 0;
    spot.major += a?.major ?? 0;
    spot.towers.push(t.enodeb_name);
    if (incidentTowers.has(t.enodeb_name)) spot.incidents += 1;
    spot.lat += t.lat;
    spot.lng += t.lng;
    byTown.set(key, spot);
  }

  return [...byTown.values()]
    .map((s) => ({
      ...s,
      lat: s.lat / s.towers.length,
      lng: s.lng / s.towers.length,
      score: s.down.length * 5 + s.critical * 3 + s.degraded.length * 2 + s.major,
    }))
    .sort((a, b) => b.score - a.score);
}

/** Network state for the situation board and the map: towers, alarms, hotspots, incidents, approvals. */
export async function GET() {
  try {
    const [towerResult, alarmResult, incidentResult, approvalResult] = await Promise.all([
      callTool(TOWER_MCP_URL, "tower_list_in_bbox", { ...BBOX, limit: LIMIT }),
      callTool(TOWER_MCP_URL, "tower_get_alarms", { active_only: true, limit: LIMIT }),
      optional(callTool(ONTOLOGY_MCP_URL, "ontology_list_incidents", { limit: 200 })),
      optional(callTool(POLICY_MCP_URL, "policy_list_approvals", { status: "PENDING", limit: 50 })),
    ]);
    const towers = menaraData<TowerList>(towerResult);
    const alarms = menaraData<AlarmList>(alarmResult);
    if (!towers || !alarms) throw new Error("Unexpected response from the tower server.");

    const incidents = (menaraData<IncidentList>(incidentResult)?.data.incidents ?? []).filter((i) => i.status !== "RESOLVED");
    const approvals = menaraData<ApprovalList>(approvalResult)?.data.approvals ?? [];

    const overview: NetworkOverview = {
      asOf: (towerResult as { structuredContent?: { as_of?: string } }).structuredContent?.as_of ?? null,
      towers: towers.data.towers,
      towersByStatus: countBy(towers.data.towers, (t) => t.status),
      alarmsBySeverity: countBy(alarms.data.alarms, (a) => a.severity),
      hotspots: hotspots(towers.data.towers, alarms.data.alarms, new Set(incidents.map((i) => i.enodeb_name))),
      openIncidents: incidents.map(({ incident_id, enodeb_name, status, cause, summary }) => ({ incident_id, enodeb_name, status, cause, summary })),
      pendingApprovals: approvals.map(({ approval_id, action, target }) => ({ approval_id, action, target })),
      truncated: towers.data.truncated || alarms.data.truncated,
    };
    return Response.json(overview);
  } catch (error) {
    const unreachable = error instanceof Error && /fetch failed|ECONNREFUSED/i.test(`${error.message} ${String(error.cause)}`);
    return Response.json(
      { error: unreachable ? "Tower server is not reachable. Start it with `cd backend && python run_all.py`." : error instanceof Error ? error.message : "Overview failed." },
      { status: 502 },
    );
  }
}
