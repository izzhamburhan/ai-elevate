import { cancel, clearRun, startReplay } from "@/lib/menara/heal";

/** Starts, cancels or clears the scripted self-heal replay. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: "start" | "cancel" | "clear"; runId?: string };
  try {
    if (body.action === "cancel") return Response.json({ ok: cancel(String(body.runId)) });
    if (body.action === "clear") {
      clearRun();
      return Response.json({ ok: true });
    }
    return Response.json({ runId: startReplay() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}