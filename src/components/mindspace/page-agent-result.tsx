import { AlertTriangle, Loader2, RotateCcw, Sparkles } from "lucide-react";

import type { AgentAssistResult } from "@/lib/agent.functions";
import { Button } from "@/components/ui/button";

export type AgentRunState =
  | { status: "idle" }
  | { status: "loading"; action: string }
  | { status: "done"; data: AgentAssistResult }
  | { status: "error"; message: string; action: string };

/**
 * Renders the result of one page action.
 *
 * The output is labelled with the mode the service reported. Simulated output
 * is never presented as a model answer.
 */
export function PageAgentResult({ state, onRetry }: { state: AgentRunState; onRetry: () => void }) {
  if (state.status === "idle") return null;

  if (state.status === "loading") {
    return (
      <div
        className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-[12.5px] text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        Running “{state.action}” against the local agent service…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3"
        role="alert"
      >
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 text-destructive" aria-hidden="true" />
          <div className="min-w-0 space-y-2">
            <p className="text-[12.5px] font-medium text-foreground">
              The action could not be completed
            </p>
            <p className="text-[12px] leading-5 text-muted-foreground">{state.message}</p>
            <Button size="sm" variant="outline" onClick={onRetry}>
              <RotateCcw aria-hidden="true" />
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const { data } = state;
  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card px-4 py-4"
      aria-label="Agent result"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={
            data.mock
              ? "rounded-full border border-amber-500/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-amber-600 dark:text-amber-400"
              : "rounded-full border border-emerald-500/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-emerald-600 dark:text-emerald-400"
          }
        >
          {data.mock ? "Simulated output" : "Model output"}
        </span>
        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.07em] text-muted-foreground">
          {data.mode}
        </span>
        {data.model ? (
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
            {data.model}
          </span>
        ) : null}
        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
          {Math.round(data.latencyMs)} ms
        </span>
        {data.guardrails.truncated ? (
          <span className="rounded-full border border-amber-500/50 px-2 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
            text truncated
          </span>
        ) : null}
        {data.guardrails.injectionFlags.length > 0 ? (
          <span className="rounded-full border border-amber-500/50 px-2 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
            untrusted instructions ignored ({data.guardrails.injectionFlags.length})
          </span>
        ) : null}
      </div>

      {data.mock ? (
        <p className="text-[11.5px] leading-5 text-muted-foreground">
          No live model key is configured, so this is a deterministic extractive result from the
          captured text — not a model answer.
        </p>
      ) : null}

      <div className="whitespace-pre-wrap text-[13px] leading-6 text-foreground">{data.result}</div>

      {data.sources.length > 0 ? (
        <div className="space-y-1 border-t border-border pt-2">
          <p className="text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">Sources</p>
          {data.sources.map((source) => (
            <p key={source.index} className="truncate text-[11.5px] text-muted-foreground">
              <Sparkles className="mr-1 inline size-3" aria-hidden="true" />
              {source.url ? (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-border underline-offset-2 hover:text-foreground"
                >
                  {source.title || source.url}
                </a>
              ) : (
                source.title || "captured page"
              )}
            </p>
          ))}
        </div>
      ) : null}

      <p className="text-[10.5px] text-muted-foreground">
        Request {data.requestId} · prompt {data.provenance.promptVersion} · context{" "}
        {data.provenance.contextSource || "page"}
        {data.provenance.contextDomain ? ` (${data.provenance.contextDomain})` : ""}
      </p>
    </section>
  );
}
