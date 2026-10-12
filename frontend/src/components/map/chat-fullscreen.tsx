"use client";

import { createContext, useContext } from "react";

type ChatFullscreenValue = {
  isFullscreen: boolean;
  setFullscreen: (value: boolean) => void;
};

/**
 * Whether the side panel is stretched over the whole map so the chat gets the full width.
 * Owned by `KeplerMap` (it sets kepler's `sidePanelWidth`); read by the panel's toggle row.
 */
export const ChatFullscreenContext = createContext<ChatFullscreenValue>({
  isFullscreen: false,
  setFullscreen: () => {},
});

export function useChatFullscreen() {
  return useContext(ChatFullscreenContext);
}
