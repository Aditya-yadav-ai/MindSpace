import { Bookmark, Check, FileText, PencilLine, Sparkles } from "lucide-react";

import { ContextCapture } from "@/components/mindspace/context-capture";
import { domainOf, type usePageContext } from "@/components/mindspace/page-context";
import { SectionHeading, StatusPill } from "@/components/mindspace/ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Page Context card.
 *
 * Shows only what MindSpace actually has: text the reader added (or the
 * passage they selected). There is no tab capture and no screenshot pipeline,
 * so neither is rendered — no placeholder previews, no invented word counts.
 */
export function PageContextCard({
  page,
  editing,
  onEditingChange,
  saved,
  onSave,
}: {
  page: ReturnType<typeof usePageContext>;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  saved: boolean;
  onSave: () => void;
}) {
  const { context, hasContent, wordCount } = page;
  const domain = domainOf(context.url);
  const hasText = Boolean(context.text.trim());
  const hasSelection = Boolean(context.selection.trim());

  return (
    <section className="surface-card p-4 sm:p-5">
      <SectionHeading
        icon={FileText}
        title="Page context"
        description="What MindSpace will use when you ask a question."
        action={
          <StatusPill tone={hasContent ? "positive" : "neutral"}>
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 rounded-full",
                hasContent ? "bg-positive" : "bg-muted-foreground/50",
              )}
            />
            {hasContent ? "Text added" : "Nothing added"}
          </StatusPill>
        }
      />

      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Fact
          label="Page title"
          value={context.title.trim()}
          className="col-span-2 sm:col-span-1"
        />
        <Fact label="Domain" value={domain} mono />
        <Fact label="Words" value={hasText ? wordCount.toLocaleString() : ""} mono />
      </dl>

      {hasContent ? (
        <div className="mt-3.5 space-y-2.5">
          {hasText && (
            <p className="scrollbar-slim max-h-24 overflow-y-auto rounded-lg border border-border bg-background p-3 text-[12px] leading-5 text-muted-foreground">
              {context.text.trim().slice(0, 1200)}
              {context.text.trim().length > 1200 ? "…" : ""}
            </p>
          )}
          {hasSelection && (
            <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <Sparkles className="size-3 text-primary" aria-hidden="true" />A selected passage will
              be used as the focus for your questions.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3.5 rounded-lg border border-dashed border-border bg-background p-3.5">
          <p className="text-[12px] leading-5 text-muted-foreground">
            MindSpace can&apos;t read this tab on its own yet. Add the page text and it becomes the
            context for every answer.
          </p>
        </div>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <Button
          variant={editing ? "secondary" : "default"}
          size="sm"
          onClick={() => onEditingChange(!editing)}
        >
          <PencilLine aria-hidden="true" />
          {editing ? "Hide editor" : hasContent ? "Edit page text" : "Add page text"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onSave}
          disabled={!hasContent || saved}
          title={saved ? "Already saved on this device" : "Save this page on this device"}
        >
          {saved ? <Check aria-hidden="true" /> : <Bookmark aria-hidden="true" />}
          {saved ? "Saved" : "Save page"}
        </Button>
        <span className="ml-auto text-[10.5px] text-muted-foreground">Stored on this device</span>
      </div>

      {editing && (
        <div className="animate-rise mt-4 border-t border-border pt-4">
          <ContextCapture
            context={context}
            update={page.update}
            clear={page.clear}
            captureSelection={page.captureSelection}
            wordCount={wordCount}
          />
          <div className="mt-3 flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => onEditingChange(false)}>
              Done
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function Fact({
  label,
  value,
  mono = false,
  className,
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-background px-3 py-2", className)}>
      <dt className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 truncate text-[12.5px] font-medium",
          value ? "text-foreground" : "text-muted-foreground/70",
          mono && "font-mono text-[11.5px] font-normal",
        )}
        title={value || undefined}
      >
        {value || "Not available"}
      </dd>
    </div>
  );
}
