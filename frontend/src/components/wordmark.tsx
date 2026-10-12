import { useId } from "react";

import { cn } from "@/lib/utils";

const HEXAGON = "M12 0 22.32 6v12L12 24 1.68 18V6Z";

/**
 * Elevate logo: hexagon glyph with a peak cut out, then the serif name. Both take the current
 * text color, so the same mark works on the site's paper and night bands and in either
 * workspace theme. Size it with a text size on `className` (the glyph is 0.92em).
 */
export function Wordmark({ className }: { className?: string }) {
  const cutout = useId();
  return (
    <span className={cn("flex items-center gap-[0.3em] text-[26px] leading-none", className)}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[0.92em] shrink-0">
        <mask id={cutout}>
          <path d={HEXAGON} fill="#fff" />
          <path d="M8.33 14.67 12 9l3.67 5.67" fill="none" stroke="#000" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </mask>
        <path d={HEXAGON} fill="currentColor" mask={`url(#${cutout})`} />
      </svg>
      <span className="font-display font-medium tracking-[-0.03em]">Elevate</span>
    </span>
  );
}
