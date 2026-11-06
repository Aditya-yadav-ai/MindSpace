import { Bookmark, ExternalLink, LoaderCircle, Trash2 } from "lucide-react";

import type { SavedPageRecord } from "@/components/mindspace/page-context";
import { ViewHeader } from "@/components/mindspace/ui";
import { Button } from "@/components/ui/button";

/**
 * Saved Pages view.
 *
 * Saving is device-local (localStorage) — there is no saved-pages table in
 * this project, so the UI never claims account sync.
 */
export function SavedPages({
  items,
  hydrated,
  onRemove,
}: {
  items: SavedPageRecord[];
  hydrated: boolean;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <ViewHeader
        eyebrow="Saved Pages"
        title="Saved pages"
        description="Pages you kept from the workspace, stored in this browser profile."
      />

      {!hydrated ? (
        <p className="mt-6 flex items-center gap-2 text-[12px] text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          Loading saved pages…
        </p>
      ) : items.length === 0 ? (
        <div className="surface-card mt-6 grid place-items-center p-10 text-center">
          <div>
            <span className="mx-auto grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground">
              <Bookmark className="size-4.5" aria-hidden="true" />
            </span>
            <p className="mt-4 text-sm font-medium text-foreground">Nothing saved yet</p>
            <p className="mx-auto mt-1 max-w-sm text-[12px] leading-5 text-muted-foreground">
              Use “Save page” in the Page context card to keep a page here. Only the page you added
              text for can be saved.
            </p>
          </div>
        </div>
      ) : (
        <>
          <ul className="mt-5 space-y-2">
            {items.map((item) => (
              <li key={item.id} className="surface-card flex items-start gap-3 p-3.5">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
                  <Bookmark className="size-3.5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground">{item.title}</p>
                  <p className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
                    {item.domain || "No address saved"} · {item.wordCount.toLocaleString()} words ·{" "}
                    {new Date(item.savedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Open ${item.title}`}
                    disabled={!item.url}
                    onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")}
                    title={item.url ? item.url : "No address saved for this page"}
                  >
                    <ExternalLink />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${item.title}`}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => onRemove(item.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[11px] text-muted-foreground">
            Saved on this device — not synced to your account. Removing a saved page never deletes
            anything outside this browser.
          </p>
        </>
      )}
    </div>
  );
}
