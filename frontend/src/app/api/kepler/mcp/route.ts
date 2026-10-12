import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { KEPLER_SESSION_HEADER } from "@/lib/kepler/bridge-protocol";
import { createKeplerMcpServer } from "@/lib/kepler/mcp-server";

export const maxDuration = 60;

/**
 * kepler.gl MCP server (streamable HTTP, stateless) at /api/kepler/mcp. Listed as the built-in
 * "Kepler.gl Map" connector; external MCP clients (e.g. Claude Code) can use the same URL and
 * control the most recently opened map tab.
 */
async function handle(req: Request) {
  const session = req.headers.get(KEPLER_SESSION_HEADER) ?? undefined;
  const server = createKeplerMcpServer(session);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export { handle as GET, handle as POST, handle as DELETE };
