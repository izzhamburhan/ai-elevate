import { cancel, clearRun, currentRun, startHeal } from "@/lib/menara/heal";

/** Starts (on a named tower, or the most urgent faulty one), cancels or clears the self-heal run. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: "start" | "cancel" | "clear"; runId?: string; tower?: string };
  try {
    if (body.action === "cancel") return Response.json({ ok: cancel(String(body.runId)) });
    if (body.action === "clear") {
      clearRun();
      return Response.json({ ok: true });
    }
    // a run already going is reused: the new card shows that one
    const running = currentRun();
    if (running?.status === "running") return Response.json({ runId: running.id, tower: running.tower, existing: true });
    return Response.json({ ...(await startHeal(body.tower)), existing: false });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}