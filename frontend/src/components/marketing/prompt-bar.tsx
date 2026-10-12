"use client";

import { useId, useState, type ReactNode, type Ref } from "react";
import { ArrowUp, ChevronDown, Plug, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

type PromptBarProps = {
  /** Controlled value; leave unset for an uncontrolled bar. */
  value?: string;
  onValueChange?: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
};

/** `value` is the provider the workspace picks a model for (see readLandingParams there). */
const MODELS = [
  { value: "deepseek", label: "DeepSeek" },
  { value: "openai", label: "OpenAI" },
  { value: "local", label: "Local · Gemma 4" },
];

/**
 * Prompt composer in the workspace's Ideogram style: 28px radius, hairline shadow, lavender send.
 * Submits a plain GET to the workspace, so it works before hydration too.
 */
export function PromptBar({ value, onValueChange, inputRef, className }: PromptBarProps) {
  const id = useId();
  const [inner, setInner] = useState("");
  const text = value ?? inner;

  return (
    <form action="/workspace" method="get" className={cn("w-full", className)}>
      <div className="mk-shimmer relative overflow-hidden rounded-[28px] border border-mk-line-strong bg-mk-raised shadow-[0_12px_40px_-16px_rgba(0,0,0,0.25)] transition-colors focus-within:border-mk-fg/30 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-(--ring)">
        <label htmlFor={`${id}-q`} className="sr-only">
          Ask about your network
        </label>
        <div className="flex items-center gap-2 py-2 pr-2 pl-5">
          <Sparkles className="size-4 shrink-0 text-mk-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            id={`${id}-q`}
            name="q"
            value={text}
            onChange={(e) => (onValueChange ? onValueChange(e.target.value) : setInner(e.target.value))}
            placeholder="Ask about your network…"
            autoComplete="off"
            className="h-12 min-w-0 flex-1 bg-transparent text-base text-mk-fg placeholder:text-mk-faint focus-visible:outline-none sm:text-[17px]"
          />
          <button
            type="submit"
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-mk-brand px-5 text-[15px] font-medium text-mk-brand-fg transition-colors hover:bg-[#cdb6ff]"
          >
            Ask
            <ArrowUp className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <PillSelect name="model" label="Model" options={MODELS} icon={<Sparkles />} />
        <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-mk-line px-3 text-xs text-mk-muted [&_svg]:size-3.5">
          <Plug aria-hidden="true" />
          24 connectors
        </span>
      </div>
    </form>
  );
}

/** Native select dressed as a pill chip. */
function PillSelect({ name, label, options, icon }: { name: string; label: string; options: { value: string; label: string }[]; icon: ReactNode }) {
  return (
    <label className="relative inline-flex h-8 items-center gap-1.5 rounded-full border border-mk-line pr-7 pl-3 text-xs text-mk-muted transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-(--ring) hover:bg-mk-fg/[0.05] [&_svg]:size-3.5">
      <span aria-hidden="true">{icon}</span>
      <span className="sr-only">{label}</span>
      <select name={name} className="cursor-pointer appearance-none bg-transparent text-mk-fg [field-sizing:content] focus-visible:outline-none">
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-mk-raised">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5" aria-hidden="true" />
    </label>
  );
}
