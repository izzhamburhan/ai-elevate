import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";

import { AGENT_HIDDEN_TOOLS } from "@/lib/menara/servers";

import type { McpServerInspection, McpServerRequest } from "./mcp-config";

/**
 * MCP servers the agent always uses, from MCP_SERVER_URLS (comma-separated).
 * A FastMCP server started with `mcp.run(transport="http")` serves at http://host:8000/mcp.
 */
function configuredServers(): McpServerRequest[] {
  const headers = process.env.MCP_AUTH_TOKEN
    ? { Authorization: `Bearer ${process.env.MCP_AUTH_TOKEN}` }
    : undefined;

  return (process.env.MCP_SERVER_URLS ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => ({ url, transport: "http", headers }));
}

function openClient({ url, transport, headers }: McpServerRequest): Promise<MCPClient> {
  return createMCPClient({ transport: { type: transport, url, headers } });
}

/**
 * A server started with --search lists only `<name>_search_tools` and `<name>_call_tool`, so the human-only tools
 * (approvals, policy settings, demo reset) are reachable through the call tool. Refuse those calls here too.
 */
function guardSearchCalls(tools: ToolSet): ToolSet {
  const guarded: ToolSet = {};
  for (const [name, tool] of Object.entries(tools)) {
    const execute = tool.execute;
    guarded[name] =
      name.endsWith("_call_tool") && execute
        ? {
            ...tool,
            execute: (input, options) => {
              const target = (input as { name?: unknown } | undefined)?.name;
              if (typeof target === "string" && AGENT_HIDDEN_TOOLS.has(target)) {
                throw new Error(`${target} is for a human only and cannot be called by the assistant.`);
              }
              return execute(input, options);
            },
          }
        : tool;
  }
  return guarded;
}

export type McpToolbox = {
  tools: ToolSet;
  /** Idempotent; call when the response stream ends or the request is aborted. */
  close: () => Promise<void>;
};

/**
 * Connects to every configured MCP server plus the ones the user connected in the
 * connectors dialog, and merges their tools. A server that is down is skipped with a
 * warning so the chat keeps working without its tools.
 */
export async function connectMcpTools(userServers: McpServerRequest[] = []): Promise<McpToolbox> {
  const servers = [...configuredServers(), ...userServers];

  const results = await Promise.allSettled(
    servers.map(async (server) => {
      const client = await openClient(server);
      try {
        const definitions = await client.listTools();
        const disabled = new Set(server.disabledTools ?? []);
        const enabled = definitions.tools.filter((tool) => !disabled.has(tool.name) && !AGENT_HIDDEN_TOOLS.has(tool.name));
        return { client, tools: guardSearchCalls(client.toolsFromDefinitions({ ...definitions, tools: enabled })) };
      } catch (error) {
        await client.close().catch(() => {});
        throw error;
      }
    }),
  );

  const clients: MCPClient[] = [];
  let tools: ToolSet = {};
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      clients.push(result.value.client);
      tools = { ...tools, ...result.value.tools };
    } else {
      console.warn(`[mcp] skipping ${servers[i].url}:`, result.reason);
    }
  });

  let closed = false;
  return {
    tools,
    close: async () => {
      if (closed) return;
      closed = true;
      await Promise.allSettled(clients.map((c) => c.close()));
    },
  };
}

/** Connects once to a server and reports who it is and which tools it offers. */
export async function inspectMcpServer(server: McpServerRequest): Promise<McpServerInspection> {
  const client = await openClient(server);
  try {
    const { tools } = await client.listTools();
    return {
      serverName: client.serverInfo.name,
      serverVersion: client.serverInfo.version,
      instructions: client.instructions,
      tools: tools.map(({ name, title, description }) => ({ name, title, description })),
    };
  } finally {
    await client.close().catch(() => {});
  }
}
