"use client";

import {
  BarChart3,
  Database,
  FolderClosed,
  Layers,
  Map as MapIcon,
  Pin,
  Plus,
  Sparkles,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NavItem = {
  title: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  /** kepler.gl side-panel tab this item switches to, if any */
  panel?: string;
  active?: boolean;
};

const primaryNav: NavItem[] = [
  { title: "Map", icon: MapIcon, active: true },
  { title: "Datasets", icon: Database },
  { title: "Collections", icon: FolderClosed },
];

const createNav: NavItem[] = [
  { title: "Layers", icon: Layers, panel: "layer" },
  { title: "Analyze", icon: BarChart3 },
  { title: "AI insights", icon: Sparkles, panel: "assistant" },
];

const pinnedNav: NavItem[] = [{ title: "All maps", icon: Pin }];

type WorkspacePanelProps = {
  showAddDataModal?: () => void;
  uiStateActions?: { toggleSidePanel: (id: string) => void };
};

function NavGroup({
  label,
  items,
  onSelect,
}: {
  label?: string;
  items: NavItem[];
  onSelect: (item: NavItem) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {label ? <p className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">{label}</p> : null}
      {items.map((item) => (
        <button
          key={item.title}
          type="button"
          data-active={item.active}
          onClick={() => onSelect(item)}
          className={cn(
            "flex h-9 items-center gap-2 rounded-lg px-2 text-left text-[13px] font-medium transition-colors hover:bg-accent",
            "data-[active=true]:bg-accent data-[active=true]:font-semibold [&_svg]:size-4 [&_svg]:shrink-0",
          )}
        >
          <item.icon />
          <span>{item.title}</span>
        </button>
      ))}
    </div>
  );
}

/** The former app sidebar, now a tab inside kepler.gl's side panel. */
export function WorkspacePanel({ showAddDataModal, uiStateActions }: WorkspacePanelProps) {
  const onSelect = (item: NavItem) => {
    if (item.panel) uiStateActions?.toggleSidePanel(item.panel);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 font-sans text-foreground">
      <nav className="flex flex-1 flex-col gap-1">
        <NavGroup items={primaryNav} onSelect={onSelect} />
        <NavGroup label="Create" items={createNav} onSelect={onSelect} />
        <NavGroup label="Pinned" items={pinnedNav} onSelect={onSelect} />
      </nav>

      <div className="flex flex-col gap-2">
        <Button variant="outline" className="h-10 w-full rounded-[10px]" onClick={showAddDataModal}>
          <Upload />
          Import data
        </Button>
        <Button className="h-10 w-full rounded-[10px]">
          <Plus />
          New map
        </Button>
      </div>
    </div>
  );
}
