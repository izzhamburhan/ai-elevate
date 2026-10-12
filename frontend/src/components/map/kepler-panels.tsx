"use client";

import {
  AddDataButtonFactory,
  CollapseButtonFactory,
  CustomPanelsFactory,
  PanelHeaderFactory,
  PanelToggleFactory,
  SidePanelFactory,
  injectComponents,
} from "@kepler.gl/components";
import { ChevronLeft, Maximize2, MessageSquare, Minimize2 } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import { ChatHistoryMenu, NewChatButton } from "@/components/chat/chat-history-menu";
import { useChatFullscreen } from "./chat-fullscreen";
import { AssistantPanel } from "./panels/assistant-panel";

/** Labels for the custom side-panel tabs (kepler runs tab labels through react-intl). */
export const keplerLocaleMessages = {
  en: {
    "sidebar.panels.assistant": "Assistant",
  },
};

const customPanels = [
  {
    id: "assistant",
    label: "sidebar.panels.assistant",
    iconComponent: (props: { height?: string }) => <MessageSquare size={props.height ?? 18} />,
    component: AssistantPanel,
  },
];

/** kepler's built-in tabs we don't expose. */
const HIDDEN_PANELS = new Set(["filter", "interaction"]);

function ElevateCustomPanelsFactory() {
  // kepler renders `panel.component` itself; this element only exists to carry the static list
  const CustomPanels = () => null;
  CustomPanels.panels = customPanels;
  return CustomPanels;
}

/**
 * kepler appends custom panels after its own; move the Assistant tab to the front and drop the
 * hidden ones.
 */
function ElevateSidePanelFactory(...deps: Parameters<typeof SidePanelFactory>) {
  const SidePanel = SidePanelFactory(...deps);
  const defaults = (SidePanel.defaultPanels ?? []).filter((p) => !HIDDEN_PANELS.has(p.id));
  const panels = [
    ...defaults.filter((p) => p.id === "assistant"),
    ...defaults.filter((p) => p.id !== "assistant"),
  ];

  const ElevateSidePanel = (props: React.ComponentProps<typeof SidePanel>) => {
    const { isFullscreen } = useChatFullscreen();
    return (
      <>
        {/* the full-width panel still leaves its margins over the map; cover it entirely,
            just under the side panel (z-index 99) */}
        {isFullscreen ? <div className="absolute inset-0 bg-background" style={{ zIndex: 98 }} /> : null}
        <SidePanel {...props} panels={panels} />
      </>
    );
  };
  return ElevateSidePanel;
}
ElevateSidePanelFactory.deps = SidePanelFactory.deps;

/**
 * The app's TopBar carries the brand now; drop kepler's header (logo + Share/export menu),
 * keeping only the top padding it gave the panel tabs.
 */
function ElevatePanelHeaderFactory() {
  const PanelHeader = () => <div className="h-2 shrink-0" />;
  return PanelHeader;
}

/**
 * Open/close toggle that sits beside the panel with a gap, instead of kepler's default
 * which overlaps the panel edge. Positioned against the panel container (panel + 12px margins).
 */
function ElevateCollapseButtonFactory() {
  const CollapseButton = ({ onClick, isOpen }: { onClick: () => void; isOpen: boolean }) => {
    // the full-width chat has no map beside it; its fullscreen toggle brings the map back instead
    const { isFullscreen } = useChatFullscreen();
    if (isFullscreen) return null;
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={isOpen ? "Close panel" : "Open panel"}
        className="side-bar__close absolute top-3 left-full grid size-7 -translate-x-1 place-items-center rounded-lg border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
      >
        <ChevronLeft className={isOpen ? "size-4" : "size-4 rotate-180"} />
      </button>
    );
  };
  return CollapseButton;
}

/** Swaps the map for a full-width chat, and back. */
function ChatFullscreenButton({
  activePanel,
  togglePanel,
}: {
  activePanel: string | null;
  togglePanel: (id: string) => void;
}) {
  const { isFullscreen, setFullscreen } = useChatFullscreen();
  const Icon = isFullscreen ? Minimize2 : Maximize2;
  return (
    <TooltipIconButton
      tooltip={isFullscreen ? "Back to map" : "Full-screen chat"}
      side="bottom"
      variant="ghost"
      onClick={() => {
        if (!isFullscreen && activePanel !== "assistant") togglePanel("assistant");
        setFullscreen(!isFullscreen);
      }}
      className="text-muted-foreground hover:text-foreground size-7 p-1.5"
    >
      <Icon className="size-4" />
    </TooltipIconButton>
  );
}

/** Panel tab row with the fullscreen, chat history and new chat buttons on its right end. */
function ElevatePanelToggleFactory(...deps: Parameters<typeof PanelToggleFactory>) {
  const PanelToggle = PanelToggleFactory(...deps);

  const ElevatePanelToggle = (props: React.ComponentProps<typeof PanelToggle>) => {
    const { isFullscreen, setFullscreen } = useChatFullscreen();
    // only the chat goes full width; picking another tab brings the map back
    const togglePanel: typeof props.togglePanel = (id) => {
      if (isFullscreen && id !== "assistant") setFullscreen(false);
      return props.togglePanel(id);
    };
    return (
      <div className="relative">
        <PanelToggle {...props} togglePanel={togglePanel} />
        <div className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-0.5">
          <ChatFullscreenButton activePanel={props.activePanel} togglePanel={props.togglePanel} />
          <ChatHistoryMenu />
          <NewChatButton />
        </div>
      </div>
    );
  };
  return ElevatePanelToggle;
}
ElevatePanelToggleFactory.deps = PanelToggleFactory.deps;

/** Drops the "Add Data" button from the Layers tab's dataset section. */
function ElevateAddDataButtonFactory() {
  const AddDataButton = () => null;
  return AddDataButton;
}

// Order matters: injecting the side panel re-provides its deps (incl. the default
// PanelHeader, PanelToggle, CollapseButton, CustomPanels and AddDataButton factories), so
// their replacements must be injected after it.
export const KeplerGl = injectComponents([
  [SidePanelFactory, ElevateSidePanelFactory],
  [PanelHeaderFactory, ElevatePanelHeaderFactory],
  [PanelToggleFactory, ElevatePanelToggleFactory],
  [CollapseButtonFactory, ElevateCollapseButtonFactory],
  [CustomPanelsFactory, ElevateCustomPanelsFactory],
  [AddDataButtonFactory, ElevateAddDataButtonFactory],
] as never);
