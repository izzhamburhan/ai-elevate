"use client";

import { useState } from "react";
import { SlidersHorizontalIcon } from "lucide-react";

import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button";

import { ConnectorsDialog } from "./connectors-dialog";
import { useConnectors } from "./connectors-store";

/** Composer button: opens the connectors dialog. */
export function ConnectorsMenu() {
  const activeCount = useConnectors((s) => s.connectors.filter((c) => c.enabled).length);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <TooltipIconButton
        tooltip="Connectors"
        side="bottom"
        type="button"
        variant="ghost"
        className="text-muted-foreground hover:text-foreground relative size-7 rounded-full p-1.5"
        aria-label="Connectors"
        onClick={() => setDialogOpen(true)}
      >
        <SlidersHorizontalIcon className="size-4" />
        {activeCount > 0 ? (
          <span className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 grid size-3.5 place-items-center rounded-full text-[9px] leading-none font-semibold">
            {activeCount}
          </span>
        ) : null}
      </TooltipIconButton>

      <ConnectorsDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
