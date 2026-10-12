import { healState } from "@/lib/menara/heal";

/** The loop's state for the chart: overloaded neighbours' PRB series, RAN changes and the incident. */
export async function POST() {
  try {
    return Response.json(await healState());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}