import type { ReactNode } from "react";
import { Check, Sparkles } from "lucide-react";

import { PillLink, SectionHeading } from "./primitives";
import { Reveal } from "./reveal";

/** Frosted-white panel: ink text stays readable on every gradient. */
const GLASS = "border border-white/60 bg-white/72 text-mk-fg shadow-[0_10px_30px_-12px_rgba(31,27,45,0.45)] backdrop-blur-md";

/** A prompt going out and the first tool calls coming back. */
function AskVisual() {
  return (
    <div className="w-[82%] space-y-2.5">
      <div className={`flex items-center gap-2 rounded-full py-1.5 pr-1.5 pl-3 text-[12px] ${GLASS}`}>
        <Sparkles className="size-3.5 shrink-0 text-mk-muted" />
        <span className="truncate">Towers near Kota Bharu are flooding…</span>
        <span className="ml-auto shrink-0 rounded-full bg-mk-brand px-2.5 py-1 text-[11px] font-medium text-mk-brand-fg">Ask</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {["tower_get_status", "flood_check_point"].map((t) => (
          <span key={t} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10.5px] ${GLASS}`}>
            <Check className="size-3 text-mk-green" />
            {t}
          </span>
        ))}
        <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${GLASS}`}>3 map layers</span>
      </div>
    </div>
  );
}

const STAGES = ["Detect", "Diagnose", "Simulate", "Approve", "Apply", "Verify", "Roll back", "Recover"];

/** The eight stages, mid-run, with load falling back under the threshold. */
function HealVisual() {
  return (
    <div className={`w-[82%] rounded-2xl p-3 ${GLASS}`}>
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium">Self-heal · TWR-KB-031</span>
        <span className="rounded-full bg-mk-green/12 px-1.5 py-0.5 text-mk-green">Verifying</span>
      </div>
      <ol className="mt-2 grid grid-cols-4 gap-1">
        {STAGES.map((s, i) => (
          <li
            key={s}
            className={`truncate rounded-full px-1 py-0.5 text-center text-[9.5px] ${i < 5 ? "bg-mk-fg/8 text-mk-fg" : i === 5 ? "bg-mk-fg text-mk-on-fg" : "text-mk-faint"}`}
          >
            {s}
          </li>
        ))}
      </ol>
      <svg viewBox="-4 0 208 44" className="mt-2 block h-auto w-full">
        <line x1="0" x2="200" y1="16" y2="16" stroke="#b45309" strokeDasharray="4 3" strokeWidth="1" />
        <path d="M0,34 L22,32 L40,12 L62,6 L86,8 L110,7 L130,18 L152,28 L176,31 L200,32" fill="none" stroke="#6d4aff" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="200" cy="32" r="3" fill="#6d4aff" />
      </svg>
    </div>
  );
}

/** A radius circle with towers by status and one subscriber's routine pins. */
function AreaVisual() {
  const towers = [
    [62, 48, "#15803d"], [88, 40, "#15803d"], [104, 60, "#b45309"], [74, 74, "#15803d"], [118, 86, "#15803d"],
    [92, 98, "#c81e1e"], [58, 92, "#15803d"], [130, 58, "#15803d"], [100, 120, "#15803d"], [70, 116, "#b45309"],
  ] as const;
  return (
    <div className="relative w-[58%]">
      <svg viewBox="0 0 180 160" className="block h-auto w-full overflow-visible">
        <circle cx="94" cy="80" r="66" fill="rgb(255 255 255 / 0.55)" stroke="#1f1b2d" strokeOpacity="0.5" strokeDasharray="4 4" />
        {towers.map(([x, y, c], i) => (
          <circle key={i} cx={x} cy={y} r="3.2" fill={c} />
        ))}
        <path d="M44,118 C70,104 90,112 112,96 S150,92 160,74" fill="none" stroke="#be185d" strokeWidth="2" strokeDasharray="0.5 5" strokeLinecap="round" />
        {[
          [44, 118, "#0f766e"],
          [112, 96, "#2563eb"],
          [160, 74, "#b45309"],
        ].map(([x, y, c]) => (
          <circle key={String(c)} cx={x} cy={y} r="5" fill={String(c)} stroke="#fff" strokeWidth="2" />
        ))}
      </svg>
      <span className={`absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full px-2.5 py-1 text-[11px] whitespace-nowrap ${GLASS}`}>
        Kota Bharu · 8 km · 79 towers
      </span>
    </div>
  );
}

const CARDS: {
  label: string;
  title: string;
  body: string;
  art: string;
  visual: ReactNode;
  links: { href: string; label: string; variant: "primary" | "ghost" }[];
}[] = [
  {
    label: "Ask the network",
    title: "Ask in plain words, get a live map back.",
    body: "Questions run across 23 domain connectors and come back as kepler.gl layers: hexbins, arcs, H3 cells, flood extents and more.",
    art: "bg-[radial-gradient(70%_60%_at_0%_0%,#f2c36b_0%,transparent_60%),radial-gradient(80%_70%_at_8%_100%,#2f36d8_0%,transparent_62%),radial-gradient(90%_90%_at_70%_30%,#e45cc6_0%,transparent_70%),linear-gradient(135deg,#e690d4,#8d5ae6)]",
    visual: <AskVisual />,
    links: [{ href: "#ask", label: "Try a prompt", variant: "primary" }],
  },
  {
    label: "Self-heal",
    title: "Fix network problems in a loop you can watch.",
    body: "Detect, diagnose, test the fix in a digital twin, get a human yes, apply, verify, and roll back if it did not help.",
    art: "bg-[radial-gradient(60%_80%_at_55%_45%,#a77cf0_0%,transparent_65%),linear-gradient(125deg,#0f2e2a_0%,#2b5a6a_26%,#8a6ad8_50%,#365a78_74%,#0d2b27_100%)]",
    visual: <HealVisual />,
    links: [
      { href: "#self-heal", label: "Watch a run", variant: "primary" },
      { href: "#safety", label: "How it stays safe", variant: "ghost" },
    ],
  },
  {
    label: "Map & area",
    title: "Know who and what is inside any circle.",
    body: "Towers by status, head count, top apps and 4-week routines. Hashed IDs, cell-level location, and groups under 5 withheld.",
    art: "bg-[radial-gradient(70%_70%_at_55%_35%,#efe2fb_0%,transparent_62%),radial-gradient(60%_60%_at_0%_100%,#5b2cf0_0%,transparent_70%),linear-gradient(135deg,#c493f2,#8c4cf0_70%,#cf52e6)]",
    visual: <AreaVisual />,
    links: [{ href: "#area", label: "Drop a circle", variant: "primary" }],
  },
];

/** "One platform, three ways": grainy gradient cards, each with a frosted glimpse of the feature. */
export function Platform() {
  return (
    <section id="product" aria-labelledby="platform-title" className="px-4 py-24 sm:px-6 lg:py-28">
      <div className="mx-auto max-w-7xl">
        <Reveal>
          <SectionHeading
            id="platform-title"
            title={
              <>
                One workspace.
                <br />
                Three ways to run your network.
              </>
            }
          />
        </Reveal>
        <ul className="mt-14 grid gap-6 md:grid-cols-3">
          {CARDS.map((c, i) => (
            <li key={c.label}>
              <Reveal delay={i * 90}>
                <article>
                  <div aria-hidden="true" className={`mk-grain mk-grain-strong relative grid aspect-[3/2] place-items-center overflow-hidden rounded-[22px] ${c.art}`}>
                    <div className="relative z-[1] flex w-full justify-center">{c.visual}</div>
                  </div>
                  <div className="px-1 pt-6 sm:px-3">
                    <p className="text-[13px] tracking-[0.04em] text-mk-muted uppercase">{c.label}</p>
                    <h3 className="mt-2 text-xl leading-snug font-medium tracking-[-0.01em] text-mk-fg">{c.title}</h3>
                    <p className="mt-3 text-[16px] leading-relaxed text-mk-muted">{c.body}</p>
                    <div className="mt-6 flex flex-wrap gap-2">
                      {c.links.map((l) => (
                        <PillLink key={l.label} href={l.href} variant={l.variant}>
                          {l.label}
                        </PillLink>
                      ))}
                    </div>
                  </div>
                </article>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
