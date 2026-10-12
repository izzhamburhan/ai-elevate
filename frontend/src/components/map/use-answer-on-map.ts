"use client";

import { useEffect, useMemo } from "react";
import { useStore } from "react-redux";
import { useAuiState } from "@assistant-ui/react";

import { entitiesFromLastAnswer } from "@/lib/answer-entities";
import { useNetworkOverview } from "@/lib/network-overview";

import type { makeKeplerStore } from "./kepler-store";
import { clearFocus, flyTo, showFocus } from "./network-layer";

/** Survive the panel unmounting on a tab switch, so coming back does not redraw or move the map. */
let shownKey: string | undefined;
let movedKey: string | undefined;

/**
 * Every answer shows up on the map without the model having to draw it: the towers and places in
 * the latest answer's tool results are highlighted as they arrive, and the map moves to them once,
 * when the answer is complete (moving on every tool result made the map jump around). A new chat
 * goes back to the whole network. An answer with no places leaves the last highlight as it is.
 */
export function useAnswerOnMap() {
  const store = useStore() as ReturnType<typeof makeKeplerStore>;
  const messages = useAuiState((s) => s.thread.messages);
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const { overview } = useNetworkOverview();

  const entities = useMemo(
    () => entitiesFromLastAnswer(messages, overview?.towers ?? []),
    [messages, overview],
  );
  // tool results stream in one by one; only redraw when the set of places changes
  const key = entities?.map((e) => `${e.id}:${e.status}`).join("|");

  useEffect(() => {
    if (entities === undefined) {
      if (messages.length === 0 && shownKey !== undefined) {
        shownKey = undefined;
        movedKey = undefined;
        clearFocus(store);
      }
      return;
    }
    if (entities.length === 0) return;
    if (key !== shownKey) {
      shownKey = key;
      showFocus(store, entities, { move: false });
    }
    if (!isRunning && key !== movedKey) {
      movedKey = key;
      flyTo(store, entities);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the place set, not array identity
  }, [key, isRunning, messages.length === 0, store]);
}
