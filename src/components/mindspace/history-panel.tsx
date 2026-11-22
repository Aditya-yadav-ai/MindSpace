/**
 * Stage 8 — Task and Session Execution History.
 *
 * Persists durable records of finished agent runs and conversation turns.
 * Backed by native SQLite with Supabase sync, supporting search, details inspection,
 * step execution analysis, and record deletion.
 */
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Cpu,
  Layers,
  LoaderCircle,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  deleteAgentRun,
  deleteChatTurn,
  getAgentRun,
  listAgentRuns,
  listChatHistory,
  type AgentRunDetail,
  type AgentRunSummary,
  type ChatTurnRecord,
} from "@/lib/history.functions";
import { cn } from "@/lib/utils";
import { ViewHeader } from "@/components/mindspace/ui";
import { Button } from "@/components/ui/button";

type Tab = "runs" | "chat";

export function HistoryPanel({ signedIn }: { signedIn: boolean }) {
  const [tab, setTab] = useState<Tab>("runs");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Header />
      <div className="flex gap-2 rounded-xl border border-border bg-muted/40 p-1">
        {(["runs", "chat"] as const).map((id) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex-1 rounded-lg py-2 text-xs font-semibold transition-all",
              tab === id
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {id === "runs" ? "Agent Task Runs" : "Conversation History"}
          </button>
        ))}
      </div>
      <div>{tab === "runs" ? <RunsTab /> : <ChatTab />}</div>
    </div>
  );
}

function RunsTab() {
  const load = useServerFn(listAgentRuns);
  const getDetail = useServerFn(getAgentRun);
  const remove = useServerFn(deleteAgentRun);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "verified" | "partial" | "failed">(
    "all",
  );
  const [runs, setRuns] = useState<AgentRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<AgentRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refresh = useCallback(
    async (query: string, status: "all" | "verified" | "partial" | "failed") => {
      setLoading(true);
      setError(null);
      try {
        const res = await load({ data: { search: query, status, limit: 30 } });
        setRuns(res || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load task runs.");
      } finally {
        setLoading(false);
      }
    },
    [load],
  );

  useEffect(() => {
    const timer = setTimeout(() => void refresh(search, statusFilter), 250);
    return () => clearTimeout(timer);
  }, [search, statusFilter, refresh]);

  async function openDetail(id: string) {
    if (selectedRunId === id) {
      setSelectedRunId(null);
      setRunDetail(null);
      return;
    }
    setSelectedRunId(id);
    setDetailLoading(true);
    try {
      const detail = await getDetail({ data: { runId: id } });
      setRunDetail(detail);
    } catch {
      setRunDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function remove_(id: string) {
    setBusy(id);
    setError(null);
    try {
      await remove({ data: { runId: id } });
      setConfirmDeleteId(null);
      if (selectedRunId === id) {
        setSelectedRunId(null);
        setRunDetail(null);
      }
      await refresh(search, statusFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete run.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Search & Status Filters */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="flex-1 w-full">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Search past tasks, goals, or outputs..."
          />
        </div>
        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          {(["all", "verified", "partial", "failed"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-xs font-medium capitalize border transition-colors",
                statusFilter === s
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Task Runs List */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center p-12 text-muted-foreground">
            <LoaderCircle className="size-6 animate-spin text-primary mr-2" />
            <span className="text-xs">Loading execution history...</span>
          </div>
        ) : (runs?.length ?? 0) === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center space-y-2 bg-muted/20">
            <Clock3 className="mx-auto size-7 text-muted-foreground/60" />
            <p className="text-sm font-semibold text-foreground">No matching task runs found</p>
            <p className="text-xs text-muted-foreground">
              Execute agent tasks in Agent Activity or Current Capture to see persistent records
              here.
            </p>
          </div>
        ) : (
          (runs ?? []).map((run) => (
            <div
              key={run.id}
              className="rounded-xl border border-border bg-card p-4 space-y-3 transition-colors hover:border-primary/30"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <VerdictBadge status={run.status} />
                    <h3 className="truncate text-sm font-bold text-foreground">{run.goal}</h3>
                    {run.automation_id && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-primary">
                        Automated
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1 font-mono">
                      <Layers className="size-3 text-primary/70" />
                      {run.step_count} step(s)
                    </span>
                    {run.failed_count > 0 && (
                      <span className="text-destructive font-medium">
                        {run.failed_count} step(s) failed
                      </span>
                    )}
                    {run.verification_score !== null && (
                      <span className="font-mono">
                        Score: {(run.verification_score * 100).toFixed(0)}%
                      </span>
                    )}
                    <span>{new Date(run.created_at).toLocaleString()}</span>
                  </div>

                  {run.answer && (
                    <p className="text-xs text-muted-foreground/90 line-clamp-2 pt-1 leading-relaxed">
                      {run.answer}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1"
                    onClick={() => void openDetail(run.id)}
                  >
                    <span>{selectedRunId === run.id ? "Hide Details" : "View Details"}</span>
                    {selectedRunId === run.id ? (
                      <ChevronUp className="size-3.5" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmDeleteId(run.id)}
                    title="Delete record"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>

              {/* Confirm Delete */}
              {confirmDeleteId === run.id && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs flex items-center justify-between text-destructive">
                  <span>Permanently delete this task execution record?</span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-7 text-[11px]"
                      disabled={busy === run.id}
                      onClick={() => void remove_(run.id)}
                    >
                      {busy === run.id ? (
                        <LoaderCircle className="size-3 animate-spin mr-1" />
                      ) : (
                        <Trash2 className="size-3 mr-1" />
                      )}
                      Confirm Delete
                    </Button>
                  </div>
                </div>
              )}

              {/* Expandable Task Detail View */}
              {selectedRunId === run.id && (
                <div className="mt-3 border-t border-border/60 pt-4 space-y-4">
                  {detailLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
                      <LoaderCircle className="size-4 animate-spin text-primary" />
                      <span>Loading complete execution graph and verification report...</span>
                    </div>
                  ) : runDetail ? (
                    <div className="space-y-4">
                      {/* Full Answer Output */}
                      <div className="rounded-lg border border-border/60 bg-muted/20 p-3.5 space-y-1.5">
                        <h4 className="text-xs font-bold text-foreground">Synthesis & Answer</h4>
                        <p className="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">
                          {runDetail.answer}
                        </p>
                      </div>

                      {/* Execution Steps */}
                      {runDetail.steps && runDetail.steps.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="text-xs font-bold text-foreground">
                            Step-by-Step Agent Telemetry ({runDetail.steps.length})
                          </h4>
                          <div className="space-y-2">
                            {runDetail.steps.map((step, idx) => (
                              <div
                                key={idx}
                                className="rounded-lg border border-border/40 bg-card p-3 space-y-1 text-xs"
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground font-semibold">
                                      Step {idx + 1}
                                    </span>
                                    <span className="font-semibold text-foreground">
                                      {step.agent || "Worker"}
                                    </span>
                                  </div>
                                  <span
                                    className={cn(
                                      "rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase",
                                      step.status === "ok"
                                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                        : "bg-destructive/10 text-destructive",
                                    )}
                                  >
                                    {step.status}
                                  </span>
                                </div>
                                <p className="text-muted-foreground text-[11.5px]">{step.goal}</p>
                                {step.summary && (
                                  <p className="text-foreground/80 text-[11.5px] font-mono bg-muted/40 p-2 rounded">
                                    {step.summary}
                                  </p>
                                )}
                                {step.durationMs !== undefined && (
                                  <p className="text-[10px] text-muted-foreground font-mono">
                                    Duration: {step.durationMs} ms
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Verification Report */}
                      {runDetail.verification && (
                        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs space-y-1">
                          <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-semibold">
                            <ShieldCheck className="size-4" />
                            <span>Verification Verdict: {runDetail.verification.verdict}</span>
                          </div>
                          {runDetail.verification.score !== undefined && (
                            <p className="text-[11px] text-muted-foreground">
                              Quality Score: {(runDetail.verification.score * 100).toFixed(1)}%
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">
                      Detailed step trace not available for this run.
                    </p>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ChatTab() {
  const load = useServerFn(listChatHistory);
  const remove = useServerFn(deleteChatTurn);

  const [search, setSearch] = useState("");
  const [turns, setTurns] = useState<ChatTurnRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (query: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await load({ data: { search: query, limit: 60 } });
        setTurns(res || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load chat history.");
      } finally {
        setLoading(false);
      }
    },
    [load],
  );

  useEffect(() => {
    const timer = setTimeout(() => void refresh(search), 250);
    return () => clearTimeout(timer);
  }, [search, refresh]);

  async function remove_(id: string) {
    setBusy(id);
    try {
      await remove({ data: { turnId: id } });
      await refresh(search);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <SearchBox
        value={search}
        onChange={setSearch}
        placeholder="Search past messages and answers..."
      />

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {loading ? (
          <div className="flex items-center justify-center p-12 text-muted-foreground">
            <LoaderCircle className="size-6 animate-spin text-primary mr-2" />
            <span className="text-xs">Loading conversations...</span>
          </div>
        ) : (turns?.length ?? 0) === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center space-y-2 bg-muted/20">
            <p className="text-sm font-semibold text-foreground">No conversation turns recorded</p>
            <p className="text-xs text-muted-foreground">
              Questions answered in the side panel or workspace will appear here.
            </p>
          </div>
        ) : (
          (turns ?? []).map((turn) => (
            <div
              key={turn.id}
              className="flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-primary/30"
            >
              <span
                className={cn(
                  "mt-0.5 shrink-0 rounded-md px-2 py-0.5 font-mono text-[10px] font-bold uppercase",
                  turn.role === "user"
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "bg-muted text-muted-foreground border border-border",
                )}
              >
                {turn.role}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">
                  {turn.content}
                </p>
                <div className="flex items-center gap-2 text-[10.5px] text-muted-foreground">
                  <span>{new Date(turn.created_at).toLocaleString()}</span>
                  {turn.page_title && <span className="truncate">· On: {turn.page_title}</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void remove_(turn.id)}
                disabled={busy === turn.id}
                aria-label="Delete message"
                className="shrink-0 text-muted-foreground hover:text-destructive p-1 rounded hover:bg-muted"
              >
                {busy === turn.id ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function VerdictBadge({ status }: { status: string }) {
  const ok = status === "verified" || status === "completed";
  const Icon = ok ? ShieldCheck : ShieldAlert;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
        ok
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      )}
    >
      <Icon className="size-3" />
      {status}
    </span>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
      />
    </div>
  );
}

function Header() {
  return (
    <ViewHeader
      eyebrow="Task History"
      title="Task History & Sessions"
      description="Durable execution records of autonomous agent workflows, step telemetry, and conversation history."
    />
  );
}
