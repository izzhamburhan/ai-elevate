"use client";

import { useState } from "react";
import { PlusIcon, Settings2Icon, SlidersHorizontalIcon } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";

import { ConnectorAvatar, ConnectorsDialog, type ConnectorsView } from "./connectors-dialog";
import { useConnectors } from "./connectors-store";

/** Composer button: quick per-connector toggles, plus entry points into the connectors dialog. */
export function ConnectorsMenu() {
  const connectors = useConnectors((s) => s.connectors);
  const status = useConnectors((s) => s.status);
  const update = useConnectors((s) => s.update);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogView, setDialogView] = useState<ConnectorsView | null>(null);

  const activeCount = connectors.filter((c) => c.enabled).length;

  const openDialog = (view: ConnectorsView) => {
    setMenuOpen(false);
    setDialogView(view);
  };

  return (
    <>
      <Popover
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (open) {
            const { connectors, status, refresh } = useConnectors.getState();
            connectors.filter((c) => !status[c.id]).forEach((c) => void refresh(c.id));
          }
        }}
      >
        <PopoverTrigger asChild>
          <TooltipIconButton
            tooltip="Connectors"
            side="bottom"
            type="button"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground relative size-7 rounded-full p-1.5"
            aria-label="Connectors"
          >
            <SlidersHorizontalIcon className="size-4" />
            {activeCount > 0 ? (
              <span className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 grid size-3.5 place-items-center rounded-full text-[9px] leading-none font-semibold">
                {activeCount}
              </span>
            ) : null}
          </TooltipIconButton>
        </PopoverTrigger>

        <PopoverContent align="start" side="top" className="w-72 gap-1 p-1.5 font-sans">
          {connectors.length ? (
            <>
              <p className="text-muted-foreground px-2 pt-1 pb-1 text-xs font-medium">Connectors</p>
              <ul className="flex max-h-64 flex-col overflow-y-auto">
                {connectors.map((c) => (
                  <li key={c.id} className="hover:bg-muted/70 flex items-center gap-2.5 rounded-md px-2 py-1.5">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      onClick={() => openDialog({ name: "detail", id: c.id })}
                    >
                      <ConnectorAvatar connector={c} status={status[c.id]} size="sm" />
                      <span className="truncate text-[13px]">{c.name}</span>
                    </button>
                    <Switch
                      size="sm"
                      checked={c.enabled}
                      onCheckedChange={(enabled) => update(c.id, { enabled })}
                      aria-label={`Use ${c.name}`}
                    />
                  </li>
                ))}
              </ul>
              <div className="bg-border -mx-1.5 my-1 h-px" />
            </>
          ) : null}

          <MenuItem icon={<PlusIcon />} onClick={() => openDialog({ name: "add" })}>
            Add custom connector
          </MenuItem>
          <MenuItem icon={<Settings2Icon />} onClick={() => openDialog({ name: "list" })}>
            Manage connectors
          </MenuItem>
        </PopoverContent>
      </Popover>

      <ConnectorsDialog
        open={dialogView !== null}
        onOpenChange={(open) => !open && setDialogView(null)}
        initialView={dialogView ?? undefined}
      />
    </>
  );
}

function MenuItem({
  icon,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:bg-muted/70 [&_svg]:text-muted-foreground flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] [&_svg]:size-4"
    >
      {icon}
      {children}
    </button>
  );
}
