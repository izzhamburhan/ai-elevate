import {
  Activity,
  ArrowRight,
  Boxes,
  Building2,
  CalendarDays,
  Check,
  ChartNoAxesCombined,
  Clock,
  CloudLightning,
  Drone,
  Footprints,
  Gauge,
  KeyRound,
  Leaf,
  Map as MapIcon,
  MapPin,
  Megaphone,
  Network,
  Plus,
  Power,
  RadioTower,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Ticket,
  Truck,
  Undo2,
  Waves,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { ApprovalCard } from "./approval-card";
import { AreaDemo } from "./area-demo";
import { HeroBackdrop } from "./hero-backdrop";
import { LiquidArt } from "./liquid-art";
import { MapArt } from "./map-art";
import { PillLink, SectionHeading, Wordmark } from "./primitives";
import { PromptBar } from "./prompt-bar";
import { Reveal } from "./reveal";
import { SelfHealDemo } from "./self-heal-demo";

function Points({ items }: { items: string[] }) {
  return (
    <ul className="mt-7 space-y-3">
      {items.map((it) => (
        <li key={it} className="flex gap-3 text-[16px] text-mk-muted">
          <Check className="mt-1 size-4 shrink-0 text-mk-green" aria-hidden="true" />
          {it}
        </li>
      ))}
    </ul>
  );
}

/* ----------------------------------------------------------------------------------------- */
/* Self-heal + Map & area                                                                     */
/* ----------------------------------------------------------------------------------------- */

export function SelfHealSection() {
  return (
    <section id="self-heal" aria-labelledby="self-heal-title" className="mk-dark relative isolate overflow-hidden bg-mk-bg px-4 py-24 sm:px-6 lg:py-32">
      <div aria-hidden="true" className="pointer-events-none absolute -top-48 right-[-10%] -z-10 size-[640px] rounded-full bg-[#6d3df5]/18 blur-3xl" />
      <div className="mx-auto max-w-7xl">
        <div className="grid items-center gap-14 lg:grid-cols-[1fr_1.15fr]">
          <Reveal className="min-w-0">
            <SectionHeading eyebrow="Self-heal" title="A closed loop you can watch, from alarm to all-clear." id="self-heal-title">
              A storm floods a tower. Elevate traces who is affected, tests a fix in a digital twin, waits for a human yes, applies it, and checks it worked. If it
              did not help, it rolls back and tries again.
            </SectionHeading>
            <Points
              items={[
                "Eight visible stages: detect, diagnose, simulate, approve, apply, verify, roll back, recover",
                "Watches neighbour load against an 85% threshold after every change",
                "Emergency sites nearby? A human must approve before anything moves",
              ]}
            />
          </Reveal>
          <Reveal delay={120} className="min-w-0">
            <SelfHealDemo />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export function AreaSection() {
  return (
    <section id="area" aria-labelledby="area-title" className="px-4 py-24 sm:px-6 lg:py-32">
      <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[1.15fr_1fr]">
        <Reveal delay={120} className="order-2 lg:order-1">
          <AreaDemo />
        </Reveal>
        <Reveal className="order-1 lg:order-2">
          <SectionHeading eyebrow="Map & area" title="Drop a circle anywhere. See everything inside it." id="area-title">
            Pick a city, use the map centre, or click the map. Set a radius from 1 to 50 km. The card counts towers by status, estimates head count, lists the top
            apps, and draws a subscriber&apos;s trail with their routines from the last 4 weeks.
          </SectionHeading>
          <Points
            items={["Home, weekday and weekend places, all drawn on the map", "Hashed IDs and cell-level location only", "Any group under 5 people is withheld"]}
          />
        </Reveal>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------------------------- */
/* Connectors: lavender band                                                                  */
/* ----------------------------------------------------------------------------------------- */

const CONNECTORS: { name: string; desc: string; icon: LucideIcon }[] = [
  { name: "tower", desc: "Tower status, alarms and KPIs", icon: RadioTower },
  { name: "ran", desc: "RAN changes: tilt, reset, rollback", icon: SlidersHorizontal },
  { name: "netops", desc: "Coverage, tickets, BIN, next-best action", icon: ChartNoAxesCombined },
  { name: "flood", desc: "River gauges and flood extent", icon: Waves },
  { name: "weather", desc: "Rain, wind and lightning", icon: CloudLightning },
  { name: "sensors", desc: "Smart-city sensors", icon: Gauge },
  { name: "grid", desc: "Power grid feeders", icon: Zap },
  { name: "field", desc: "Technician dispatch by road or boat", icon: Truck },
  { name: "drone", desc: "Drone tower inspections", icon: Drone },
  { name: "ticket", desc: "Trouble tickets", icon: Ticket },
  { name: "energy", desc: "Energy, CO2 and cell sleep modes", icon: Leaf },
  { name: "care", desc: "Outage notices in four languages", icon: Megaphone },
  { name: "enterprise", desc: "Enterprise SLAs and credits", icon: Building2 },
  { name: "exposure", desc: "Quality-on-demand bookings", icon: Activity },
  { name: "events", desc: "Crowd events", icon: CalendarDays },
  { name: "scam", desc: "Scam-call shield", icon: ShieldAlert },
  { name: "usage", desc: "App usage by area", icon: Smartphone },
  { name: "user", desc: "Subscriber trails and routines, hashed", icon: Footprints },
  { name: "sites", desc: "Site records and critical sites", icon: MapPin },
  { name: "ontology", desc: "Links towers to neighbours, feeders, gauges and sites", icon: Network },
  { name: "twin", desc: "Digital twin: simulate before acting", icon: Boxes },
  { name: "policy", desc: "Allow, ask a human or deny", icon: ShieldCheck },
  { name: "demo", desc: "Scenario clock that fast-forwards time", icon: Clock },
];

/** One step of the sample trace: real tool names from the Menara and NetOps servers. */
const TRACE: { tool: string; args: string; result: string; warn?: boolean }[] = [
  { tool: "tower_get_status", args: 'enodeb_name="TWR-KB-031"', result: "outage · 3 alarms" },
  { tool: "flood_check_point", args: "…", result: "inside flood extent · gauge 4.2 m ▲" },
  { tool: "ontology_blast_radius", args: "…", result: "feeder F-12 · 1 hospital (synthetic) · 2,814 subscribers" },
  { tool: "twin_simulate_tilt", args: "…", result: "neighbour load 96% → 82%" },
  { tool: "policy_check_action", args: "…", result: "ask_human · emergency site within 2 km", warn: true },
];

export function ConnectorsBand() {
  return (
    <section id="connectors" aria-labelledby="connectors-title" className="mk-lavender bg-mk-bg px-4 py-24 sm:px-6 lg:py-28">
      <div className="mx-auto max-w-7xl">
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
          <Reveal className="min-w-0">
            <SectionHeading eyebrow="Connectors" title="One protocol, every domain" id="connectors-title">
              Each domain is its own MCP server. The assistant picks the tools it needs, runs them, and draws what comes back. Add your own server and it joins the
              same loop.
            </SectionHeading>
            <ul className="mt-7 space-y-3 text-[16px] text-mk-fg">
              {[
                "24 built-in connectors: 23 domains plus the kepler.gl map.",
                "Switch connectors, or single tools, on and off per chat.",
                "Add any MCP server by URL, with an optional bearer token.",
                "Up to 50 connectors in one chat.",
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-[9px] size-[7px] shrink-0 rounded-full border-[1.5px] border-mk-fg" aria-hidden="true" />
                  {t}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap gap-2">
              <PillLink href="/workspace">Open workspace</PillLink>
              <PillLink href="#faq" variant="ghost">
                Read the FAQ
              </PillLink>
            </div>
          </Reveal>

          <Reveal delay={100} className="min-w-0">
            <figure className="mk-dark overflow-hidden rounded-xl bg-[#16121f] shadow-[0_30px_70px_-30px_rgba(31,27,45,0.7)]">
              <figcaption className="border-b border-mk-line px-5 py-3.5 font-mono text-[13px] text-mk-muted">Tool calls · one question</figcaption>
              <div className="overflow-x-auto px-5 py-5 font-mono text-[12.5px] leading-[1.9]">
                <p className="text-mk-faint">› &quot;Towers near Kota Bharu are flooding. Who is affected?&quot;</p>
                {TRACE.map((t) => (
                  <div key={t.tool} className="mt-2 whitespace-nowrap">
                    <span className="text-[#c7b3ff]">{t.tool}</span>
                    <span className="text-mk-faint">(</span>
                    <span className="text-[#9ee6b8]">{t.args}</span>
                    <span className="text-mk-faint">)</span>
                    <div className={t.warn ? "pl-4 text-[#ffcf7a]" : "pl-4 text-mk-muted"}>→ {t.result}</div>
                  </div>
                ))}
              </div>
            </figure>
          </Reveal>
        </div>

        <Reveal className="mt-16">
          <ul className="flex flex-wrap gap-2" aria-label="Built-in connectors">
            {CONNECTORS.map((c) => (
              <li key={c.name} title={c.desc} className="inline-flex h-9 items-center gap-2 rounded-full bg-mk-raised px-3.5 text-sm text-mk-fg">
                <c.icon className="size-3.5" aria-hidden="true" />
                <span className="font-mono">{c.name}</span>
                <span className="sr-only">: {c.desc}</span>
              </li>
            ))}
            <li className="inline-flex h-9 items-center gap-2 rounded-full bg-mk-raised px-3.5 text-sm text-mk-fg">
              <MapIcon className="size-3.5" aria-hidden="true" />
              <span className="font-mono">kepler</span>
              <span className="sr-only">: the map itself</span>
            </li>
            <li className="inline-flex h-9 items-center gap-2 rounded-full border border-dashed border-mk-line-strong px-3.5 text-sm text-mk-fg">
              <Plus className="size-3.5" aria-hidden="true" />
              Your MCP server
            </li>
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------------------------- */
/* Safety: dark band, Ideogram's enterprise layout                                            */
/* ----------------------------------------------------------------------------------------- */

const SAFETY: { icon: LucideIcon; title: string }[] = [
  { icon: KeyRound, title: "Signed, single-use action tokens" },
  { icon: Power, title: "Kill switch for all automated changes" },
  { icon: ScrollText, title: "Audit log of every call and decision" },
  { icon: Undo2, title: "Automatic rollback when a change does not help" },
];

const AUDIT = [
  ["14:02:11", "policy_check_action", "ask_human · Hospital (synthetic) 1.2 km"],
  ["14:03:40", "approved", "duty engineer · token at_7f3a…e1c4"],
  ["14:13:40", "verify", "load 96% > 85% · rolled back"],
  ["14:16:02", "verify", "load 76% · incident resolved"],
];

export function SafetyBand() {
  return (
    <section id="safety" aria-labelledby="safety-title" className="mk-dark bg-mk-bg px-4 py-24 sm:px-6 lg:py-28">
      <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
        <Reveal className="flex min-w-0 flex-col">
          <SectionHeading eyebrow="Safety" title="Nothing moves until it is simulated, checked and signed." id="safety-title">
            Every change runs in a digital twin first. A policy engine then allows it, asks a human, or denies it. Near hospitals, clinics, police or fire stations, a
            human must always approve.
          </SectionHeading>
          <div className="mt-8 flex flex-wrap gap-2">
            <PillLink href="/workspace">Open workspace</PillLink>
            <PillLink href="#faq" variant="ghost">
              Read the FAQ
            </PillLink>
          </div>
          <ul className="mt-10 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {SAFETY.map((s) => (
              <li key={s.title} className="flex gap-3 text-[15px] text-mk-muted">
                <s.icon className="mt-0.5 size-4 shrink-0 text-mk-fg" aria-hidden="true" />
                {s.title}
              </li>
            ))}
          </ul>
          <figure className="mt-auto pt-12">
            <figcaption className="text-[13px] tracking-[0.04em] text-mk-muted uppercase">From the audit log</figcaption>
            <div className="mt-4 space-y-1.5 overflow-x-auto font-mono text-[12.5px] whitespace-nowrap">
              {AUDIT.map(([time, what, detail]) => (
                <p key={time} className="text-mk-muted">
                  <span className="text-mk-faint">{time}</span> <span className="text-mk-fg">{what}</span> · {detail}
                </p>
              ))}
            </div>
          </figure>
        </Reveal>

        <Reveal delay={100} className="min-w-0">
          <div className="grid gap-3">
            <figure className="mk-grain relative aspect-[2/1] overflow-hidden rounded-lg bg-[#060709]">
              <MapArt layer="sector" seed={7} uid="safety-twin" w={800} h={400} slice className="absolute inset-0 h-full w-full" />
              <figcaption className="absolute bottom-3 left-3 rounded-full bg-mk-bg/80 px-2.5 py-1 text-xs text-mk-fg backdrop-blur">
                Digital twin · tilt simulated before anything moves
              </figcaption>
            </figure>
            <ApprovalCard />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------------------------- */
/* Tools band, CTA, footer                                                                    */
/* ----------------------------------------------------------------------------------------- */

/**
 * Light strip under the hero, where Ideogram lists customers; we list the open tools Elevate runs on.
 * On wide screens it is exactly 7.5rem tall, the space the hero leaves free in the first screen.
 */
export function ToolsBand() {
  const tools = [
    { name: "kepler.gl", className: "font-semibold tracking-tight" },
    { name: "Model Context Protocol", className: "font-mono text-[15px]" },
    { name: "deck.gl", className: "font-medium" },
    { name: "H3", className: "font-display text-2xl font-medium" },
    { name: "DeepSeek", className: "font-semibold tracking-tight" },
    { name: "OpenAI", className: "font-medium tracking-tight" },
    { name: "Ollama", className: "font-display text-xl italic" },
  ];
  return (
    <section aria-label="Built on" className="flex items-center border-b border-mk-line px-4 py-8 sm:px-6 lg:h-[7.5rem] lg:py-0">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 lg:flex-row lg:items-center lg:gap-14">
        <p className="max-w-[16rem] shrink-0 text-[15px] leading-snug text-mk-fg">Built on open tools and the models you already use</p>
        <ul className="flex flex-wrap items-center gap-x-10 gap-y-3 text-lg text-mk-fg/75">
          {tools.map((t) => (
            <li key={t.name} className={t.className}>
              {t.name}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function CtaBand() {
  return (
    <section aria-labelledby="cta-title" className="mk-dark relative isolate overflow-hidden bg-mk-bg px-4 py-28 text-center sm:px-6 lg:py-40">
      <div className="mk-grain absolute inset-0 -z-10">
        <LiquidArt className="absolute inset-0">
          <HeroBackdrop uid="cta-art" className="absolute inset-0 h-full w-full" />
        </LiquidArt>
      </div>
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(60%_70%_at_50%_45%,rgba(4,5,9,0.78),rgba(4,5,9,0.35))]" />
      <Reveal className="mx-auto max-w-3xl">
        <h2 id="cta-title" className="font-display text-5xl leading-[1] font-normal tracking-[-0.035em] text-balance text-mk-fg sm:text-7xl">
          Your whole network, one question away.
        </h2>
        <div className="mx-auto mt-12 max-w-2xl">
          <PromptBar />
        </div>
        <PillLink href="/workspace" variant="brand" size="lg" className="mt-10">
          Open workspace
          <ArrowRight aria-hidden="true" />
        </PillLink>
      </Reveal>
    </section>
  );
}

const FOOTER_COLUMNS: { title: string; links: { label: string; href?: string }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Ask", href: "#ask" },
      { label: "Self-heal", href: "#self-heal" },
      { label: "Map & area", href: "#area" },
      { label: "Safety", href: "#safety" },
    ],
  },
  {
    title: "Connectors",
    links: [{ label: "Network" }, { label: "Environment" }, { label: "Operations" }, { label: "Customers" }, { label: "Bring your own", href: "#connectors" }],
  },
  {
    title: "Models",
    links: [{ label: "DeepSeek" }, { label: "OpenAI" }, { label: "Gemma 4 via Ollama" }, { label: "OpenAI-compatible" }],
  },
  {
    title: "Resources",
    links: [
      { label: "Workspace", href: "/workspace" },
      { label: "Sign in", href: "/sign-in" },
      { label: "Create an account", href: "/sign-up" },
      { label: "FAQ", href: "#faq" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="bg-[linear-gradient(to_bottom,var(--mk-bg)_55%,#f8f1ec_82%,#efe2f4)] px-4 pt-20 pb-16 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_2fr]">
          <div>
            <Wordmark />
            <p className="mt-4 max-w-xs text-[16px] leading-relaxed text-mk-muted">One workspace from question to fix.</p>
            <PillLink href="/workspace" variant="ghost" className="mt-6">
              Open workspace
            </PillLink>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-10 sm:grid-cols-4">
            {FOOTER_COLUMNS.map((col) => (
              <div key={col.title}>
                <p className="text-[15px] font-medium text-mk-fg">{col.title}</p>
                <ul className="mt-4 space-y-3 text-[15px]">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      {l.href ? (
                        <a href={l.href} className="text-mk-muted transition-colors hover:text-mk-fg">
                          {l.label}
                        </a>
                      ) : (
                        <span className="text-mk-muted">{l.label}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="mt-16 border-t border-mk-line pt-8 text-sm text-mk-muted">
          © 2026 Elevate. Demo data is synthetic. Nothing real-world is changed.
        </div>
      </div>
    </footer>
  );
}
