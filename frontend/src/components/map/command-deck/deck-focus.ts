"use client";

import { create } from "zustand";

import type { SiteTone } from "@/lib/hermes/investigation";

/**
 * The one site the deck points at: a reticle and its label, set from the Agents tab's affected sites.
 * (The Agents tab's own `lib/hermes/map-focus.ts` tracks the clicked tower and highlighted evidence.)
 */
export type DeckFocus = { key: string; lng: number; lat: number; label: string; detail?: string; tone: SiteTone };

export const useDeckFocus = create<{ focus: DeckFocus | null }>(() => ({ focus: null }));

export const setDeckFocus = (focus: DeckFocus | null) => useDeckFocus.setState({ focus });
