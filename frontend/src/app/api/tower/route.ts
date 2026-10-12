import { createMCPClient } from "@ai-sdk/mcp";

import { menaraData } from "@/lib/ai/tool-result";

export const maxDuration = 15;

const TOWER_MCP_URL = process.env.TOWER_MCP_URL ?? "http://127.0.0.1:8101/mcp";
const TOWER_NAME = /^[A-Z]{2,6}-\d{3,5}$/;

/** One tower's live detail for the map card: status, power, alarms, latest KPI, neighbours. */
export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get("name") ?? "";
  if (!TOWER_NAME.test(name)) return Response.json({ error: "Unknown tower name." }, { status: 400 });

  let client;
  try {
    client = await createMCPClient({ transport: { type: "http", url: TOWER_MCP_URL } });
  } catch {
    return Response.json({ error: "Tower server is not reachable." }, { status: 502 });
  }
  try {
    const tool = (await client.tools()).tower_get_status;
    if (!tool?.execute) return Response.json({ error: "Tower server has no status tool." }, { status: 502 });
    const result = await tool.execute({ enodeb_name: name }, { toolCallId: "tower-card", messages: [], context: undefined });
    const body = menaraData(result);
    if (!body) return Response.json({ error: `No tower ${name}.` }, { status: 404 });
    return Response.json(body.data);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Lookup failed." }, { status: 500 });
  } finally {
    await client.close().catch(() => {});
  }
}
