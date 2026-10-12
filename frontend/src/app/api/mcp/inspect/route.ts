import { inspectMcpServer } from "@/lib/ai/mcp";
import { mcpServerRequestSchema } from "@/lib/ai/mcp-config";

export const maxDuration = 30;

/** Used by the connectors dialog to test a server and list its tools. */
export async function POST(req: Request) {
  const parsed = mcpServerRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Enter a valid http(s) MCP server URL." }, { status: 400 });
  }

  try {
    return Response.json(await inspectMcpServer(parsed.data));
  } catch (error) {
    console.warn(`[mcp] inspect ${parsed.data.url} failed:`, error);
    const message = error instanceof Error ? error.message : "Could not reach the MCP server.";
    return Response.json({ error: message }, { status: 502 });
  }
}
