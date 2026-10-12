import {
  hermesAgentsSchema, hermesBackendUrl, hermesJobSchema, hermesRequestSchema,
  hermesSubmissionSchema, parseHermesQuery,
} from "@/lib/hermes/contracts";

export const maxDuration = 30;
const headers = { "Cache-Control": "no-store" };

async function contactHermes(operation: "agents" | "create" | "investigation", id?: string, body?: unknown) {
  const response = await fetch(hermesBackendUrl(process.env.HERMES_API_URL ?? "http://127.0.0.1:8011", operation, id), {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
    method: operation === "create" ? "POST" : "GET",
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const status = response.status === 404 ? 404 : response.status === 400 || response.status === 422 ? 400 : 503;
    return Response.json({ error: status === 404 ? "This Hermes investigation was not found." : "Hermes could not accept this request. Check its readiness, then retry." }, { status, headers });
  }
  const value: unknown = await response.json();
  const schema = operation === "agents" ? hermesAgentsSchema : operation === "create" ? hermesSubmissionSchema : hermesJobSchema;
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    console.warn("[hermes] service response did not match its validated contract");
    return Response.json({ error: "Hermes returned an invalid response. No findings were added to the map." }, { status: 502, headers });
  }
  return Response.json(parsed.data, { headers });
}

export async function GET(request: Request) {
  const query = parseHermesQuery(new URL(request.url).searchParams);
  if (!query) return Response.json({ error: "Choose agent status or a valid investigation ID." }, { status: 400, headers });
  try { return await contactHermes(query.action, query.action === "investigation" ? query.id : undefined); }
  catch { return Response.json({ error: "Could not reach Hermes. Start its local container and check readiness." }, { status: 503, headers }); }
}

export async function POST(request: Request) {
  // Profiles have persistent state: reject cross-origin browser submissions without adding a new auth system.
  // Compare with the Host the browser used: Next dev reports request.url as localhost even on 127.0.0.1.
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  let sameOrigin = !origin;
  try { sameOrigin ||= Boolean(host) && new URL(origin!).host === host; } catch { sameOrigin = false; }
  if (!sameOrigin) return Response.json({ error: "Cross-origin Hermes requests are not allowed." }, { status: 403, headers });
  try {
    const text = await request.text();
    if (text.length > 16_000) return Response.json({ error: "Hermes request is too large." }, { status: 413, headers });
    const parsed = hermesRequestSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return Response.json({ error: "Choose one of the four agents and enter an investigation of 1–4000 characters." }, { status: 400, headers });
    return await contactHermes("create", undefined, parsed.data);
  } catch (cause) {
    if (cause instanceof SyntaxError) return Response.json({ error: "Hermes request must be valid JSON." }, { status: 400, headers });
    return Response.json({ error: "Could not reach Hermes. No successful investigation is implied." }, { status: 503, headers });
  }
}
