import { Minus, Plus } from "lucide-react";

import { Reveal } from "./reveal";

const FAQS = [
  {
    q: "What is Elevate?",
    a: "A map workspace with an AI assistant beside it. Ask about your network in plain language; the assistant calls domain tools, draws the answer on a kepler.gl map, and can propose and run fixes with a human in the loop.",
  },
  {
    q: "Which models can I use?",
    a: "DeepSeek, OpenAI, or a local model: Gemma 4 through Ollama, or any OpenAI-compatible server. You can switch per chat.",
  },
  {
    q: "What are connectors?",
    a: "Each domain (towers, RAN changes, floods, weather, power, field crews, care notices and more) is its own MCP server. Turn them on or off per chat, or add any MCP server by URL as a custom connector.",
  },
  {
    q: "Can it change the live network?",
    a: "Not in this demo. Demo data is synthetic and every action runs against a simulated network. Changes are always simulated in the digital twin first, checked by the policy engine, and need a human yes near emergency sites.",
  },
  {
    q: "What happens if a fix does not help?",
    a: "Self-heal watches the neighbour load against an 85% threshold after each change. If the change did not help, it rolls back automatically, logs why, and tries the next option.",
  },
  {
    q: "How is subscriber privacy protected?",
    a: "Subscriber IDs are hashed, locations are cell-level only, and any group under 5 people is withheld from results.",
  },
  {
    q: "What is the scenario clock?",
    a: "A demo connector that fast-forwards time, so a drone inspection or a 10-minute tilt check finishes instantly instead of in real time.",
  },
];

/** Two-column FAQ: heading left, native <details> accordion right (works without JS). */
export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="px-4 py-24 sm:px-6 lg:py-28">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
        <Reveal>
          <h2 id="faq-title" className="text-[2rem] leading-[1.1] font-medium tracking-[-0.025em] text-mk-fg sm:text-[2.6rem]">
            Frequently asked
            <br />
            questions
          </h2>
        </Reveal>
        <Reveal delay={80}>
          <div className="border-t border-mk-line">
            {FAQS.map((f, i) => (
              <details key={f.q} name="faq" open={i === 0} className="group border-b border-mk-line">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-[17px] font-medium text-mk-fg [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <Plus className="size-4 shrink-0 group-open:hidden" aria-hidden="true" />
                  <Minus className="hidden size-4 shrink-0 group-open:block" aria-hidden="true" />
                </summary>
                <p className="max-w-2xl pb-7 text-[16px] leading-relaxed text-mk-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
