import Link from "next/link";
import { User } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";

/** Compact (44px) app bar, like the window bar in the site's workspace mock: wordmark left, theme toggle + account right. */
export function TopBar() {
  return (
    <header className="relative z-[100] flex h-11 shrink-0 items-center justify-between border-b bg-background px-4">
      <Link href="/" className="flex items-center gap-2 rounded-md" aria-label="Elevate home">
        <Wordmark className="text-[19px]" />
        <span className="rounded bg-brand px-1.5 py-0.5 text-[10px] leading-none font-medium text-brand-foreground">Beta</span>
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
