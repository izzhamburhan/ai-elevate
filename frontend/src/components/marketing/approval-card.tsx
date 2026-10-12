"use client";

import { useState } from "react";
import { Boxes, Check, Hospital, KeyRound, RotateCcw, ShieldAlert, Undo2, X } from "lucide-react";

import { Chip, MockCard } from "./primitives";

type Decision = "pending" | "approved" | "rejected";

/** Mock of the approval prompt a duty engineer sees. The buttons work, so visitors can try it. */
export function ApprovalCard() {
  const [decision, setDecision] = useState<Decision>("pending");

  return (
    <MockCard className="p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium tracking-[0.12em] text-mk-muted uppercase">Proposed action</p>
        <Chip tone="amber">
          <ShieldAlert aria-hidden="true" />
          Ask a human
        </Chip>
      </div>

      <h3 className="mt-3 text-lg font-semibold tracking-tight text-mk-fg">Tilt 3 cells near Hospital (synthetic)</h3>
      <p className="mt-1 text-sm text-mk-muted">TWR-KB-027, -035, -040 · electrical tilt −2° · auto-check after 10 min</p>

      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl border border-mk-line bg-mk-fg/[0.02] p-3">
          <dt className="text-[11px] text-mk-muted">Twin prediction</dt>
          <dd className="mt-0.5 font-semibold text-mk-fg tabular-nums">
            96% <span className="text-mk-faint">to</span> <span className="text-mk-green">82%</span>
          </dd>
        </div>
        <div className="rounded-xl border border-mk-line bg-mk-fg/[0.02] p-3">
          <dt className="text-[11px] text-mk-muted">Emergency site</dt>
          <dd className="mt-0.5 font-semibold text-mk-fg">1.2 km away</dd>
        </div>
      </dl>

      <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Policy checks">
        <li>
          <Chip tone="green">
            <Boxes aria-hidden="true" />
            Simulated in twin
          </Chip>
        </li>
        <li>
          <Chip tone="red">
            <Hospital aria-hidden="true" />
            Hospital in range
          </Chip>
        </li>
        <li>
          <Chip tone="blue">
            <KeyRound aria-hidden="true" />
            Token signed
          </Chip>
        </li>
        <li>
          <Chip tone="magenta">
            <Undo2 aria-hidden="true" />
            Rollback armed
          </Chip>
        </li>
      </ul>

      <div className="mt-5 flex min-h-10 items-center gap-2 border-t border-mk-line pt-4" aria-live="polite">
        {decision === "pending" ? (
          <>
            <button
              type="button"
              onClick={() => setDecision("approved")}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-mk-brand px-5 text-sm font-medium text-mk-brand-fg transition-colors hover:bg-[#cdb6ff]"
            >
              <Check className="size-4" aria-hidden="true" />
              Approve
            </button>
            <button
              type="button"
              onClick={() => setDecision("rejected")}
              className="inline-flex h-10 items-center gap-1.5 rounded-full border border-mk-line-strong px-5 text-sm font-medium text-mk-fg transition-colors hover:bg-mk-fg/[0.06]"
            >
              <X className="size-4" aria-hidden="true" />
              Reject
            </button>
          </>
        ) : (
          <>
            <p className="flex-1 text-sm text-mk-fg">
              {decision === "approved" ? (
                <>
                  <span className="font-medium text-mk-green">Approved.</span> Token <span className="font-mono text-mk-muted">at_7f3a…e1c4</span> logged to audit.
                </>
              ) : (
                <>
                  <span className="font-medium text-mk-red">Rejected.</span> Nothing changed. Decision logged to audit.
                </>
              )}
            </p>
            <button
              type="button"
              onClick={() => setDecision("pending")}
              className="inline-flex h-8 items-center gap-1 rounded-full border border-mk-line px-3 text-xs text-mk-muted hover:text-mk-fg"
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              Reset
            </button>
          </>
        )}
      </div>
    </MockCard>
  );
}
