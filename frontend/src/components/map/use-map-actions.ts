"use client";

import { useCallback, useMemo } from "react";
import { useStore } from "react-redux";

import type { AnswerEntity } from "@/lib/answer-entities";
import { useNetworkOverview } from "@/lib/network-overview";

import type { makeKeplerStore } from "./kepler-store";
import { showFocus } from "./network-layer";

/** Map moves the chat can make itself, without asking the model. */
export function useMapActions() {
  const store = useStore() as ReturnType<typeof makeKeplerStore>;
  const { overview } = useNetworkOverview();

  /** Highlights these towers and moves the map to them. Unknown names are skipped. */
  const focusTowers = useCallback(
    (names: string[]) => {
      const byName = new Map((overview?.towers ?? []).map((t) => [t.enodeb_name, t]));
      const entities: AnswerEntity[] = names.flatMap((name) => {
        const t = byName.get(name);
        return t ? [{ id: name, label: name, lat: t.lat, lng: t.lng, status: t.status, kind: "tower" as const }] : [];
      });
      if (entities.length) showFocus(store, entities);
    },
    [store, overview],
  );

  const knownTowers = useMemo(() => new Set((overview?.towers ?? []).map((t) => t.enodeb_name)), [overview]);

  return { focusTowers, knownTowers };
}
