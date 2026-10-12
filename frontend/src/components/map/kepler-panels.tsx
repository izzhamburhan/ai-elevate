"use client";

import {
  ActionPanelItem,
  AddDataButtonFactory,
  CollapseButtonFactory,
  CustomPanelsFactory,
  FeatureActionPanelFactory,
  MapControlFactory,
  PanelHeaderFactory,
  PanelToggleFactory,
  SidePanelFactory,
  injectComponents,
} from "@kepler.gl/components";
import { useAui, useAuiState } from "@assistant-ui/react";
import { Bot, Check, ChevronLeft, CloudRain, Maximize2, MessageSquare, MessageSquarePlus, Minimize2 } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import { ChatHistoryMenu, NewChatButton } from "@/components/chat/chat-history-menu";
import {
  boundaryAttachment,
  BOUNDARY_MEDIA_TYPE,
  extractFeatureMetrics,
  formatBoundaryLabel,
} from "@/lib/menara/boundary-context";
import { BasemapControl } from "./basemap-control";
import { useChatFullscreen } from "./chat-fullscreen";
import { useShowChat } from "./drawn-boundary-actions";
import { PanelResizeHandle } from "./panel-resize-handle";
import { AssistantPanel } from "./panels/assistant-panel";
import { WeatherPanel } from "./panels/weather-panel";
import { HermesPanel } from "./panels/hermes-panel";
import { towerPopoverFactories } from "./tower-popover";

/** Labels for the custom side-panel tabs (kepler runs tab labels through react-intl). */
export const keplerLocaleMessages = {
  en: {
    "sidebar.panels.assistant": "Assistant",
    "sidebar.panels.weather": "Weather",
    "sidebar.panels.hermes": "Agents",
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
    id: "weather",
    label: "sidebar.panels.weather",
    iconComponent: (props: { height?: string }) => <CloudRain size={props.height ?? 18} />,
    component: WeatherPanel,
  },
  {
    id: "hermes",
    label: "sidebar.panels.hermes",
    iconComponent: (props: { height?: string }) => <Bot size={props.height ?? 18} />,
    component: HermesPanel,
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
        {/* the full-width panel is glass like the regular one (globals.css), so the map shows
            through it; this transparent layer just under it (z-index 99) only stops the map in
            its margins from being dragged while the chat is full width */}
        {isFullscreen ? <div className="absolute inset-0" style={{ zIndex: 98 }} /> : null}
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
      <>
        {/* kepler renders this button beside the panel whether it's open or not, so the panel's
            resize handle rides along here */}
        {isOpen ? <PanelResizeHandle /> : null}
        <button
          type="button"
          onClick={onClick}
          aria-label={isOpen ? "Close panel" : "Open panel"}
          // on phones the panel leaves only a strip of map, where kepler's map controls sit at the
          // top; move the button to the bottom of the strip so it doesn't cover them
          className="side-bar__close absolute top-3 left-full grid size-7 -translate-x-1 place-items-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground max-sm:top-auto max-sm:bottom-16"
        >
          <ChevronLeft className={isOpen ? "size-4" : "size-4 rotate-180"} />
        </button>
      </>
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

/** kepler's map controls with the basemap switch after its split and 3D buttons. */
function ElevateMapControlFactory(...deps: Parameters<typeof MapControlFactory>) {
  const MapControl = MapControlFactory(...deps);
  const actions = [...(MapControl.defaultActionComponents ?? [])];
  actions.splice(2, 0, BasemapControl);

  const ElevateMapControl = (props: React.ComponentProps<typeof MapControl>) => (
    <MapControl {...props} actionComponents={actions} />
  );
  return ElevateMapControl;
}
ElevateMapControlFactory.deps = MapControlFactory.deps;

/**
 * Drawn shape action panel: adds an "Add to chat" button to the floating menu when
 * a user clicks or edits a polygon/shape.
 */
function ElevateFeatureActionPanelFactory(...deps: Parameters<typeof FeatureActionPanelFactory>) {
  const FeatureActionPanel = FeatureActionPanelFactory(...deps);

  const ElevateFeatureActionPanel = (props: React.ComponentProps<typeof FeatureActionPanel>) => {
    const aui = useAui();
    const showChat = useShowChat();
    const isAttached = useAuiState((s) =>
      s.thread.composer.attachments.some((a) => a.contentType === BOUNDARY_MEDIA_TYPE),
    );

    const handleAddToChat = () => {
      if (!props.selectedFeature) return;
      const metrics = extractFeatureMetrics(props.selectedFeature);
      const label = formatBoundaryLabel(metrics);
      aui.thread().composer().addAttachment(boundaryAttachment(props.selectedFeature, label));
      showChat();
      props.onClose?.();
    };

    return (
      <FeatureActionPanel {...props}>
        {props.selectedFeature ? (
          <ActionPanelItem
            label={isAttached ? "In Chat" : "Add to Chat"}
            className="add-to-chat-panel-item"
            Icon={isAttached ? Check : MessageSquarePlus}
            onClick={handleAddToChat}
          />
        ) : null}
        {props.children}
      </FeatureActionPanel>
    );
  };
  return ElevateFeatureActionPanel;
}
ElevateFeatureActionPanelFactory.deps = FeatureActionPanelFactory.deps;

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
  [MapControlFactory, ElevateMapControlFactory],
  [FeatureActionPanelFactory, ElevateFeatureActionPanelFactory],
  // the tower tooltip's actions (Heal this tower, Add to chat); hides tooltips with nothing to show
  ...towerPopoverFactories,
] as never);
