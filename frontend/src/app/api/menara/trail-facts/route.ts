import { MenaraCallError } from "@/lib/menara/call";
import { subscriberFacts } from "@/lib/menara/routines";

const HASH = /^[0-9a-f]{16}$/;

/** The facts a model needs to describe one subscriber's trail in words (last 24 h, nearby sites, 4-week routine). */
export async function POST(req: Request) {
  const { msisdn_hash } = (await req.json().catch(() => ({}))) as { msisdn_hash?: string };
  if (!msisdn_hash || !HASH.test(msisdn_hash)) return Response.json({ error: "msisdn_hash must be 16 hex characters." }, { status: 400 });
  try {
    return Response.json(await subscriberFacts(msisdn_hash));
  } catch (error) {
    const status = error instanceof MenaraCallError ? 502 : 500;
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}