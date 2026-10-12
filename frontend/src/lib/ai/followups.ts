import type { SuggestionAdapter, ThreadMessage } from "@assistant-ui/react";

import { menaraData } from "./tool-result";

type Chip = { title: string; label: string; prompt: string };

/** Tool names called in the last assistant message, with their results. */
type Called = { name: string; result: unknown };

function lastAssistantCalls(messages: readonly ThreadMessage[]): Called[] | undefined {
  const last = messages[messages.length - 1];
  if (last?.role !== "assistant") return undefined;
  const calls: Called[] = [];
  for (const part of last.content) {
    if (part.type === "tool-call") calls.push({ name: part.toolName, result: part.result });
  }
  return calls;
}

const has = (calls: Called[], ...prefixes: string[]) =>
  calls.some((c) => prefixes.some((p) => c.name.startsWith(p)));

/** Approval left PENDING by `policy_check_action`: the card handles it, so no chips until it is decided. */
function pendingApproval(calls: Called[]): boolean {
  return calls.some((c) => {
    if (c.name !== "policy_check_action") return false;
    const decision = menaraData<{ decision?: string }>(c.result)?.data.decision;
    return decision === "ask";
  });
}

/**
 * Next steps for a NOC engineer, picked from the tools the last answer used. Fixed rules on purpose:
 * predictable, free, and they follow the incident flow (alarms, impact, cause, simulate, act, verify).
 * Prompts refer to "it" / "the worst one" so the model reuses what it already found.
 */
export function followupsFor(calls: Called[]): Chip[] {
  if (calls.length === 0 || pendingApproval(calls)) return [];

  const chips: Chip[] = [];
  const add = (chip: Chip) => chips.length < 4 && chips.push(chip);

  if (has(calls, "policy_check_action", "policy_get_approval")) {
    add({ title: "Apply the change", label: "with the approved token", prompt: "Apply the approved change now, then verify the KPIs afterwards." });
    add({ title: "Audit trail", label: "who decided what", prompt: "Show the policy audit log for this action." });
  }
  if (has(calls, "ran_")) {
    add({ title: "Verify the effect", label: "KPIs before vs after", prompt: "Did that change help? Compare the tower KPIs before and after." });
    add({ title: "Roll back", label: "if it did not help", prompt: "Roll back that change if the KPIs did not improve." });
  }
  if (has(calls, "twin_")) {
    add({ title: "Is it allowed?", label: "policy check", prompt: "Would policy allow that change? If it needs approval, request it." });
  }
  if (has(calls, "tower_", "ticket_get_ntt", "ticket_list_ntt")) {
    add({ title: "Blast radius", label: "what depends on it", prompt: "What is the blast radius of the worst one: neighbours, upstream dependencies and incidents?" });
    add({ title: "Likely cause", label: "weather, flood, power", prompt: "What is the likely cause of the worst one? Check weather, flood gauges and the power feeder." });
  }
  if (has(calls, "ontology_", "sites_")) {
    add({ title: "Customers & revenue", label: "impact and SLA risk", prompt: "Which customers and enterprise accounts are affected, and how much SLA penalty is at risk?" });
    add({ title: "Simulate a fix", label: "before touching the network", prompt: "Simulate the failure and a tilt change on the worst tower, and tell me what helps." });
  }
  if (has(calls, "weather_", "flood_", "grid_")) {
    add({ title: "Which towers are at risk?", label: "next few hours", prompt: "Which towers are most at risk from this over the next few hours? Show them on the map." });
  }
  if (has(calls, "drone_", "field_")) {
    add({ title: "Notify customers", label: "draft the notice", prompt: "Draft the customer notice for the affected area in English and Malay." });
  }
  if (has(calls, "tower_", "ontology_")) {
    add({ title: "Open a ticket", label: "for the worst one", prompt: "Open a ticket for the worst one with the diagnosis so far." });
  }
  if (chips.length === 0) {
    add({ title: "What is down right now?", label: "alarms and status", prompt: "Which towers are down or have critical alarms right now?" });
  }
  return chips;
}

/** Model the picker has selected, so suggestions are written by the same model the user chose. */
let suggestionModelId: string | undefined;
export function setSuggestionModel(id: string) {
  suggestionModelId = id;
}

function textOf(message: ThreadMessage | undefined): string {
  if (!message) return "";
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
    .trim();
}

/** Chips written from this exchange (names, counts, what the user asked); undefined if it fails. */
async function modelChips(messages: readonly ThreadMessage[], calls: Called[], signal?: AbortSignal): Promise<Chip[] | undefined> {
  const answer = textOf(messages[messages.length - 1]);
  const question = textOf([...messages].reverse().find((m) => m.role === "user"));
  if (!answer || !question) return undefined;
  try {
    const res = await fetch("/api/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelId: suggestionModelId,
        question: question.slice(0, 2000),
        answer: answer.slice(0, 6000),
        tools: [...new Set(calls.map((c) => c.name))].slice(0, 40),
      }),
      signal,
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { chips?: Chip[] };
    const chips = body.chips?.filter((c) => c.title && c.prompt).slice(0, 4);
    return chips?.length ? chips : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Feeds `thread.suggestions` after each answer; the thread shows them as chips under the reply.
 * Shows the rule-based chips at once, then swaps in chips the model wrote for this exact answer.
 * If the model call fails or is slow, the rule-based chips simply stay.
 */
export const followupAdapter: SuggestionAdapter = {
  async *generate({ messages, signal }) {
    const calls = lastAssistantCalls(messages);
    if (!calls) return;
    const fallback = followupsFor(calls);
    yield fallback;
    if (pendingApproval(calls)) return;
    const written = await modelChips(messages, calls, signal);
    if (written) yield written;
  },
};
