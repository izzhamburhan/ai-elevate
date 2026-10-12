"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";

import { cn } from "@/lib/utils";

import { useScrolled } from "./hooks";
import { NAV_LINKS, PillLink, Wordmark } from "./primitives";

/** Fixed top nav. Transparent with light text over the hero; paper with blur once scrolled. */
export function SiteNav() {
  const scrolled = useScrolled(40);
  const [open, setOpen] = useState(false);
  const solid = scrolled || open;

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b transition-colors duration-300",
        solid ? "border-mk-line bg-mk-bg/85 backdrop-blur-xl backdrop-saturate-150" : "mk-dark border-transparent bg-transparent",
      )}
    >
      <nav aria-label="Main" className="mx-auto flex h-[72px] max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="#top" aria-label="Elevate home" className="rounded-md">
          <Wordmark />
        </a>

        <ul className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((l) => (
            <li key={l.label}>
              <a href={l.href} className="rounded-full px-3 py-2 text-[15px] text-mk-fg/85 transition-colors hover:text-mk-fg">
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <a href="/sign-in" className="hidden rounded-full px-3 py-2 text-[15px] text-mk-fg sm:inline-flex">
            Sign in
          </a>
          <PillLink href="/workspace" variant="brand">
            Open workspace
          </PillLink>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((v) => !v)}
            className="grid size-10 place-items-center rounded-full border border-mk-line-strong text-mk-fg md:hidden"
          >
            {open ? <X className="size-4" aria-hidden="true" /> : <Menu className="size-4" aria-hidden="true" />}
          </button>
        </div>
      </nav>

      <div id="mobile-menu" hidden={!open} className="border-t border-mk-line px-4 pt-2 pb-4 md:hidden">
        <ul className="flex flex-col">
          {NAV_LINKS.map((l) => (
            <li key={l.label}>
              <a href={l.href} onClick={() => setOpen(false)} className="block rounded-lg px-2 py-3 text-base text-mk-fg hover:bg-mk-fg/[0.05]">
                {l.label}
              </a>
            </li>
          ))}
          <li className="sm:hidden">
            <a href="/sign-in" className="block rounded-lg px-2 py-3 text-base text-mk-muted hover:bg-mk-fg/[0.05]">
              Sign in
            </a>
          </li>
        </ul>
      </div>
    </header>
  );
}
