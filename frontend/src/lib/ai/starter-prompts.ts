import type { SuggestionConfig } from "@assistant-ui/react";

/**
 * Clickable prompts on the empty chat, written for NOC engineers. The situation board above them
 * already covers "what is wrong where", so these are the other jobs of a shift. Each one is sent
 * as-is, so keep them answerable by the built-in connectors without extra input.
 * `title` is the bold lead, `label` the grey hint, `prompt` what is sent.
 */
export const STARTER_PROMPTS: SuggestionConfig[] = [
  {
    title: "Shift handover",
    label: "what changed, what is still open",
    prompt:
      "Write my shift handover: what changed on the network, incidents opened or resolved, actions taken and approvals decided (from the policy audit log and RAN changes), and what is still open. One screen, most important first.",
  },
  {
    title: "Weather and flood risk",
    label: "towers at risk in the next hours",
    prompt:
      "Which towers are at risk from rain, rising rivers or power outages in the next few hours? Rank them and say what to prepare.",
  },
  {
    title: "Congested cells",
    label: "where capacity is short",
    prompt: "Show congested 4G and 5G cells as a heatmap and list the 10 worst sites with their load.",
  },
  {
    title: "Troubleshoot a subscriber",
    label: "slow data, where, and why",
    prompt:
      "Take a subscriber with poor experience and tell me which cell serves them, what its KPIs and alarms show, and the likely cause.",
  },
];
