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
import { ChevronLeft, HeartPulse, MapPinned, MessageSquare } from "lucide-react";

import { ChatHistoryMenu, NewChatButton } from "@/components/chat/chat-history-menu";
import { AreaPanel } from "./panels/area-panel";
import { AssistantPanel } from "./panels/assistant-panel";
import { HealPanel } from "./panels/heal-panel";

/** Labels for the custom side-panel tabs (kepler runs tab labels through react-intl). */
export const keplerLocaleMessages = {
  en: {
    "sidebar.panels.assistant": "Assistant",
    "sidebar.panels.area": "Map & area",
    "sidebar.panels.heal": "Self-heal",
  },
};

const customPanels = [
  {
    id: "assistant",
    label: "sidebar.panels.assistant",
    iconComponent: (props: { height?: string }) => <MessageSquare size={props.height ?? 18} />,
    component: AssistantPanel,
  },
  {
    id: "area",
    label: "sidebar.panels.area",
    iconComponent: (props: { height?: string }) => <MapPinned size={props.height ?? 18} />,
    component: AreaPanel,
  },
  {
    id: "heal",
    label: "sidebar.panels.heal",
    iconComponent: (props: { height?: string }) => <HeartPulse size={props.height ?? 18} />,
    component: HealPanel,
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
 * kepler appends custom panels after its own; move our tabs (Assistant, Map & area, Self-heal) to the front and
 * drop the hidden ones.
 */
function ElevateSidePanelFactory(...deps: Parameters<typeof SidePanelFactory>) {
  const SidePanel = SidePanelFactory(...deps);
  const defaults = (SidePanel.defaultPanels ?? []).filter((p) => !HIDDEN_PANELS.has(p.id));
  const ours = ["assistant", "area", "heal"];
  const panels = [
    ...ours.flatMap((id) => defaults.filter((p) => p.id === id)),
    ...defaults.filter((p) => !ours.includes(p.id)),
  ];

  const ElevateSidePanel = (props: React.ComponentProps<typeof SidePanel>) => (
    <SidePanel {...props} panels={panels} />
  );
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
  const CollapseButton = ({ onClick, isOpen }: { onClick: () => void; isOpen: boolean }) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={isOpen ? "Close panel" : "Open panel"}
      className="side-bar__close absolute top-3 left-full grid size-7 -translate-x-1 place-items-center rounded-lg border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
    >
      <ChevronLeft className={isOpen ? "size-4" : "size-4 rotate-180"} />
    </button>
  );
  return CollapseButton;
}

/** Panel tab row with the chat history + new chat buttons on its right end. */
function ElevatePanelToggleFactory(...deps: Parameters<typeof PanelToggleFactory>) {
  const PanelToggle = PanelToggleFactory(...deps);

  const ElevatePanelToggle = (props: React.ComponentProps<typeof PanelToggle>) => (
    <div className="relative">
      <PanelToggle {...props} />
      <div className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-0.5">
        <ChatHistoryMenu />
        <NewChatButton />
      </div>
    </div>
  );
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
