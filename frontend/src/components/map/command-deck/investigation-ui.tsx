"use client";

import { useEffect, useState } from "react";

import { elapsedSeconds } from "@/lib/hermes/investigation";

/** Seconds since `from`, refreshed each second while `running`, else up to `until`. */
export function useElapsed(from: string | undefined, until: string | undefined, running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  if (!from) return 0;
  return elapsedSeconds(from, running ? now : until ?? now);
}

export const JOB_STATUS_CHIP = {
  queued: { label: "Queued", className: "border-violet/30 bg-violet/10 text-violet" },
  running: { label: "Running", className: "border-violet/30 bg-violet/10 text-violet" },
  completed: { label: "Completed", className: "border-green/30 bg-green/10 text-green" },
  partial: { label: "Partial result", className: "border-amber/30 bg-amber/10 text-amber" },
  failed: { label: "Failed", className: "border-red/30 bg-red/10 text-red" },
} as const;
