import { EXAMPLE_PROMPTS } from "@/lib/example-prompts";

import { MapArt, type MapLayer, type RampName } from "./map-art";
import { SectionHeading } from "./primitives";
import { PromptBar } from "./prompt-bar";
import { Reveal } from "./reveal";

type Step = {
  id: string;
  prompt: string;
  layer: MapLayer;
  layerLabel: string;
  mcp: string;
  seed: number;
  ramp?: RampName;
  coast?: boolean;
  /** Tilt the map back like kepler.gl's 3D view, with a horizon glow. */
  pitch?: boolean;
};

/** One incident, four questions, in the order an operator would ask them. */
const STORY: Step[] = [
  { id: "s1", prompt: EXAMPLE_PROMPTS[0], layer: "flood", layerLabel: "Flood extent", mcp: "flood-mcp", seed: 61, coast: true },
  { id: "s2", prompt: EXAMPLE_PROMPTS[1], layer: "graph", layerLabel: "Graph", mcp: "ontology-mcp", seed: 83 },
  { id: "s3", prompt: EXAMPLE_PROMPTS[2], layer: "hexbin", layerLabel: "Hexbin", mcp: "tower-mcp", seed: 11, pitch: true },
  { id: "s4", prompt: EXAMPLE_PROMPTS[3], layer: "route", layerLabel: "Route", mcp: "field-mcp", seed: 41 },
];

const H = 500;

function StoryTile({ step, n }: { step: Step; n: number }) {
  const art = { layer: step.layer, seed: step.seed, uid: step.id, h: H, ramp: step.ramp, coast: step.coast };
  return (
    <a href={`/workspace?q=${encodeURIComponent(step.prompt)}`} className="group block rounded-2xl">
      <span className="mk-grain relative block aspect-[4/5] overflow-hidden rounded-2xl bg-[#060709]">
        <span className="absolute inset-0 transition-transform duration-700 ease-out group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100">
          {step.pitch && <span className="absolute inset-0 bg-[radial-gradient(130%_55%_at_50%_0%,#2a1d52,#0b0d18_55%,#060709)]" />}
          <MapArt
            {...art}
            slice
            className={
              step.pitch
                ? "absolute inset-0 h-full w-full origin-bottom [mask-image:linear-gradient(to_bottom,transparent,black_38%)] [transform:perspective(640px)_rotateX(42deg)_scale(1.45)]"
                : "absolute inset-0 h-full w-full"
            }
          />
        </span>
      </span>
      <span className="mt-4 block px-0.5">
        <span className="block font-mono text-xs text-mk-faint">0{n}</span>
        <span className="sr-only">Try this prompt: </span>
        <span className="mt-1.5 block text-[16px] leading-snug text-mk-fg">{step.prompt}</span>
        <span className="mt-1.5 block text-[13px] text-mk-muted">
          {step.layerLabel} · <span className="font-mono text-xs">{step.mcp}</span>
        </span>
      </span>
    </a>
  );
}

/** Prompt bar, then one flood told as four questions; each map opens the workspace with its prompt. */
export function AskSection() {
  return (
    <section id="ask" aria-labelledby="ask-title" className="border-t border-mk-line px-4 py-24 sm:px-6 lg:py-28">
      <Reveal className="mx-auto max-w-3xl">
        <SectionHeading eyebrow="Ask" title="Ask in plain words. Get a live map back." align="center" id="ask-title">
          One flood in Kota Bharu, four questions. Each map is what the assistant drew for the question under it. Pick one to try it in the workspace.
        </SectionHeading>
        <PromptBar className="mt-10" />
      </Reveal>

      <Reveal delay={100} className="mx-auto mt-16 max-w-7xl">
        {/* On phones the row scrolls sideways. Paint containment stops Chrome from widening the page
            to fit the off-screen tiles' glow and grain layers. */}
        <ol
          aria-label="One flood, four questions"
          className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] max-md:[contain:paint] sm:-mx-6 sm:scroll-px-6 sm:px-6 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0 [&::-webkit-scrollbar]:hidden"
        >
          {STORY.map((s, i) => (
            <li key={s.id} className="w-[78%] shrink-0 snap-start sm:w-[45%] md:w-auto">
              <StoryTile step={s} n={i + 1} />
            </li>
          ))}
        </ol>
      </Reveal>
    </section>
  );
}