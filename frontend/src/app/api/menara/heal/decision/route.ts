import { decide } from "@/lib/menara/heal";

/** The human's answer to an approval the replay is waiting on. */
export async function POST(req: Request) {
  const { runId, approve } = (await req.json().catch(() => ({}))) as { runId?: string; approve?: boolean };
  if (!runId || typeof approve !== "boolean") return Response.json({ error: "Expected { runId, approve }." }, { status: 400 });
  return Response.json({ ok: decide(runId, approve) });
}