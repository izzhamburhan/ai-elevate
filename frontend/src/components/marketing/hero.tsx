import { ArrowRight } from "lucide-react";

import { HeroBackdrop, hasHeroPhoto } from "./hero-backdrop";
import { HeroDemo } from "./hero-demo";
import { LiquidArt } from "./liquid-art";
import { PillLink } from "./primitives";

/**
 * The art's box. A photo fills the hero and crops itself (object-position); the generated city is
 * right-anchored and wider on small screens so the city stays in frame.
 */
const PHOTO_BOX = "mk-drift absolute inset-0 h-full w-full";
const SVG_BOX = "mk-drift absolute inset-y-0 right-0 h-full w-[220%] max-w-none sm:w-[150%] lg:w-full";

/**
 * Full-bleed cinematic hero: art behind, serif headline bottom-left, demo card bottom-right.
 * Layers, back to front: art (with the liquid warp), grain, scrims, content, oil-slick sheen.
 * It is 7.5rem shorter than the screen so the "Built on" strip (ToolsBand, 7.5rem) shows below it,
 * like Ideogram's logo row; keep the two numbers in step.
 */
export function Hero() {
  const photo = hasHeroPhoto();
  const box = photo ? PHOTO_BOX : SVG_BOX;
  return (
    <section
      id="top"
      aria-labelledby="hero-title"
      className="mk-dark relative isolate flex h-[calc(100svh-7.5rem)] min-h-[560px] max-h-[900px] items-end overflow-hidden bg-mk-bg"
    >
      <LiquidArt className={`${box} -z-10`} overlayClassName={`${box} z-10`}>
        <HeroBackdrop uid="hero" priority className="absolute inset-0 h-full w-full" />
      </LiquidArt>
      <div aria-hidden="true" className="mk-grain absolute inset-0 -z-10" />
      {/* Scrims: top for the nav, bottom and left for the headline and copy. */}
      <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-40 bg-linear-to-b from-black/55 to-transparent" />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(to_top,rgba(4,5,9,0.92)_0%,rgba(4,5,9,0.55)_30%,transparent_60%)]" />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgba(4,5,9,0.8)_0%,rgba(4,5,9,0.45)_38%,transparent_64%)]" />

      <div className="relative mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 lg:pb-20">
        <div className="max-w-[60rem]">
          <a href="#new" className="group inline-flex items-center gap-2 text-xs font-medium tracking-[0.08em] text-mk-fg/85 uppercase transition-colors hover:text-mk-fg">
            <span className="rounded bg-mk-brand px-1.5 py-0.5 text-[10px] tracking-normal text-mk-brand-fg normal-case">New</span>
            Self-heal cards in chat
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </a>
          <h1
            id="hero-title"
            className="mt-5 font-display text-[2.9rem] leading-[1] font-normal tracking-[-0.035em] text-balance text-mk-fg sm:text-6xl lg:text-[5rem] xl:text-[5.4rem]"
          >
            <span className="block">Ask your network anything.</span>
            <span className="block">Watch it heal itself.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-pretty text-mk-fg/85 sm:text-lg">
            A live map with an AI assistant that finds, explains and fixes network problems. You approve every risky step.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <PillLink href="/workspace" variant="brand" size="lg">
              Open workspace
            </PillLink>
            <PillLink href="#ask" variant="ghost" size="lg">
              Try a prompt
            </PillLink>
            <div className="xl:hidden">
              <HeroDemo variant="button" />
            </div>
          </div>
        </div>

        <div className="absolute right-6 bottom-20 hidden xl:block">
          <HeroDemo variant="card" />
        </div>
      </div>
    </section>
  );
}
