import { createMCPClient } from "@ai-sdk/mcp";
import { z } from "zod";

import { menaraData } from "@/lib/ai/tool-result";

export const maxDuration = 30;

/**
 * Human decision on a pending policy approval. The approver key is a credential only a person
 * (this UI) may hold, so it lives in server env and is never sent to the browser or the model.
 * Dev default matches the backend's `DEV_APPROVER_KEY`; set MENARA_APPROVER_KEY outside dev.
 */
const POLICY_MCP_URL = process.env.POLICY_MCP_URL ?? "http://127.0.0.1:8109/mcp";
const DEV_APPROVER_KEY = "dev-only-approver-key";

const bodySchema = z.object({
  approvalId: z.string().min(1).max(64),
  decision: z.enum(["approve", "reject"]),
  approver: z.string().trim().min(1).max(60),
  note: z.string().max(300).optional(),
});

function approverKey(): string | undefined {
  const key = process.env.MENARA_APPROVER_KEY;
  if (key) return key;
  return process.env.NODE_ENV === "production" ? undefined : DEV_APPROVER_KEY;
}

/** "Error executing tool policy_approve: Approval APR-0001 is already APPROVED" -> the part after the colon. */
function toolErrorText(result: unknown): string {
  const content = (result as { content?: { type?: string; text?: string }[] } | null)?.content;
  const text = content?.find((c) => c.type === "text")?.text ?? "Decision was refused.";
  return text.replace(/^Error executing tool \w+:\s*/, "").slice(0, 300);
}

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });

  const key = approverKey();
  if (!key) return Response.json({ error: "MENARA_APPROVER_KEY is not set on the server." }, { status: 500 });

  const { approvalId, decision, approver, note } = parsed.data;
  let client;
  try {
    client = await createMCPClient({ transport: { type: "http", url: POLICY_MCP_URL } });
  } catch {
    return Response.json(
      { error: "Policy server is not reachable. Start it with `cd backend && python run_all.py`." },
      { status: 502 },
    );
  }

  try {
    const tools = await client.tools();
    const tool = tools[decision === "approve" ? "policy_approve" : "policy_reject"];
    if (!tool?.execute) return Response.json({ error: "Policy server has no approve tool." }, { status: 502 });

    const result = await tool.execute(
      { approval_id: approvalId, approver, approver_key: key, note },
      { toolCallId: "ui-decision", messages: [], context: undefined },
    );
    const body = menaraData<Record<string, unknown>>(result);
    if (!body) {
      // the server reports rule violations (wrong key, already decided) as tool errors
      return Response.json({ error: toolErrorText(result) }, { status: 409 });
    }
    return Response.json({ decision, ...body.data });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Decision failed." }, { status: 500 });
  } finally {
    await client.close().catch(() => {});
  }
}
