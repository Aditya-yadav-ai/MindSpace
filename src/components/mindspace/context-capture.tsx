import { Highlighter, Link2, RotateCcw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { canAccessBrowserTabs, type PageContext } from "@/components/mindspace/page-context";

/**
 * Manual page-context editor.
 *
 * MindSpace has no content script, so page text can only be added by the
 * reader. The copy below says exactly that — it must never imply that the
 * browser tab was captured automatically.
 */
export function ContextCapture({
  context,
  update,
  clear,
  captureSelection,
  wordCount,
}: {
  context: PageContext;
  update: (patch: Partial<PageContext>) => void;
  clear: () => void;
  captureSelection: () => string;
  wordCount: number;
}) {
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
  const browserTabsAvailable = canAccessBrowserTabs();

  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-5 text-muted-foreground">
        {browserTabsAvailable
          ? "Automatic page capture isn't wired up yet, so paste the text you want MindSpace to read."
          : "MindSpace only reads the text you add here. Automatic capture from the browser tab isn't connected in this build."}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[11.5px] font-medium text-foreground">
          Page title
          <input
            value={context.title}
            onChange={(event) => update({ title: event.target.value })}
            placeholder="What are you reading?"
            className="mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-3 text-[13px] outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </label>
        <label className="block text-[11.5px] font-medium text-foreground">
          Page address
          <span className="relative mt-1.5 block">
            <Link2
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
            />
            <input
              value={context.url}
              onChange={(event) => update({ url: event.target.value })}
              placeholder="https://…"
              className="h-9 w-full rounded-lg border border-input bg-background pl-8 pr-3 text-[13px] outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </span>
        </label>
      </div>

      <label className="block text-[11.5px] font-medium text-foreground">
        Page text
        <textarea
          value={context.text}
          onChange={(event) => update({ text: event.target.value })}
          rows={5}
          placeholder="Paste the article or page content here…"
          className="mt-1.5 w-full resize-y rounded-lg border border-input bg-background p-3 text-[13px] leading-6 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
      </label>

      <label className="block text-[11.5px] font-medium text-foreground">
        Selected passage
        <textarea
          value={context.selection}
          onChange={(event) => update({ selection: event.target.value })}
          rows={2}
          placeholder="A specific quote or passage to focus on…"
          className="mt-1.5 w-full resize-y rounded-lg border border-input bg-background p-3 text-[13px] leading-6 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const value = captureSelection();
            setSelectionMessage(
              value ? "Selected passage added." : "Select some text in this panel first.",
            );
          }}
        >
          <Highlighter aria-hidden="true" />
          Use selected text
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => {
            clear();
            setSelectionMessage(null);
          }}
          disabled={!context.title && !context.url && !context.text && !context.selection}
        >
          <RotateCcw aria-hidden="true" />
          Clear context
        </Button>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          {wordCount.toLocaleString()} words
        </span>
      </div>

      {selectionMessage && (
        <p role="status" className="text-[11.5px] text-muted-foreground">
          {selectionMessage}
        </p>
      )}
    </div>
  );
}
