import { createMCPClient } from "@ai-sdk/mcp";

import { MENARA_HOST, menaraServerForTool } from "./servers";

/** Envelope every Menara tool returns: `data` plus evidence and a synthetic flag. */
export type Envelope = { synthetic?: boolean; as_of?: string; data?: unknown; evidence?: unknown[]; warnings?: string[] };

export class MenaraCallError extends Error {}

/** Calls one Menara MCP tool over streamable HTTP and returns its parsed result (server side only). */
export async function callMenaraTool(tool: string, args: Record<string, unknown> = {}): Promise<Envelope> {
  const server = menaraServerForTool(tool);
  if (!server) throw new MenaraCallError(`Unknown Menara tool "${tool}".`);

  const client = await createMCPClient({ transport: { type: "http", url: `${MENARA_HOST}:${server.port}/mcp` } }).catch(() => {
    throw new MenaraCallError(`${server.name} MCP is not reachable on port ${server.port}. Start it with: cd backend && python run_all.py`);
  });
  try {
    const tools = await client.tools();
    const found = tools[tool];
    if (!found?.execute) throw new MenaraCallError(`${server.name} MCP has no tool "${tool}".`);
    const result = (await found.execute(args, { toolCallId: crypto.randomUUID(), messages: [], context: {} })) as {
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
  } finally {
    await client.close().catch(() => {});
  }
}

/** The `data` field of an envelope as an object; {} when missing. */
export function dataOf(result: unknown): Record<string, unknown> {
  const data = (result as Envelope | undefined)?.data;
  if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, unknown>;
  return result && typeof result === "object" ? (result as Record<string, unknown>) : {};
}