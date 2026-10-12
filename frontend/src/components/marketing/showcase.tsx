import { Check, Layers, Minus, Plus, Wrench } from "lucide-react";

import { MapArt } from "./map-art";
import { PillLink, Wordmark } from "./primitives";
import { Reveal } from "./reveal";

const TOOLS = ["tower_get_status", "flood_check_point", "ontology_blast_radius", "twin_simulate_tilt", "policy_check_action"];
const STAGES = ["Detect", "Diagnose", "Simulate", "Approve", "Apply", "Verify", "Roll back", "Recover"];

/** "Introducing" block: centred announcement over a large mock of the workspace (map + chat). */
export function Showcase() {
  return (
    <section id="new" aria-labelledby="new-title" className="px-4 pb-24 sm:px-6 lg:pb-28">
      <Reveal className="mx-auto max-w-2xl text-center">
        <span className="inline-flex h-6 items-center rounded-md bg-mk-brand px-2 text-xs font-medium text-mk-brand-fg">New</span>
        <h2 id="new-title" className="mt-4 text-[2rem] leading-[1.1] font-medium tracking-[-0.025em] text-balance text-mk-fg sm:text-[2.6rem]">
          Answers that act, right in the chat
        </h2>
        <p className="mt-4 text-[17px] leading-relaxed text-pretty text-mk-muted sm:text-lg">
          Self-heal and Map &amp; area now arrive as live cards inside the chat answer, next to the map layers they draw.
        </p>
        <PillLink href="/workspace" className="mt-7">
          Open workspace
        </PillLink>
      </Reveal>

      <Reveal delay={100} className="mx-auto mt-14 max-w-7xl">
        <div className="rounded-lg bg-mk-surface px-3 py-8 sm:px-10 sm:py-14 lg:px-16">
          <figure aria-label="The Elevate workspace: a flood map with the chat beside it" className="overflow-hidden rounded-xl border border-mk-line bg-mk-raised shadow-[0_30px_80px_-30px_rgba(31,27,45,0.45)]">
            {/* Window bar */}
            <div className="flex h-11 items-center justify-between gap-3 border-b border-mk-line px-4">
              <div className="flex min-w-0 items-center gap-3">
                <Wordmark className="scale-[0.72] origin-left" />
                <span className="hidden truncate text-xs text-mk-faint sm:inline">Kota Bharu flood · demo scenario</span>
              </div>
              <div className="flex shrink-0 gap-1.5 text-[11px] text-mk-muted">
                <span className="rounded-full border border-mk-line px-2 py-0.5">Gemma 4 (local)</span>
                <span className="hidden rounded-full border border-mk-line px-2 py-0.5 sm:inline">24 connectors</span>
              </div>
            </div>

            <div className="grid lg:grid-cols-[minmax(0,1fr)_380px]">
              {/* Map */}
              <div className="relative aspect-[4/3] bg-[#060709] lg:aspect-auto lg:min-h-[540px]">
                <MapArt layer="flood" seed={23} uid="showcase-map" w={800} h={560} coast slice className="absolute inset-0 h-full w-full" />
                <div className="mk-dark absolute top-3 left-3 flex flex-wrap gap-1.5 text-[11px]">
                  {["Flood extent", "Towers by status", "Blast radius"].map((l) => (
                    <span key={l} className="inline-flex items-center gap-1 rounded-full border border-mk-line bg-mk-bg/80 px-2 py-1 text-mk-fg backdrop-blur">
                      <Layers className="size-3" aria-hidden="true" />
                      {l}
                    </span>
                  ))}
                </div>
                <div className="mk-dark absolute right-3 bottom-3 flex flex-col overflow-hidden rounded-lg border border-mk-line bg-mk-bg/80 text-mk-fg backdrop-blur">
                  <span className="grid size-7 place-items-center border-b border-mk-line">
                    <Plus className="size-3.5" aria-hidden="true" />
                  </span>
                  <span className="grid size-7 place-items-center">
                    <Minus className="size-3.5" aria-hidden="true" />
                  </span>
                </div>
              </div>

              {/* Chat */}
              <div className="flex flex-col gap-3 border-t border-mk-line p-4 text-[13px] lg:border-t-0 lg:border-l">
                <p className="ml-auto max-w-[90%] rounded-2xl rounded-br-md bg-mk-surface px-3 py-2 text-mk-fg">
                  Towers near Kota Bharu are flooding. Who is affected and what should we do?
                </p>
                <ul className="flex flex-wrap gap-1" aria-label="Tools called">
                  {TOOLS.map((t) => (
                    <li key={t} className="inline-flex items-center gap-1 rounded-md border border-mk-line px-1.5 py-0.5 font-mono text-[10.5px] text-mk-muted">
                      <Check className="size-3 text-mk-green" aria-hidden="true" />
                      {t}
                    </li>
                  ))}
                </ul>
                <p className="leading-relaxed text-mk-fg">
                  TWR-KB-031 is down after the river gauge passed 4.2 m. Its blast radius covers 2,814 subscribers and one hospital (synthetic). In the twin, a −2° tilt on
                  three neighbours brings their load from 96% to 82%.
                </p>
                <div className="rounded-xl border border-mk-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-medium text-mk-fg">
                      <Wrench className="size-3.5 text-mk-magenta" aria-hidden="true" />
                      Self-heal · TWR-KB-031
                    </span>
                    <span className="rounded-full bg-mk-amber/10 px-2 py-0.5 text-[11px] text-mk-amber">Needs approval</span>
                  </div>
                  <ol className="mt-3 grid grid-cols-8 gap-1" aria-label="Stages">
                    {STAGES.map((s, i) => (
                      <li key={s} title={s} className={`h-1.5 rounded-full ${i < 3 ? "bg-mk-green" : i === 3 ? "bg-mk-amber" : "bg-mk-fg/10"}`}>
                        <span className="sr-only">
                          {s}
                          {i < 3 ? " done" : i === 3 ? " waiting" : ""}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <p className="mt-3 text-xs text-mk-muted">Hospital (synthetic) within 2 km. A human must approve.</p>
                  <div className="mt-3 flex gap-1.5" aria-hidden="true">
                    <span className="inline-flex h-8 items-center rounded-full bg-mk-brand px-3.5 text-xs font-medium text-mk-brand-fg">Approve</span>
                    <span className="inline-flex h-8 items-center rounded-full border border-mk-line-strong px-3.5 text-xs text-mk-fg">Reject</span>
                  </div>
                </div>
              </div>
            </div>
          </figure>
        </div>
      </Reveal>
    </section>
  );
}
