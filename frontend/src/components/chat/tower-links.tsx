"use client";

import { Children, type ReactNode } from "react";

import { useMapActions } from "@/components/map/use-map-actions";
import { cn } from "@/lib/utils";

const TOWER_NAME = /\b[A-Z]{2,6}-\d{3,5}\b/g;

function TowerLink({ name, code }: { name: string; code?: boolean }) {
  const { focusTowers } = useMapActions();
  return (
    <button
      type="button"
      onClick={() => focusTowers([name])}
      title="Show on the map"
      className={cn(
        "cursor-pointer underline decoration-dotted decoration-1 underline-offset-2 hover:decoration-solid",
        code ? "rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em]" : "font-medium",
      )}
    >
      {name}
    </button>
  );
}

/**
 * Turns tower names in answer text into links that fly the map to the tower. Only names of real
 * towers (from the network overview) are linked, so ids that merely look alike stay plain text.
 */
export function TowerLinks({ children }: { children?: ReactNode }) {
  const { knownTowers: known } = useMapActions();
  if (known.size === 0) return <>{children}</>;

  return (
    <>
      {Children.map(children, (child) => {
        if (typeof child !== "string") return child;
        const parts: ReactNode[] = [];
        let last = 0;
        for (const match of child.matchAll(TOWER_NAME)) {
          if (!known.has(match[0])) continue;
          parts.push(child.slice(last, match.index), <TowerLink key={match.index} name={match[0]} />);
          last = match.index + match[0].length;
        }
        if (parts.length === 0) return child;
        parts.push(child.slice(last));
        return parts;
      })}
    </>
  );
}

/** `KKRI-0142` written as inline code: same link, code look. Undefined when it is not a known tower. */
export function useInlineTowerCode(children: ReactNode): ReactNode | undefined {
  const { knownTowers } = useMapActions();
  if (typeof children !== "string" || !knownTowers.has(children)) return undefined;
  return <TowerLink name={children} code />;
}
