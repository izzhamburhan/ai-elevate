"use client";

import type { Discovery } from "@/lib/opportunities/contracts";

const rm = (value: number) => `RM ${value.toLocaleString("en-MY", { maximumFractionDigits: 0 })}`;

/** Ranked Telco Opportunity Graph findings: where, why, what TM should do, potential, confidence and risks. */
export function OpportunityCards({ discovery }: { discovery: Discovery }) {
  return (
    <div className="space-y-2" aria-label="Ranked opportunities">
      {discovery.data.opportunities.map((o) => {
        const [low, high] = o.commercial_potential.indicative_monthly_recurring_rm;
        return (
          <article key={o.opportunity_id} className="rounded-lg border p-3 text-xs leading-relaxed">
            <div className="flex items-start gap-2">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-amber-500 text-[11px] font-semibold text-black">{o.rank}</span>
              <div className="min-w-0">
                <p className="font-semibold">{o.title}</p>
                <p className="text-muted-foreground">{o.where.area}{o.where.state ? `, ${o.where.state}` : ""} · sites {o.where.supporting_site_ids.join(", ")}</p>
              </div>
            </div>
            <p className="mt-2 font-medium">Why</p>
            <ul className="list-disc space-y-0.5 pl-4">{o.why.map((line) => <li key={line}>{line}</li>)}</ul>
            <p className="mt-2 font-medium">What TM should do</p>
            <p>{o.what_tm_should_do}</p>
            <p className="mt-2"><span className="font-medium">Indicative potential:</span> {rm(low)}–{rm(high)} / month <span className="text-muted-foreground">({o.commercial_potential.assumption_basis}; indicative, synthetic assumptions, not verified revenue)</span></p>
            <p className="mt-1"><span className="font-medium">Confidence:</span> {o.confidence_label} ({Math.round(o.confidence * 100)}%) · score {o.scores.overall.toFixed(2)} (demand {o.scores.demand.toFixed(2)}, feasibility {o.scores.feasibility.toFixed(2)})</p>
            <p className="mt-2 font-medium">Risks</p>
            <ul className="list-disc space-y-0.5 pl-4 text-amber-800 dark:text-amber-300">{o.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul>
          </article>
        );
      })}
      <p className="text-xs leading-relaxed text-muted-foreground">{discovery.data.limitations.join(" ")}</p>
    </div>
  );
}
