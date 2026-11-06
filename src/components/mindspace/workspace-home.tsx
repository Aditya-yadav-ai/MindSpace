import { useServerFn } from "@tanstack/react-start";
import { FileText, HelpCircle, ListTree, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";

import { ChatPanel, type ChatCommand } from "@/components/mindspace/chat-panel";
import { PageAgentResult, type AgentRunState } from "@/components/mindspace/page-agent-result";
import { PageContextCard } from "@/components/mindspace/page-context-card";
import type { usePageContext } from "@/components/mindspace/page-context";
import { Button } from "@/components/ui/button";
import {
  assistPage,
  getAgentStatus,
  getLatestCapture,
  type AgentStatus,
  type LatestCapture,
} from "@/lib/agent.functions";

type Action = "summarize" | "explain" | "extract" | "ask";

const ACTION_LABEL: Record<Action, string> = {
  summarize: "Summarize",
  explain: "Explain",
  extract: "Extract facts",
  ask: "Ask about this page",
};

/**
 * Workspace home.
 *
 * The four page actions call the local Python agent service and render its
 * actual response, including the mode label. The chat instance below remains
 * the place for open-ended conversation.
 */
export function WorkspaceHome({
  name,
  page,
  saved,
  onSave,
  editing,
  onEditingChange,
}: {
  name: string;
  page: ReturnType<typeof usePageContext>;
  saved: boolean;
  onSave: () => void;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}) {
  const command = useState<RefObject<ChatCommand | null>>(() => ({ current: null }))[0];
  const [busy, setBusy] = useState(false);
  const [agentState, setAgentState] = useState<AgentRunState>({ status: "idle" });
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [question, setQuestion] = useState("");
  const [askOpen, setAskOpen] = useState(false);
  const [pendingCapture, setPendingCapture] = useState<LatestCapture | null>(null);
  const [importNotice, setImportNotice] = useState("");
  const [importBusy, setImportBusy] = useState(false);

  const fetchStatus = useServerFn(getAgentStatus);
  const fetchLatestCapture = useServerFn(getLatestCapture);
  const runAssist = useServerFn(assistPage);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = name.split(" ")[0] || name;
  const contextText = page.context.text.trim() || page.context.selection.trim();
  const ready = page.hasContent && !busy && agentState.status !== "loading";

  useEffect(() => {
    let cancelled = false;
    fetchStatus({})
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchStatus]);

  useEffect(() => {
    if (page.hasContent) return;
    let cancelled = false;
    fetchLatestCapture({})
      .then((capture) => {
        if (!cancelled && capture) setPendingCapture(capture);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fetchLatestCapture, page.hasContent]);

  async function importCapture() {
    setImportBusy(true);
    try {
      const capture = pendingCapture ?? (await fetchLatestCapture({}));
      if (!capture) {
        setImportNotice("No capture is available. Capture a page from the extension first.");
        return;
      }
      page.update({ title: capture.title, url: capture.url, text: capture.text });
      setPendingCapture(null);
      setImportNotice(
        `Imported ${capture.wordCount} words from ${capture.domain || "the extension capture"}.`,
      );
    } catch (error) {
      setImportNotice(
        error instanceof Error ? error.message : "The capture could not be imported.",
      );
    } finally {
      setImportBusy(false);
    }
  }

  async function run(action: Action) {
    if (!contextText) {
      setAgentState({
        status: "error",
        action: ACTION_LABEL[action],
        message: "Add page text in Page context before running an action.",
      });
      return;
    }
    if (action === "ask" && !question.trim()) {
      setAskOpen(true);
      return;
    }

    setAgentState({ status: "loading", action: ACTION_LABEL[action] });
    try {
      const data = await runAssist({
        data: {
          action,
          question: action === "ask" ? question.trim() : "",
          maxWords: 220,
          context: {
            url: page.context.url.trim(),
            title: page.context.title.trim(),
            domain: "",
            text: contextText,
            source: "manual",
          },
        },
      });
      setAgentState({ status: "done", data });
      if (action === "ask") setAskOpen(false);
    } catch (error) {
      setAgentState({
        status: "error",
        action: ACTION_LABEL[action],
        message: error instanceof Error ? error.message : "The action failed.",
      });
    }
  }

  function retry() {
    const action = (Object.keys(ACTION_LABEL) as Action[]).find(
      (key) => ACTION_LABEL[key] === (agentState.status === "error" ? agentState.action : ""),
    );
    void run(action ?? "summarize");
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 pb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-primary">
            Workspace
          </p>
          <h1 className="mt-2 text-[26px] font-semibold leading-tight text-foreground">
            {greeting}, {firstName}
          </h1>
          <p className="mt-2 max-w-xl text-[13px] leading-6 text-muted-foreground">
            MindSpace can summarize, explain and extract information from the page you are reading.
            Everything below works from the page context you add — nothing is read from the tab on
            its own.
          </p>
        </div>
        <span
          className={
            !status
              ? "rounded-full border border-border px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-muted-foreground"
              : !status.reachable
                ? "rounded-full border border-amber-500/50 px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-amber-600 dark:text-amber-400"
                : status.mock
                  ? "rounded-full border border-amber-500/50 px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-amber-600 dark:text-amber-400"
                  : "rounded-full border border-emerald-500/50 px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-emerald-600 dark:text-emerald-400"
          }
          title={status ? status.reason : "Checking the local agent service"}
        >
          {!status
            ? "checking service"
            : !status.reachable
              ? "local service offline"
              : status.mock
                ? "simulated mode"
                : "live model"}
        </span>
      </div>

      {pendingCapture && !page.hasContent ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
          <p className="text-[12px] text-foreground">
            A page capture is available:{" "}
            <span className="font-medium">{pendingCapture.title || pendingCapture.domain}</span>{" "}
            <span className="text-muted-foreground">
              ({pendingCapture.wordCount} words
              {pendingCapture.ageSeconds !== null
                ? `, ${Math.max(0, Math.round(pendingCapture.ageSeconds))}s ago`
                : ""}
              )
            </span>
          </p>
          <Button size="sm" variant="outline" onClick={importCapture} disabled={importBusy}>
            {importBusy ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw aria-hidden="true" />
            )}
            Import
          </Button>
        </div>
      ) : null}

      {importNotice ? (
        <p className="text-[11.5px] text-muted-foreground" role="status">
          {importNotice}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void run("summarize")} disabled={!ready}>
          <Sparkles aria-hidden="true" />
          Summarize page
        </Button>
        <Button variant="outline" size="sm" onClick={() => void run("explain")} disabled={!ready}>
          <HelpCircle aria-hidden="true" />
          Explain page
        </Button>
        <Button variant="outline" size="sm" onClick={() => void run("extract")} disabled={!ready}>
          <ListTree aria-hidden="true" />
          Extract key facts
        </Button>
        <Button
          variant={askOpen ? "secondary" : "ghost"}
          size="sm"
          className="text-muted-foreground"
          onClick={() => setAskOpen((open) => !open)}
          disabled={!page.hasContent}
        >
          <FileText aria-hidden="true" />
          Ask about this page
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => void importCapture()}
          disabled={importBusy || !status?.reachable}
          title="Load the most recent capture shared by the MindSpace extension"
        >
          {importBusy ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw aria-hidden="true" />
          )}
          Import latest capture
        </Button>
      </div>

      {askOpen ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run("ask");
          }}
        >
          <input
            autoFocus
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="What do you want to know about this page?"
            aria-label="Question about this page"
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-[13px] text-foreground outline-none focus:border-primary"
          />
          <Button type="submit" size="sm" disabled={!ready || !question.trim()}>
            Ask
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="Close question field"
            onClick={() => setAskOpen(false)}
          >
            <X aria-hidden="true" />
          </Button>
        </form>
      ) : null}

      {!page.hasContent && !pendingCapture ? (
        <p className="-mt-1 text-[11.5px] text-muted-foreground">
          Add page text in Page context, or capture a page with the extension, to enable these
          actions.
        </p>
      ) : null}

      <PageAgentResult state={agentState} onRetry={retry} />

      <PageContextCard
        page={page}
        editing={editing}
        onEditingChange={onEditingChange}
        saved={saved}
        onSave={onSave}
      />

      <div id="mindspace-conversation" className="flex min-h-[24rem] flex-col">
        <ChatPanel context={page.context} command={command} onBusyChange={setBusy} />
      </div>
    </div>
  );
}
