"use client";

import type { Discovery, FeasibilityVerdict, ValidationState } from "@/lib/opportunities/contracts";

const rm = (value: number) => `RM ${value.toLocaleString("en-MY", { maximumFractionDigits: 0 })}`;
const myt = (iso: string) => new Date(iso).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" });
const VERDICT_STYLE: Record<FeasibilityVerdict["label"], string> = {
  supported: "border-green-500/40 bg-green-500/10 text-green-800 dark:text-green-300",
  "supported with risk": "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  "blocked until repaired": "border-destructive/40 bg-destructive/10 text-destructive",
  "not validated": "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
};

function ValidationBanner({ validation }: { validation: ValidationState }) {
  const text = {
    not_started: "Graph-ranked in seconds from synthetic data. Not yet validated by agents.",
    running: "Graph-ranked; not yet validated. Business Hypothesis and Engineer agents are validating network feasibility…",
    failed: "Agent validation did not complete. These remain graph-ranked, unvalidated opportunities.",
    validated: "",
  }[validation.state];
  if (validation.state === "validated") {
    return (
      <p role="status" className="rounded-md border border-green-500/40 bg-green-500/10 p-2 text-xs leading-relaxed">
        Agent-validated run <span className="font-mono">{validation.investigationId.slice(0, 8)}</span> · completed {myt(validation.completedAt)} MYT.
        Feasibility verdicts are computed from the Engineer&apos;s actual NetOps results.
      </p>
    );
  }
  return <p role="status" className="rounded-md border p-2 text-xs leading-relaxed text-muted-foreground">{text}{"investigationId" in validation ? ` Run ${validation.investigationId.slice(0, 8)}.` : ""}</p>;
}

/** Ranked Telco Opportunity Graph findings: where, why, what TM should do, potential, confidence, risks and (once validated) feasibility. */
export function OpportunityCards({ discovery, validation }: { discovery: Discovery; validation: ValidationState }) {
  const verdicts = validation.state === "validated" ? new Map(validation.verdicts.map((v) => [v.opportunity_id, v])) : null;
  return (
    <div className="space-y-2" aria-label="Ranked opportunities">
      <ValidationBanner validation={validation} />
      {discovery.data.opportunities.map((o) => {
        const [low, high] = o.commercial_potential.indicative_monthly_recurring_rm;
        const verdict = verdicts?.get(o.opportunity_id);
        return (
          <article key={o.opportunity_id} className="rounded-lg border p-3 text-xs leading-relaxed">
            <div className="flex items-start gap-2">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-amber-500 text-[11px] font-semibold text-black">{o.rank}</span>
              <div className="min-w-0">
                <p className="font-semibold">{o.title}</p>
                <p className="text-muted-foreground">{o.where.area}{o.where.state ? `, ${o.where.state}` : ""} · sites {o.where.supporting_site_ids.join(", ")}</p>
                <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">Synthetic data · assumption-based potential</p>
              </div>
            </div>
            {verdict ? (
              <div className={`mt-2 rounded-md border p-2 ${VERDICT_STYLE[verdict.label]}`}>
                <p className="font-semibold">Network feasibility: {verdict.label}</p>
                <ul className="list-disc pl-4">{verdict.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              </div>
            ) : (
              <p className="mt-2 rounded-md border border-dashed p-2 text-muted-foreground">Network feasibility: not yet validated by agents.</p>
            )}
            <p className="mt-2 font-medium">Why</p>
            <ul className="list-disc space-y-0.5 pl-4">{o.why.map((line) => <li key={line}>{line}</li>)}</ul>
            <p className="mt-2 font-medium">What TM should do</p>
            <p>{o.what_tm_should_do}</p>
            <p className="mt-2"><span className="font-medium">Indicative potential:</span> {rm(low)}–{rm(high)} / month <span className="text-muted-foreground">({o.commercial_potential.assumption_basis}; indicative, synthetic assumptions, not verified revenue)</span></p>
            <p className="mt-1"><span className="font-medium">Graph confidence:</span> {o.confidence_label} ({Math.round(o.confidence * 100)}%) · score {o.scores.overall.toFixed(2)} (demand {o.scores.demand.toFixed(2)}, feasibility {o.scores.feasibility.toFixed(2)})</p>
            <p className="mt-2 font-medium">Risks</p>
            <ul className="list-disc space-y-0.5 pl-4 text-amber-800 dark:text-amber-300">{o.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul>
          </article>
        );
      })}
      <p className="text-xs leading-relaxed text-muted-foreground">{discovery.data.limitations.join(" ")}</p>
    </div>
  );
}
