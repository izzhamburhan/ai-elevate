import { z } from "zod";

import { callMenaraTool, MenaraCallError } from "@/lib/menara/call";
import { AGENT_HIDDEN_TOOLS, menaraServerForTool } from "@/lib/menara/servers";

const bodySchema = z.object({
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()).default({}),
});

/** Lets the Map & Area panel call one Menara MCP tool. The human-only tools (approvals, reset) are not reachable here. */
export async function POST(req: Request) {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Expected { tool, args }." }, { status: 400 });
  const { tool, args } = body.data;

  if (!menaraServerForTool(tool) || AGENT_HIDDEN_TOOLS.has(tool)) {
    return Response.json({ error: `Tool "${tool}" is not available.` }, { status: 404 });
  }
  try {
    return Response.json(await callMenaraTool(tool, args));
  } catch (error) {
    const status = error instanceof MenaraCallError ? 502 : 500;
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}