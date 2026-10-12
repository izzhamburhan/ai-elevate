"use client";

import { useState } from "react";
import { ArrowUp, BarChart3, Map as MapIcon, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const PLACEHOLDER = "Show the 10 most populated cities as a heatmap";

type PromptBoxProps = {
  onSubmit?: (prompt: string, mode: string) => void;
  onAddData?: () => void;
  className?: string;
};

/** Ideogram-style prompt composer: attachment row, textarea, mode toggle, round send button. */
export function PromptBox({ onSubmit, onAddData, className }: PromptBoxProps) {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState("map");

  const submit = () => {
    const prompt = value.trim();
    if (!prompt) return;
    onSubmit?.(prompt, mode);
    setValue("");
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={cn(
        "rounded-prompt bg-card p-3 shadow-prompt transition-shadow focus-within:shadow-[var(--prompt-shadow),0_0_0_4px_var(--brand-soft)]",
        className,
      )}
    >
      <div className="flex gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Add dataset"
              onClick={onAddData}
              className="grid size-12 place-items-center rounded-xl bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Add dataset</TooltipContent>
        </Tooltip>
        <div className="size-12 rounded-xl bg-muted/70" aria-hidden />
        <div className="size-12 rounded-xl bg-muted/40" aria-hidden />
      </div>

      <div className="relative mt-3 px-1">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Tab" && !value) {
              e.preventDefault();
              setValue(PLACEHOLDER);
            } else if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={PLACEHOLDER}
          className="field-sizing-content max-h-40 min-h-7 w-full resize-none bg-transparent text-[15px] leading-7 outline-none placeholder:text-muted-foreground"
        />
        {!value ? (
          <kbd className="pointer-events-none absolute top-1.5 right-1 rounded-md bg-muted px-1.5 py-0.5 font-sans text-[10px] font-semibold text-muted-foreground">
            TAB
          </kbd>
        ) : null}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(v) => v && setMode(v)}
          className="rounded-xl bg-muted p-1"
        >
          <ToggleGroupItem
            value="map"
            aria-label="Map mode"
            className="size-7 rounded-lg data-[state=on]:bg-card data-[state=on]:shadow-sm"
          >
            <MapIcon />
          </ToggleGroupItem>
          <ToggleGroupItem
            value="chart"
            aria-label="Chart mode"
            className="size-7 rounded-lg data-[state=on]:bg-card data-[state=on]:shadow-sm"
          >
            <BarChart3 />
          </ToggleGroupItem>
        </ToggleGroup>

        <Button
          type="submit"
          size="icon"
          aria-label="Send"
          disabled={!value.trim()}
          className="size-9 rounded-full disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
        >
          <ArrowUp />
        </Button>
      </div>
    </form>
  );
}
