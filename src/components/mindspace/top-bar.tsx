import { ClipboardPaste, Globe2, Menu, Moon, Sun } from "lucide-react";

import { StatusPill } from "@/components/mindspace/ui";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/theme";

/**
 * Compact bar identifying the tab MindSpace is working with.
 *
 * Every value here comes from the captured page context. When nothing has
 * been captured the bar says so instead of implying a live connection.
 */
export function TopBar({
  pageTitle,
  domain,
  hasContext,
  quiet = false,
  onOpenMenu,
  onAddPageText,
}: {
  pageTitle: string;
  domain: string;
  hasContext: boolean;
  quiet?: boolean;
  onOpenMenu: () => void;
  onAddPageText: () => void;
}) {
  const { resolvedTheme, toggleTheme } = useTheme();

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-3 sm:px-4">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open navigation"
        className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
      >
        <Menu className="size-4" aria-hidden="true" />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border bg-background">
          <Globe2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[12.5px] font-medium text-foreground">
            {pageTitle || "No page connected"}
          </p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {domain || "Browser tab not linked"}
          </p>
        </div>
      </div>

      <StatusPill
        tone={hasContext ? "positive" : "neutral"}
        className="hidden shrink-0 sm:inline-flex"
      >
        <span
          aria-hidden="true"
          className={
            hasContext
              ? quiet
                ? "size-1.5 rounded-full bg-positive"
                : "status-pulse size-1.5 rounded-full bg-positive"
              : "size-1.5 rounded-full bg-muted-foreground/50"
          }
        />
        {hasContext ? "Page text added" : "No page text"}
      </StatusPill>

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={toggleTheme}
        aria-label={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`}
        title={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        {resolvedTheme === "dark" ? (
          <Sun className="size-4" aria-hidden="true" />
        ) : (
          <Moon className="size-4" aria-hidden="true" />
        )}
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={onAddPageText}
        aria-label="Add page text"
        className="shrink-0"
      >
        <ClipboardPaste aria-hidden="true" />
        <span className="hidden sm:inline">Add page text</span>
      </Button>
    </header>
  );
}
