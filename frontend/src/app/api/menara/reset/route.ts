import { callMenaraTool } from "@/lib/menara/call";
import { clearRun } from "@/lib/menara/heal";

/** Puts the demo back to a clean state: clears runtime rows, the clock and policy defaults. Not while a run is going. */
export async function POST() {
  try {
    clearRun();
    return Response.json(await callMenaraTool("demo_reset"));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}