"use client";

import { useAuiState } from "@assistant-ui/react";
import { CheckIcon, LoaderIcon } from "lucide-react";
import { useMemo } from "react";

import { cn } from "@/lib/utils";

/** The triage playbook from the system prompt, as tool-name prefixes per step. */
const STEPS = [
  { label: "Alarms", tools: ["tower_", "ticket_"] },
  { label: "Blast radius", tools: ["ontology_"] },
  { label: "Impact", tools: ["sites_", "enterprise_", "care_get", "usage_", "user_"] },
  { label: "Cause", tools: ["weather_", "flood_", "grid_", "sensors_"] },
  { label: "Simulate", tools: ["twin_"] },
  { label: "Decide", tools: ["policy_"] },
] as const;

/** Shown once an answer touches at least this many steps: below that it is a lookup, not a triage. */
const MIN_STEPS = 3;

type Call = { toolName: string; done: boolean };

/**
 * Progress through the incident playbook for one answer: which steps the assistant has covered,
 * which it is on, and which it skipped. Lets the engineer see the investigation, not only its result.
 */
export function InvestigationProgress() {
  // select the stable content array; deriving inside the selector would return a new array each read
  const content = useAuiState((s) => s.message.content);
  const running = useAuiState((s) => s.message.status?.type === "running");

  const steps = useMemo(() => {
    const calls: Call[] = content.flatMap((p) =>
      p.type === "tool-call" ? [{ toolName: p.toolName, done: p.result !== undefined }] : [],
    );
    return STEPS.map((step) => {
      const mine = calls.filter((c) => step.tools.some((t) => c.toolName.startsWith(t)));
      return { label: step.label, state: mine.length === 0 ? "todo" : mine.every((c) => c.done) ? "done" : "active" };
    });
  }, [content]);
  if (steps.filter((s) => s.state !== "todo").length < MIN_STEPS) return null;

  return (
    <ol className="mb-3 flex flex-wrap items-center gap-x-1 gap-y-1 text-[11px]" aria-label="Investigation progress">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1">
          {i > 0 && <span className="h-px w-2 bg-border" aria-hidden />}
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
              s.state === "done" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
              s.state === "active" && "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
              s.state === "todo" && "text-muted-foreground",
              s.state === "todo" && !running && "line-through opacity-60",
            )}
            title={s.state === "todo" && !running ? "Skipped in this answer" : undefined}
          >
            {s.state === "done" && <CheckIcon className="size-3" />}
            {s.state === "active" && <LoaderIcon className="size-3 animate-spin" />}
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
