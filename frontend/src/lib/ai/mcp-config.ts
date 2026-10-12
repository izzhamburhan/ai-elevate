import { z } from "zod";

/**
 * Wire format for a user-connected MCP server, shared by the connectors UI (browser)
 * and the chat / inspect routes (server). Keep this file free of secrets.
 */
export const mcpServerRequestSchema = z.object({
  url: z.url({ protocol: /^https?$/ }),
  /** Streamable HTTP (current MCP spec) or the legacy HTTP+SSE transport. */
  transport: z.enum(["http", "sse"]).default("http"),
  headers: z.record(z.string(), z.string()).optional(),
  /** Tool names the user switched off; they are not offered to the model. */
  disabledTools: z.array(z.string()).optional(),
});

export type McpServerRequest = z.infer<typeof mcpServerRequestSchema>;

export const mcpServerListSchema = z.array(mcpServerRequestSchema).max(50);

/** Result of `POST /api/mcp/inspect`. */
export type McpServerInspection = {
  serverName?: string;
  serverVersion?: string;
  instructions?: string;
  tools: { name: string; title?: string; description?: string }[];
};