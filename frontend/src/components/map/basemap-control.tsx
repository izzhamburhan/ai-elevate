"use client";

import { MapControlButton } from "@kepler.gl/components";
import { Map as MapIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import { type BasemapKind, setBasemapKind, useBasemapKind } from "./basemap-choice";
import { hasVectorTiles } from "./basemaps";

const OPTIONS: { kind: BasemapKind; label: string; detail: string }[] = [
  { kind: "vector", label: "Elevate", detail: "Vector map, sharp at any zoom" },
  { kind: "osm", label: "OpenStreetMap", detail: "Standard raster tiles" },
];

/**
 * A map control (in kepler's column, beside 3D and split) that switches the basemap between the
 * Elevate vector map and OpenStreetMap's raster tiles. Both follow the app theme; the pick is saved
 * for every chat. Without the self-hosted tiles the Elevate map is raster too, so its option says so.
 */
export function BasemapControl() {
  const kind = useBasemapKind();
  const vector = hasVectorTiles();
  return (
    <DropdownMenu>
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <MapControlButton aria-label="Basemap">
                <MapIcon size={16} />
              </MapControlButton>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="left">Basemap</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent side="left" align="start" sideOffset={8} className="w-60">
        <DropdownMenuLabel>Basemap</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={kind} onValueChange={(value) => setBasemapKind(value as BasemapKind)}>
          {OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.kind} value={option.kind} className="items-start py-1.5">
              <span className="flex flex-col">
                <span className="text-[13px]">{option.label}</span>
                <span className="text-[11px] text-muted-foreground">
                  {option.kind === "vector" && !vector ? "Raster fallback: run npm run basemap" : option.detail}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
