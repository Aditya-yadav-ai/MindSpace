import { Highlighter, Link2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { hasExtensionBridge, type PageContext } from "@/components/mindspace/page-context";

export function ContextCapture({
  context,
  update,
  clear,
  captureSelection,
  wordCount,
  screenshot,
  captureStatus,
}: {
  context: PageContext;
  update: (patch: Partial<PageContext>) => void;
  clear: () => void;
  captureSelection: () => string;
  wordCount: number;
  screenshot: string | null;
  captureStatus: string | null;
}) {
  const bridge = hasExtensionBridge();

  return (
    <section className="rounded-lg bg-panel/70 p-4 ring-1 ring-foreground/5 backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Page context</h2>
          <p className="mt-1 text-xs text-foreground/50">
            {bridge
              ? "Connected to the browser tab through the MindSpace extension."
              : "In the browser, paste the page you are reading. The packaged extension captures it automatically."}
          </p>
        </div>
        <span className="font-mono text-[11px] text-foreground/40">{wordCount} words</span>
      </div>

      {captureStatus && (
        <p className="mt-3 text-xs text-foreground/60" role="status">
          {captureStatus}
        </p>
      )}

      {screenshot && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium">Captured screenshot</p>
          <img
            src={screenshot}
            alt="Screenshot of the visible browser tab"
            className="max-h-80 w-full rounded-md border border-border bg-background object-contain object-top"
          />
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-foreground">
          Page title
          <input
            value={context.title}
            onChange={(event) => update({ title: event.target.value })}
            placeholder="What are you reading?"
            className="mt-1.5 h-9 w-full rounded-md border border-input bg-background/70 px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </label>
        <label className="block text-xs font-medium text-foreground">
          Page address
          <span className="relative mt-1.5 block">
            <Link2 className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-foreground/35" />
            <input
              value={context.url}
              onChange={(event) => update({ url: event.target.value })}
              placeholder="https://…"
              className="h-9 w-full rounded-md border border-input bg-background/70 pl-8 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </span>
        </label>
      </div>

      <label className="mt-3 block text-xs font-medium text-foreground">
        Page text
        <textarea
          value={context.text}
          onChange={(event) => update({ text: event.target.value })}
          rows={5}
          placeholder="Paste the article or page content here…"
          className="mt-1.5 w-full resize-y rounded-md border border-input bg-background/70 p-3 text-sm leading-6 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
      </label>

      <label className="mt-3 block text-xs font-medium text-foreground">
        Selected passage
        <textarea
          value={context.selection}
          onChange={(event) => update({ selection: event.target.value })}
          rows={2}
          placeholder="A specific quote or passage to focus on…"
          className="mt-1.5 w-full resize-y rounded-md border border-input bg-background/70 p-3 text-sm leading-6 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => captureSelection()}>
          <Highlighter />
          Use my highlighted text
        </Button>
        <Button variant="ghost" size="sm" className="text-foreground/55" onClick={clear}>
          <RotateCcw />
          Clear context
        </Button>
      </div>
    </section>
  );
}
