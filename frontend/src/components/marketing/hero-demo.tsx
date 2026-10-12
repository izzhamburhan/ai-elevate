"use client";

import { useId, useRef, useState } from "react";
import { Play, X } from "lucide-react";

import { SelfHealDemo } from "./self-heal-demo";

const STAGES = ["Detect", "Diagnose", "Simulate", "Approve", "Apply", "Verify", "Roll back", "Recover"];

/** Still frame of the Self-heal card: the play card's poster, also used on the sign-in art panel. */
export function SelfHealPoster() {
  return (
    <span className="block h-full rounded-xl border border-white/15 bg-[#1c1927]/80 p-3 backdrop-blur-md">
      <span className="flex items-center justify-between text-[11px] text-mk-fg">
        <span className="font-medium">Self-heal · TWR-KB-031</span>
        <span className="rounded-full bg-mk-green/15 px-1.5 py-0.5 text-mk-green">Resolved</span>
      </span>
      <span className="mt-2 grid grid-cols-4 gap-1">
        {STAGES.map((s) => (
          <span key={s} className="truncate rounded-full border border-mk-green/30 px-1 py-0.5 text-center text-[9px] text-mk-green">
            {s}
          </span>
        ))}
      </span>
      <svg viewBox="-4 0 208 44" className="mt-2 block h-auto w-full">
        <line x1="0" x2="200" y1="16" y2="16" stroke="#ffb224" strokeDasharray="4 3" strokeWidth="1" />
        <path d="M0,34 L22,32 L40,12 L62,6 L86,8 L110,7 L130,18 L152,28 L176,31 L200,32" fill="none" stroke="#b79bff" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="200" cy="32" r="3" fill="#19e6c1" />
      </svg>
    </span>
  );
}

/**
 * "Watch a self-heal run": a poster card (or, on smaller screens, a pill button) that opens the
 * animated Self-heal card in a modal <dialog>. The demo mounts on open, so it starts from the top.
 */
export function HeroDemo({ variant }: { variant: "card" | "button" }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = useId();

  const show = () => {
    setOpen(true);
    dialogRef.current?.showModal();
  };
  const close = () => dialogRef.current?.close();

  return (
    <>
      {variant === "card" ? (
        <button type="button" onClick={show} aria-haspopup="dialog" className="group block w-[320px] rounded-xl text-left">
          <span className="relative block aspect-video">
            <SelfHealPoster />
            <span className="absolute inset-0 grid place-items-center rounded-xl bg-black/25 transition-colors group-hover:bg-black/10">
              <span className="grid size-14 place-items-center rounded-xl bg-mk-brand text-mk-brand-fg shadow-lg transition-transform group-hover:scale-110">
                <Play className="size-5 fill-current" aria-hidden="true" />
              </span>
            </span>
          </span>
          <span className="mt-3 flex items-center justify-between text-base text-mk-fg">
            Watch a self-heal run
            <span className="text-sm text-mk-muted tabular-nums">0:21</span>
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={show}
          aria-haspopup="dialog"
          className="inline-flex h-12 items-center gap-2 rounded-full px-3 text-base font-medium text-mk-fg hover:text-mk-fg/85"
        >
          <span className="grid size-8 place-items-center rounded-full bg-mk-brand text-mk-brand-fg">
            <Play className="size-3.5 fill-current" aria-hidden="true" />
          </span>
          Watch a run
        </button>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        // A click on the dialog element itself (not its content) is a click on the backdrop.
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        className="m-auto w-[min(760px,calc(100vw-32px))] max-w-none bg-transparent p-0 text-mk-fg backdrop:bg-black/75 backdrop:backdrop-blur-sm"
      >
        <div className="flex items-center justify-between pb-3">
          <h2 id={titleId} className="text-base font-medium text-white">
            A self-heal run, start to finish
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="grid size-9 place-items-center rounded-full border border-white/25 text-white hover:bg-white/10"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        {open && <SelfHealDemo />}
      </dialog>
    </>
  );
}
