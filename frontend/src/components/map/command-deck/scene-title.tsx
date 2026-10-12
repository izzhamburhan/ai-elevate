"use client";

import { useEffect, useState } from "react";

import { regionForView } from "@/lib/map-scenes";

import { useTowerStatus } from "../tower-status";
import { type KeplerStore, formatMyt, useKeplerValue } from "./use-kepler";

/** The browser clock in MYT, ticking on the minute; shown only when the network has no clock. */
function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(Date.now());
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    return () => clearTimeout(timer);
  }, []);
  return now;
}

/**
 * The establishing caption over the map: the region the camera is on, in the display serif, with
 * the network's clock. It changes with the camera, so a flight from Klang Valley to the East Coast reads as a
 * cut between scenes. Purely informational; clicks pass through to the map.
 */
export function SceneTitle({ store, mapId }: { store: KeplerStore; mapId: string }) {
  const region = useKeplerValue(store, mapId, (i) => [i.mapState], (i) => regionForView(i.mapState));
  const now = useMinuteClock();
  const { status } = useTowerStatus();
  if (!region) return null;

  return (
    <div className="pointer-events-none select-none [text-shadow:0_0_2px_var(--background),0_1px_3px_var(--background)]">
      <p className="text-[10.5px] font-medium tracking-[0.08em] text-muted-foreground uppercase">Network command</p>
      <h2
        key={region.id}
        aria-live="polite"
        className="mt-1 font-display text-[clamp(1.6rem,2.6vw,2.4rem)] leading-[1] font-normal tracking-[-0.03em] text-foreground duration-500 animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none"
      >
        {region.name}
      </h2>
      <p className="mt-1.5 text-[12px] text-muted-foreground tabular-nums">
        {region.caption} ·{" "}
        {/* one clock on screen: the network's scenario clock when the tower MCP gives one */}
        {status?.asOf ? `Network clock ${formatMyt(status.asOf)} MYT` : `${formatMyt(now)} MYT`}
        {status?.synthetic ? " · Synthetic" : ""}
      </p>
    </div>
  );
}
