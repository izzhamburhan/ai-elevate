import type { ReactNode } from "react";
import Link from "next/link";

import { HeroBackdrop } from "../hero-backdrop";
import { SelfHealPoster } from "../hero-demo";
import { LiquidArt } from "../liquid-art";
import { Wordmark } from "../primitives";

type AuthShellProps = {
  /** Serif line on the art panel. */
  tagline: ReactNode;
  caption: string;
  title: string;
  subtitle: string;
  children: ReactNode;
};

/**
 * Split auth layout in the landing page's language: the cinematic city (with the liquid cursor)
 * on the left, a light form column on the right. On phones the art shrinks to a band on top.
 */
export function AuthShell({ tagline, caption, title, subtitle, children }: AuthShellProps) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[1.1fr_1fr]">
      <aside className="mk-dark relative isolate flex h-56 flex-col justify-between overflow-hidden bg-mk-bg p-5 sm:h-72 sm:p-8 lg:sticky lg:top-0 lg:h-svh lg:p-12">
        <div className="mk-grain absolute inset-0 -z-10">
          <LiquidArt className="absolute inset-y-0 right-0 h-full w-[180%] max-w-none sm:w-[130%] lg:w-[150%]">
            <HeroBackdrop uid="auth-art" priority className="absolute inset-0 h-full w-full" />
          </LiquidArt>
        </div>
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(to_top,rgba(4,5,9,0.9)_0%,rgba(4,5,9,0.4)_40%,rgba(4,5,9,0.25)_100%)]" />

        <Link href="/" aria-label="Elevate home" className="w-fit rounded-md">
          <Wordmark />
        </Link>

        <div className="hidden lg:block">
          <div className="mb-10 w-[300px]">
            <SelfHealPoster />
          </div>
          <p className="font-display text-5xl leading-[1.02] font-normal tracking-[-0.035em] text-balance text-mk-fg xl:text-6xl">{tagline}</p>
          <p className="mt-4 max-w-md text-base text-mk-fg/80">{caption}</p>
        </div>
      </aside>

      <main className="flex items-center justify-center px-4 py-12 sm:px-6 lg:py-16">
        <div className="w-full max-w-[400px]">
          <h1 className="text-[2rem] leading-tight font-medium tracking-[-0.025em] text-mk-fg">{title}</h1>
          <p className="mt-2 text-[15px] text-mk-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <p className="mt-10 text-center text-xs text-mk-faint">
            <Link href="/" className="underline-offset-4 hover:text-mk-fg hover:underline">
              Back to the site
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
