import { currentRun } from "@/lib/menara/heal";

/** Events of the current run since index `since`; the panel polls this. */
export async function POST(req: Request) {
  const { since = 0 } = (await req.json().catch(() => ({}))) as { since?: number };
  const run = currentRun();
  if (!run) return Response.json({ runId: null, status: "idle", events: [], next: 0 });
  const events = run.events.slice(Math.max(0, since));
  return Response.json({
    runId: run.id,
    status: run.status,
    events,
    next: Math.max(0, since) + events.length,
    awaitingApproval: run.pending !== null,
  });
}