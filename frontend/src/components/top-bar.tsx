import { Map as MapIcon, User } from "lucide-react";
import Link from "next/link";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";

/** Compact (40px, Palantir-style) app bar: brand on the left, theme toggle + account on the right. */
export function TopBar() {
  return (
    <header className="relative z-[100] flex h-10 shrink-0 items-center justify-between border-b bg-background px-3">
      <Link href="/" className="flex items-center gap-1.5" aria-label="Elevate home">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground">
          <MapIcon className="size-3.5" />
        </span>
        <span className="text-[15px] font-bold tracking-tight">Elevate</span>
        <Badge variant="brand" className="h-4 px-1.5 text-[9px] font-semibold tracking-wide">
          BETA
        </Badge>
      </Link>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        <Avatar size="sm">
          <AvatarFallback>
            <User className="size-3.5" />
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
