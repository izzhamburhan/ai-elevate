import type { ComponentProps, ReactNode } from "react";

import { Wordmark as SharedWordmark } from "@/components/wordmark";
import { cn } from "@/lib/utils";

/** Section links shared by the top nav and the footer. */
export const NAV_LINKS = [
  { href: "#product", label: "Product" },
  { href: "#self-heal", label: "Self-heal" },
  { href: "#connectors", label: "Connectors" },
  { href: "#safety", label: "Safety" },
  { href: "#faq", label: "FAQ" },
];

/** Logo glyph + serif name in the site's ink. The workspace top bar uses the same mark. */
export function Wordmark({ className }: { className?: string }) {
  return <SharedWordmark className={cn("text-mk-fg", className)} />;
}

/** Small rounded pill for metadata (layer type, source MCP, status). */
export function Chip({ children, className, tone = "neutral" }: { children: ReactNode; className?: string; tone?: "neutral" | "green" | "amber" | "red" | "blue" | "magenta" }) {
  const tones = {
    neutral: "border-mk-line-strong bg-mk-fg/[0.06] text-mk-fg",
    green: "border-mk-green/30 bg-mk-green/10 text-mk-green",
    amber: "border-mk-amber/30 bg-mk-amber/10 text-mk-amber",
    red: "border-mk-red/35 bg-mk-red/10 text-mk-red",
    blue: "border-mk-blue/35 bg-mk-blue/10 text-mk-blue",
    magenta: "border-mk-magenta/35 bg-mk-magenta/10 text-mk-magenta",
  };
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium whitespace-nowrap [&_svg]:size-3", tones[tone], className)}>
      {children}
    </span>
  );
}

/**
 * Pill link. `brand` is the lavender primary CTA, `primary` is ink-on-paper (inverted on dark),
 * `ghost` is a hairline outline.
 */
export function PillLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"a"> & { variant?: "brand" | "primary" | "ghost"; size?: "md" | "lg" }) {
  return (
    <a
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors [&_svg]:size-4",
        size === "lg" ? "h-12 px-6 text-base" : "h-11 px-5 text-[15px]",
        variant === "brand" && "bg-mk-brand text-mk-brand-fg hover:bg-[#cdb6ff]",
        variant === "primary" && "bg-mk-fg text-mk-on-fg hover:bg-mk-fg/85",
        variant === "ghost" && "border border-mk-line-strong text-mk-fg hover:bg-mk-fg/[0.08]",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Section eyebrow + headline + subhead. Ideogram keeps the serif for the hero only; section
 * headings are a medium-weight sans.
 */
export function SectionHeading({ eyebrow, title, children, align = "left", id }: { eyebrow?: string; title: ReactNode; children?: ReactNode; align?: "left" | "center"; id?: string }) {
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center")}>
      {eyebrow && <p className="mb-3 text-[13px] tracking-[0.04em] text-mk-muted uppercase">{eyebrow}</p>}
      <h2 id={id} className="text-[2rem] leading-[1.1] font-medium tracking-[-0.025em] text-balance text-mk-fg sm:text-[2.6rem]">
        {title}
      </h2>
      {children && <p className="mt-4 text-[17px] leading-relaxed text-pretty text-mk-muted sm:text-lg">{children}</p>}
    </div>
  );
}

/** Card used for the product mocks. Paper on light sections, graphite inside `.mk-dark`. */
export function MockCard({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("rounded-2xl border border-mk-line bg-mk-raised shadow-[0_24px_60px_-28px_rgba(0,0,0,0.35)]", className)} {...props}>
      {children}
    </div>
  );
}
