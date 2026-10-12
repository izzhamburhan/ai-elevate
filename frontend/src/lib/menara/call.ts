import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";

import { MENARA_HOST, menaraServerForTool } from "./servers";

/** Envelope every Menara tool returns: `data` plus evidence and a synthetic flag. */
export type Envelope = { synthetic?: boolean; as_of?: string; data?: unknown; evidence?: unknown[]; warnings?: string[] };

/** A tool or server problem worth showing as is (not retried). */
export class MenaraCallError extends Error {}

/** The cached tool list lacks the tool; the server may have been restarted with new tools, so reconnect once. */
class MissingToolError extends MenaraCallError {}

/** NetOps MCP (the boss's server), same variable the connector catalog uses. */
export const NETOPS_URL = process.env.NEXT_PUBLIC_NETOPS_MCP_URL ?? "http://127.0.0.1:8000/mcp";

type Connection = { client: MCPClient; tools: Awaited<ReturnType<MCPClient["tools"]>> };

// One connection per server, kept on globalThis so dev hot reloads reuse it. Opening a new session for every
// call (the chat cards poll several servers a few times a second) made the servers drop requests.
const holder = globalThis as unknown as { __menaraConnections?: Map<string, Promise<Connection>> };
const connections = () => (holder.__menaraConnections ??= new Map());

function connect(url: string, label: string): Promise<Connection> {
  let pending = connections().get(url);
  if (!pending) {
    pending = (async () => {
      const client = await createMCPClient({ transport: { type: "http", url } }).catch(() => {
        throw new MenaraCallError(`${label} MCP is not reachable at ${url}. Start it with: cd backend && python run_all.py`);
      });
      return { client, tools: await client.tools() };
    })();
    connections().set(url, pending);
    pending.catch(() => connections().delete(url));
  }
  return pending;
}

async function drop(url: string) {
  const pending = connections().get(url);
  connections().delete(url);
  const connection = await pending?.catch(() => null);
  await connection?.client.close().catch(() => {});
}

async function callOnce(url: string, label: string, tool: string, args: Record<string, unknown>): Promise<Envelope> {
  const { tools } = await connect(url, label);
  // servers started with --search (the default in backend/run_all.py) list only <name>_search_tools and
  // <name>_call_tool; reach the real tool through that call proxy
  const direct = tools[tool];
  const proxy = direct ? undefined : Object.entries(tools).find(([name]) => name.endsWith("_call_tool"))?.[1];
  const found = direct ?? proxy;
  if (!found?.execute) throw new MissingToolError(`${label} MCP has no tool "${tool}".`);
  const input = direct ? args : { name: tool, arguments: args };
  const result = (await found.execute(input, { toolCallId: crypto.randomUUID(), messages: [], context: {} })) as {
    content?: { type: string; text?: string }[];
    structuredContent?: Envelope;
    isError?: boolean;
  };
  const text = result.content?.find((c) => c.type === "text")?.text ?? "";
  if (result.isError) throw new MenaraCallError(text || `${tool} failed`);
  if (result.structuredContent) return result.structuredContent;
  try {
    return JSON.parse(text) as Envelope;
  } catch {
    return { data: text };
  }
}

/** Calls one tool of one MCP server over streamable HTTP and returns its parsed result (server side only). */
export async function callMcp(url: string, label: string, tool: string, args: Record<string, unknown> = {}): Promise<Envelope> {
  try {
    return await callOnce(url, label, tool, args);
  } catch (error) {
    if (error instanceof MenaraCallError && !(error instanceof MissingToolError)) throw error;
    // a transport problem (a restarted server, an expired session): reconnect and try once more
    await drop(url);
    return callOnce(url, label, tool, args);
  }
}

/** Calls one Menara MCP tool (tower_*, user_*, ...), found by its name prefix. */
export async function callMenaraTool(tool: string, args: Record<string, unknown> = {}): Promise<Envelope> {
  const server = menaraServerForTool(tool);
  if (!server) throw new MenaraCallError(`Unknown Menara tool "${tool}".`);
  return callMcp(`${MENARA_HOST}:${server.port}/mcp`, server.name, tool, args);
}

/** The `data` field of an envelope as an object; {} when missing. */
export function dataOf(result: unknown): Record<string, unknown> {
  const data = (result as Envelope | undefined)?.data;
  if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, unknown>;
  return result && typeof result === "object" ? (result as Record<string, unknown>) : {};
}
