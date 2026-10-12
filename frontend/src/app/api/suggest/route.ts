import { generateObject } from "ai";
import { z } from "zod";

import { ModelConfigError, resolveChatModel } from "@/lib/ai/providers";

export const maxDuration = 30;

const bodySchema = z.object({
  modelId: z.string().optional(),
  question: z.string().max(2000),
  answer: z.string().max(6000),
  tools: z.array(z.string().max(80)).max(40),
});

const chipsSchema = z.object({
  chips: z
    .array(
      z.object({
        title: z.string().describe("2-4 words, the action"),
        label: z.string().describe("up to 5 words, why or what it shows"),
        prompt: z.string().describe("the full instruction sent to the assistant, naming the specific towers, sites or numbers"),
      }),
    )
    .min(2)
    .max(4),
});

const INSTRUCTIONS = `You suggest the next 3 things a network operations (NOC) engineer would click after reading an assistant's answer.
Rules:
- Each suggestion must follow from THIS answer: name the specific towers, sites, areas or numbers it mentions. Never write "the worst one" or "it" when a name is available.
- Move the incident forward: impact, cause, simulation, an action that needs approval, customer notice, verification or a map view. Do not repeat what the answer already covers or tools already ran.
- Never suggest changing the network directly. A change request always goes through a policy check.
- The prompt is written as the engineer talking to the assistant, one or two sentences.
- Match the language of the engineer's question.`;

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const { modelId, question, answer, tools } = parsed.data;

  let resolved;
  try {
    resolved = resolveChatModel(modelId);
  } catch (error) {
    if (error instanceof ModelConfigError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }

  try {
    const { object } = await generateObject({
      model: resolved.model,
      schema: chipsSchema,
      system: INSTRUCTIONS,
      prompt: `Engineer asked:\n${question}\n\nTools the assistant used: ${tools.join(", ") || "none"}\n\nAssistant answered:\n${answer}`,
      abortSignal: AbortSignal.any([req.signal, AbortSignal.timeout(15_000)]),
    });
    return Response.json({ chips: object.chips });
  } catch (error) {
    console.warn("[suggest]", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not write suggestions." }, { status: 502 });
  }
}
