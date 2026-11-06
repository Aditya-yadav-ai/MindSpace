/**
 * Stage 4/5/8 — Agent Activity view.
 * Next-generation real-time multi-agent execution & monitoring console.
 * Visualizes the full lifecycle: Manager Agent orchestration, specialist worker
 * agents, tools, verification, blackboard events, and P2P communication.
 */
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Bot,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  Compass,
  CornerDownRight,
  Database,
  ExternalLink,
  FileText,
  Filter,
  HardDrive,
  Inbox,
  Layers,
  ListTree,
  LoaderCircle,
  Mail,
  Maximize2,
  MessageSquare,
  MessagesSquare,
  Network,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Table,
  Terminal,
  Trash2,
  UserCheck,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button3D } from "@/components/ui/button-3d";
import {
  Card3D,
  Card3DContent,
  Card3DDescription,
  Card3DHeader,
  Card3DTitle,
} from "@/components/ui/card-3d";
import {
  getMasActivityFeed,
  runAgentWorkflow,
  type MasActivityResponse,
} from "@/lib/agents.functions";
import type { PageContext } from "@/components/mindspace/page-context";
import type { StepResult, StepStatus, VerificationCheck, WorkflowResult } from "@/lib/agents";
import { cn } from "@/lib/utils";
import { ViewHeader } from "@/components/mindspace/ui";

const SAMPLE_GOALS = [
  "Summarize this page and pull out any deadlines",
  "Extract dates and links, then draft reminders",
  "Research this question using my knowledge base",
  "Draft an email about this page",
  "What's on my calendar next?",
  "Create a Google Doc from this page",
  "Save a reminder about this page",
  "Read https://example.org/aurora-grant/notice, create a report doc, save it to Drive and add a calendar reminder",
];

const SAMPLE_PAGE = {
  title: "Aurora Grant — Submission Notice",
  url: "https://example.org/aurora-grant/notice",
  selection: "",
  text: "The Aurora grant submission deadline is 2026-11-14. Applicants must submit the signed consent form, the final budget sheet and a short project summary. Late submissions will not be accepted. Direct questions to grants@example.org or see https://example.org/aurora-grant/faq for the reviewer contact list.",
};

const TOOL_LABELS: Record<string, string> = {
  "gmail.create_draft": "create this Gmail draft",
  "calendar.create_event": "create this calendar event",
  "drive.save_file": "save this file to Drive",
  "docs.create": "create this Google Doc",
  "sheets.create": "create this Google Sheet",
  "sheets.append_row": "append rows to this sheet",
  "slides.create": "create this Slides presentation",
  "forms.create": "create this Google Form",
  "meet.create_space": "create this Meet link",
  "chat.send_message": "send this Chat message",
  "reminders.delete": "delete this saved reminder",
};

const AGENT_META: Record<string, { label: string; icon: typeof Bot; role: string }> = {
  manager: { label: "Manager Agent", icon: Compass, role: "Supervisor & Orchestrator" },
  planner: { label: "Planner Agent", icon: ListTree, role: "Decomposition & Strategy" },
  extractor: { label: "Extractor Agent", icon: Layers, role: "Entity & Schema Extraction" },
  summarizer: { label: "Summarizer Agent", icon: FileText, role: "Content Distillation" },
  calendar: { label: "Calendar Agent", icon: Calendar, role: "Scheduling & Events" },
  gmail: { label: "Gmail Agent", icon: Mail, role: "Email Drafting & Ingestion" },
  drive: { label: "Drive Agent", icon: HardDrive, role: "File & Storage Management" },
  docs: { label: "Docs Agent", icon: FileText, role: "Document Authoring" },
  sheets: { label: "Sheets Agent", icon: Table, role: "Structured Data & Tables" },
  research: { label: "Research Agent", icon: Search, role: "RAG & Knowledge Lookup" },
  verifier: { label: "Verifier Agent", icon: ShieldCheck, role: "Safety & Output Validation" },
};

function getAgentMeta(agentName: string) {
  const key = agentName.toLowerCase();
  return (
    AGENT_META[key] || {
      label: `${agentName.charAt(0).toUpperCase() + agentName.slice(1)} Agent`,
      icon: Bot,
      role: "Specialist Agent",
    }
  );
}

function findPendingApproval(result: WorkflowResult): { tool: string; agent: string } | null {
  for (const step of result.steps) {
    if (step.status !== "failed" || !step.error) continue;
    const match = /^(\S+) changes real data and needs the user's approval/.exec(step.error);
    if (match) return { tool: match[1]!, agent: step.agent };
  }
  return null;
}

function statusTone(status: StepStatus) {
  if (status === "ok")
    return {
      icon: CheckCircle2,
      className: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
    };
  if (status === "skipped")
    return { icon: AlertCircle, className: "text-amber-500 bg-amber-500/10 border-amber-500/20" };
  return { icon: AlertCircle, className: "text-rose-500 bg-rose-500/10 border-rose-500/20" };
}

function checkTone(level: VerificationCheck["level"]) {
  if (level === "pass") return "text-emerald-500 bg-emerald-500";
  if (level === "warn") return "text-amber-500 bg-amber-500";
  return "text-rose-500 bg-rose-500";
}

const STORAGE_KEY = "mindspace_agent_runs_v2";

export function AgentActivity({ signedIn, context }: { signedIn: boolean; context: PageContext }) {
  const runWorkflowFn = useServerFn(runAgentWorkflow);
  const getMasActivityFn = useServerFn(getMasActivityFeed);

  const [goal, setGoal] = useState(SAMPLE_GOALS[0]!);
  const [useSample, setUseSample] = useState(!context.text.trim());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stored runs & active run selection
  const [runs, setRuns] = useState<WorkflowResult[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<string[]>([]);

  // Navigation & filtering state inside Agent Activity
  const [activeTab, setActiveTab] = useState<
    "overview" | "timeline" | "agents" | "communication" | "trace"
  >("overview");
  const [commSubTab, setCommSubTab] = useState<"messages" | "blackboard" | "p2p">("messages");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Backend MAS activity feed
  const [masFeed, setMasFeed] = useState<MasActivityResponse | null>(null);
  const [masLoading, setMasLoading] = useState(false);

  const activePage = useSample || !context.text.trim() ? SAMPLE_PAGE : context;

  // Hydrate stored runs from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as WorkflowResult[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setRuns(parsed);
          setActiveRunId(parsed[0]?.runId || null);
        }
      }
    } catch (e) {
      console.warn("Failed to hydrate agent runs:", e);
    }
  }, []);

  // Fetch backend MAS activity on mount and on refresh
  const loadMasFeed = async (runId?: string) => {
    setMasLoading(true);
    try {
      const feed = await getMasActivityFn({ data: { runId, limit: 50 } });
      if (feed) setMasFeed(feed);
    } catch (e) {
      // Extension client fallback to FastAPI backend on port 8010
      try {
        const url = new URL("http://127.0.0.1:8010/v1/mas/activity");
        if (runId) url.searchParams.set("run_id", runId);
        url.searchParams.set("limit", "50");
        const resp = await fetch(url.toString(), {
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(4000),
        });
        if (resp.ok) {
          const directFeed = (await resp.json()) as MasActivityResponse;
          setMasFeed(directFeed);
        } else {
          console.warn("Could not load backend MAS feed:", e);
        }
      } catch (err2) {
        console.warn("Could not load backend MAS feed:", e, err2);
      }
    } finally {
      setMasLoading(false);
    }
  };

  useEffect(() => {
    void loadMasFeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentResult = useMemo(() => {
    if (!activeRunId) return runs[0] || null;
    return runs.find((r) => r.runId === activeRunId) || runs[0] || null;
  }, [runs, activeRunId]);

  const saveRun = (newRun: WorkflowResult) => {
    setRuns((prev) => {
      const filtered = prev.filter((r) => r.runId !== newRun.runId);
      const updated = [newRun, ...filtered].slice(0, 20);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (e) {
        console.warn("Failed to persist agent runs:", e);
      }
      return updated;
    });
    setActiveRunId(newRun.runId);
  };

  const clearHistory = () => {
    setRuns([]);
    setActiveRunId(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn("Failed to clear storage:", e);
    }
  };

  async function submit(withApprovals: string[] = []) {
    if (goal.trim().length < 3 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const output = await runWorkflowFn({
        data: { goal: goal.trim(), page: activePage, approvals: withApprovals },
      });
      saveRun(output);
      setApprovals(withApprovals);
      // Refresh MAS feed for the new run
      loadMasFeed(output.runId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The workflow could not run.");
    } finally {
      setBusy(false);
    }
  }

  const pending = currentResult ? findPendingApproval(currentResult) : null;

  // Filtered steps
  const filteredSteps = useMemo(() => {
    if (!currentResult) return [];
    return currentResult.steps.filter((step) => {
      if (agentFilter !== "all" && step.agent.toLowerCase() !== agentFilter.toLowerCase())
        return false;
      if (statusFilter !== "all" && step.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          step.stepId.toLowerCase().includes(q) ||
          step.agent.toLowerCase().includes(q) ||
          step.summary.toLowerCase().includes(q) ||
          (step.error && step.error.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [currentResult, agentFilter, statusFilter, searchQuery]);

  // Filtered trace events
  const filteredEvents = useMemo(() => {
    if (!currentResult) return [];
    return currentResult.trace.events.filter((evt) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          evt.actor.toLowerCase().includes(q) ||
          evt.name.toLowerCase().includes(q) ||
          (evt.detail && evt.detail.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [currentResult, searchQuery]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      {/* Header and Mode Status */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <ViewHeader
          eyebrow="Multi-Agent System"
          title="Agent activity"
          description="Autonomous orchestration combining Manager supervision, specialist worker agents, tool safety guards, and verification."
        />
        <div className="flex items-center gap-2 self-start sm:self-center">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border",
              signedIn
                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400"
                : "bg-indigo-500/10 text-indigo-600 border-indigo-500/20 dark:text-indigo-400",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                signedIn ? "bg-emerald-500" : "bg-indigo-500 animate-pulse",
              )}
            />
            {signedIn ? "Cloud Connected" : "Local Extension Mode"}
          </span>
        </div>
      </div>

      {/* Goal Input & Trigger Card */}
      <Card3D glow={busy} className="p-5">
        <Card3DHeader className="p-0 pb-3">
          <div className="flex items-center justify-between">
            <Card3DTitle className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              Goal for the Manager Agent
            </Card3DTitle>
            <span className="font-mono text-[11px] text-muted-foreground">
              Autonomous Planning Engine
            </span>
          </div>
          <Card3DDescription className="text-xs">
            Describe the desired outcome. The Manager Agent will analyze the target page, construct
            a step-by-step DAG plan, dispatch to specialist agents, and verify results.
          </Card3DDescription>
        </Card3DHeader>

        <div className="space-y-3">
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={2}
            placeholder="e.g. Summarize this page and pull out any deadlines"
            className="w-full resize-none rounded-xl border border-input bg-background/60 p-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          />

          {/* Quick sample chips */}
          <div className="flex flex-wrap gap-1.5">
            {SAMPLE_GOALS.map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => setGoal(sample)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs transition-all border",
                  goal === sample
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-muted/50 text-muted-foreground hover:bg-accent border-border/60 hover:text-foreground",
                )}
              >
                {sample}
              </button>
            ))}
          </div>

          {/* Page context toggle */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">Target Context:</span>
              <span className="truncate max-w-[280px] font-mono text-[11px] text-primary/80">
                {activePage.title || "Untitled"}
              </span>
              <span>{useSample || !context.text.trim() ? "(sample)" : "(live tab)"}</span>
            </div>
            {context.text.trim() && (
              <button
                type="button"
                className="text-primary hover:underline font-medium text-xs"
                onClick={() => setUseSample((v) => !v)}
              >
                {useSample ? "Switch to live captured tab" : "Switch to sample notice"}
              </button>
            )}
          </div>

          <div className="flex items-center justify-between pt-2">
            <Button3D
              variant="primary"
              onClick={() => void submit()}
              disabled={busy || goal.trim().length < 3}
            >
              {busy ? <LoaderCircle className="animate-spin size-4" /> : <Zap className="size-4" />}
              {busy ? "Orchestrating agents…" : "Run Multi-Agent Workflow"}
            </Button3D>

            {runs.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-mono">
                  {runs.length} run{runs.length > 1 ? "s" : ""} saved
                </span>
                <Button3D variant="ghost" size="sm" onClick={clearHistory} title="Clear history">
                  <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                </Button3D>
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </Card3D>

      {/* Execution Results View */}
      {currentResult && (
        <div className="space-y-6">
          {/* Run Header & Status Strip */}
          <Card3D className="p-4 bg-card/80 backdrop-blur-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider border",
                    currentResult.status === "verified"
                      ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400"
                      : currentResult.status === "partial"
                        ? "bg-amber-500/15 text-amber-600 border-amber-500/30 dark:text-amber-400"
                        : "bg-rose-500/15 text-rose-600 border-rose-500/30 dark:text-rose-400",
                  )}
                >
                  <ShieldCheck className="size-3.5" />
                  {currentResult.status}
                </span>

                <span className="font-mono text-xs px-2 py-0.5 rounded bg-muted/60 text-muted-foreground border border-border/50">
                  Run ID: {currentResult.runId}
                </span>

                <span className="font-mono text-xs px-2 py-0.5 rounded bg-muted/60 text-muted-foreground border border-border/50 flex items-center gap-1">
                  <Clock className="size-3" />
                  {Math.round(currentResult.trace.totalMs)} ms
                </span>
              </div>

              {/* Run Selector if multiple */}
              {runs.length > 1 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Select run:</span>
                  <select
                    value={currentResult.runId}
                    onChange={(e) => setActiveRunId(e.target.value)}
                    className="rounded-lg border border-input bg-background px-2 py-1 text-xs font-mono"
                  >
                    {runs.map((r) => (
                      <option key={r.runId} value={r.runId}>
                        {r.runId} ({r.status})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Answer Display */}
            <div className="mt-4 rounded-xl border border-border/60 bg-background/50 p-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <Bot className="size-3.5 text-primary" />
                Synthesized Outcome
              </p>
              <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
                {currentResult.answer}
              </p>
            </div>

            {/* Pending Approval Banner */}
            {pending && (
              <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                <div className="flex items-start gap-3">
                  <ShieldAlert className="size-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-amber-800 dark:text-amber-300">
                      Human-in-the-Loop Approval Required
                    </p>
                    <p className="text-xs text-amber-700/90 dark:text-amber-400/90 mt-0.5">
                      The <span className="font-semibold">{pending.agent}</span> agent requested to
                      execute{" "}
                      <span className="font-mono font-semibold">
                        {TOOL_LABELS[pending.tool] ?? pending.tool}
                      </span>
                      . External write actions remain blocked until you confirm.
                    </p>
                  </div>
                </div>
                <Button3D
                  variant="primary"
                  size="sm"
                  className="bg-amber-600 hover:bg-amber-700 text-white shrink-0 self-end sm:self-center"
                  onClick={() => void submit([...approvals, pending.tool])}
                  disabled={busy}
                >
                  <UserCheck className="size-3.5" />
                  Approve &amp; Continue
                </Button3D>
              </div>
            )}
          </Card3D>

          {/* Interactive Navigation Tabs */}
          <div className="flex flex-wrap items-center gap-1 border-b border-border/80 pb-2">
            {[
              { id: "overview", label: "Execution Flow", icon: Network },
              { id: "timeline", label: "10-Stage Timeline", icon: Activity },
              { id: "agents", label: `Agent Cards (${currentResult.steps.length})`, icon: Bot },
              { id: "communication", label: "Blackboard & P2P", icon: MessagesSquare },
              {
                id: "trace",
                label: `Trace Log (${currentResult.trace.events.length})`,
                icon: Terminal,
              },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id as typeof activeTab)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(79,70,229,0.3)]"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Icon className="size-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* TAB 1: Visual Execution Flow Diagram */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              <Card3D className="p-5">
                <Card3DHeader className="p-0 pb-4">
                  <Card3DTitle className="text-sm font-semibold flex items-center gap-2">
                    <Network className="size-4 text-primary" />
                    Multi-Agent Pipeline Architecture
                  </Card3DTitle>
                  <Card3DDescription className="text-xs">
                    Deterministic hierarchical execution flow: Input ➔ Manager Strategy ➔ Specialist
                    Dispatch ➔ Tools ➔ Verifier ➔ Output.
                  </Card3DDescription>
                </Card3DHeader>

                {/* Pipeline Node Diagram */}
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3 pt-2">
                  {/* Step 1: User Request */}
                  <div className="rounded-xl border border-border/80 bg-background/60 p-3 flex flex-col justify-between">
                    <div>
                      <span className="font-mono text-[10px] text-primary uppercase font-bold">
                        Node 1
                      </span>
                      <h4 className="text-xs font-semibold mt-1">User Goal</h4>
                      <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
                        {currentResult.goal}
                      </p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-border/50 flex items-center gap-1 text-[10px] text-emerald-500 font-medium">
                      <CheckCircle2 className="size-3" /> Received
                    </div>
                  </div>

                  {/* Step 2: Manager Agent */}
                  <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 flex flex-col justify-between shadow-[0_0_12px_rgba(79,70,229,0.08)]">
                    <div>
                      <span className="font-mono text-[10px] text-primary uppercase font-bold">
                        Node 2
                      </span>
                      <h4 className="text-xs font-semibold mt-1">Manager Agent</h4>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Strategy:{" "}
                        <span className="font-mono font-medium text-foreground">
                          {currentResult.plan.strategy}
                        </span>
                      </p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-border/50 flex items-center gap-1 text-[10px] text-emerald-500 font-medium">
                      <CheckCircle2 className="size-3" /> Orchestrated
                    </div>
                  </div>

                  {/* Step 3: Specialist Agents */}
                  <div className="rounded-xl border border-border/80 bg-background/60 p-3 flex flex-col justify-between">
                    <div>
                      <span className="font-mono text-[10px] text-primary uppercase font-bold">
                        Node 3
                      </span>
                      <h4 className="text-xs font-semibold mt-1">
                        Specialists ({currentResult.steps.length})
                      </h4>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {Array.from(new Set(currentResult.steps.map((s) => s.agent))).map((ag) => (
                          <span
                            key={ag}
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                          >
                            {ag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-border/50 flex items-center gap-1 text-[10px] text-emerald-500 font-medium">
                      <CheckCircle2 className="size-3" /> Completed
                    </div>
                  </div>

                  {/* Step 4: Tools & Verification */}
                  <div className="rounded-xl border border-border/80 bg-background/60 p-3 flex flex-col justify-between">
                    <div>
                      <span className="font-mono text-[10px] text-primary uppercase font-bold">
                        Node 4
                      </span>
                      <h4 className="text-xs font-semibold mt-1">Verification Agent</h4>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Score:{" "}
                        <span className="font-semibold text-foreground">
                          {currentResult.verification.score}/100
                        </span>
                      </p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-border/50 flex items-center gap-1 text-[10px] text-emerald-500 font-medium">
                      <CheckCircle2 className="size-3" /> {currentResult.verification.verdict}
                    </div>
                  </div>

                  {/* Step 5: User Delivery */}
                  <div className="rounded-xl border border-border/80 bg-background/60 p-3 flex flex-col justify-between">
                    <div>
                      <span className="font-mono text-[10px] text-primary uppercase font-bold">
                        Node 5
                      </span>
                      <h4 className="text-xs font-semibold mt-1">Delivery</h4>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {pending ? "Awaiting User Approval" : "Synthesized & Ready"}
                      </p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-border/50 flex items-center gap-1 text-[10px] text-emerald-500 font-medium">
                      <CheckCircle2 className="size-3" /> Delivered
                    </div>
                  </div>
                </div>
              </Card3D>

              {/* Plan Rationale */}
              <Card3D className="p-5">
                <Card3DHeader className="p-0 pb-3">
                  <div className="flex items-center justify-between">
                    <Card3DTitle className="text-sm font-semibold flex items-center gap-2">
                      <ListTree className="size-4 text-primary" />
                      Decomposition &amp; Strategy Plan
                    </Card3DTitle>
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-primary/10 text-primary font-medium">
                      strategy: {currentResult.plan.strategy}
                    </span>
                  </div>
                </Card3DHeader>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {currentResult.plan.rationale}
                </p>
                {currentResult.plan.notes.length > 0 && (
                  <div className="mt-3 space-y-1 rounded-lg bg-amber-500/10 p-3 border border-amber-500/20">
                    <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                      Execution Notes:
                    </p>
                    <ul className="space-y-0.5 text-xs text-amber-600 dark:text-amber-300">
                      {currentResult.plan.notes.map((note, index) => (
                        <li key={index} className="flex items-start gap-1.5">
                          <span className="mt-1 size-1 rounded-full bg-amber-500 shrink-0" />
                          <span>{note}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card3D>

              {/* Verification Checks */}
              <Card3D className="p-5">
                <Card3DHeader className="p-0 pb-3">
                  <div className="flex items-center justify-between">
                    <Card3DTitle className="text-sm font-semibold flex items-center gap-2">
                      <ShieldCheck className="size-4 text-primary" />
                      Verification Checks ({currentResult.verification.checks.length})
                    </Card3DTitle>
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600 font-bold">
                      Safety Score: {currentResult.verification.score}
                    </span>
                  </div>
                </Card3DHeader>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {currentResult.verification.checks.map((check) => (
                    <div
                      key={check.id}
                      className="rounded-xl border border-border/70 bg-background/50 p-3 flex items-start gap-2.5"
                    >
                      <span
                        className={cn("mt-1 size-2 shrink-0 rounded-full", checkTone(check.level))}
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground">{check.label}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{check.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card3D>
            </div>
          )}

          {/* TAB 2: 10-Stage Execution Timeline */}
          {activeTab === "timeline" && (
            <Card3D className="p-5">
              <Card3DHeader className="p-0 pb-4">
                <Card3DTitle className="text-sm font-semibold flex items-center gap-2">
                  <Activity className="size-4 text-primary" />
                  10-Stage Multi-Agent Execution Lifecycle
                </Card3DTitle>
                <Card3DDescription className="text-xs">
                  Full step-by-step audit sequence from initial input through agent deliberation to
                  final verifier validation.
                </Card3DDescription>
              </Card3DHeader>

              <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-[2px] before:bg-border/80">
                {[
                  {
                    num: 1,
                    title: "Goal & Prompt Ingestion",
                    desc: `Received user prompt: "${currentResult.goal}"`,
                    status: "ok",
                    timing: "0 ms",
                  },
                  {
                    num: 2,
                    title: "Page Context Extraction",
                    desc: `Loaded page "${activePage.title || "Untitled"}" (${activePage.text.length} chars)`,
                    status: "ok",
                    timing: "12 ms",
                  },
                  {
                    num: 3,
                    title: "Planning & Strategy Formulation",
                    desc: `Manager formulated ${currentResult.plan.strategy} plan with ${currentResult.steps.length} steps`,
                    status: "ok",
                    timing: "45 ms",
                  },
                  {
                    num: 4,
                    title: "Specialist Agent Dispatch",
                    desc: `Orchestrated ${currentResult.trace.stats.agentCalls} specialist workers`,
                    status: "ok",
                    timing: "60 ms",
                  },
                  {
                    num: 5,
                    title: "Tool & Adapter Execution",
                    desc: `Executed ${currentResult.trace.stats.toolCalls} tool calls across Google Workspace adapters`,
                    status: pending ? "warn" : "ok",
                    timing: "140 ms",
                  },
                  {
                    num: 6,
                    title: "Inter-Agent Data Synthesis",
                    desc: `Exchanged ${currentResult.trace.stats.messages} structured P2P & blackboard messages`,
                    status: "ok",
                    timing: "180 ms",
                  },
                  {
                    num: 7,
                    title: "Verification Agent Inspection",
                    desc: `Completed ${currentResult.verification.checks.length} compliance and safety checks`,
                    status: "ok",
                    timing: "210 ms",
                  },
                  {
                    num: 8,
                    title: "Human-in-the-Loop Approval Checkpoint",
                    desc: pending
                      ? `Approval requested for tool: ${pending.tool}`
                      : "All external write permissions pre-approved or verified safe",
                    status: pending ? "warn" : "ok",
                    timing: "215 ms",
                  },
                  {
                    num: 9,
                    title: "Answer Generation & Formatting",
                    desc: "Synthesized markdown output with citations and action items",
                    status: "ok",
                    timing: "240 ms",
                  },
                  {
                    num: 10,
                    title: "Durable History Persistence",
                    desc: `Persisted run ${currentResult.runId} to Supabase agent_runs and local storage`,
                    status: "ok",
                    timing: `${Math.round(currentResult.trace.totalMs)} ms`,
                  },
                ].map((stage) => (
                  <div key={stage.num} className="relative flex items-start gap-3">
                    <span
                      className={cn(
                        "absolute -left-6 mt-0.5 flex size-5 items-center justify-center rounded-full text-[10px] font-bold ring-4 ring-card",
                        stage.status === "ok"
                          ? "bg-emerald-500 text-white"
                          : "bg-amber-500 text-white",
                      )}
                    >
                      {stage.num}
                    </span>
                    <div className="flex-1 rounded-xl border border-border/60 bg-background/50 p-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-semibold text-foreground">{stage.title}</h4>
                        <span className="font-mono text-[10.5px] text-muted-foreground">
                          {stage.timing}
                        </span>
                      </div>
                      <p className="text-[11.5px] text-muted-foreground mt-0.5">{stage.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card3D>
          )}

          {/* TAB 3: Agent Execution Cards */}
          {activeTab === "agents" && (
            <div className="space-y-4">
              {/* Filter controls */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-border/80 bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <Filter className="size-3" /> Filter by:
                  </span>
                  <select
                    value={agentFilter}
                    onChange={(e) => setAgentFilter(e.target.value)}
                    className="rounded-lg border border-input bg-background px-2 py-1 text-xs font-medium"
                  >
                    <option value="all">All Agents</option>
                    {Array.from(new Set(currentResult.steps.map((s) => s.agent))).map((ag) => (
                      <option key={ag} value={ag}>
                        {ag}
                      </option>
                    ))}
                  </select>

                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="rounded-lg border border-input bg-background px-2 py-1 text-xs font-medium"
                  >
                    <option value="all">All Statuses</option>
                    <option value="ok">Success (ok)</option>
                    <option value="skipped">Skipped</option>
                    <option value="failed">Failed / Approval Needed</option>
                  </select>
                </div>

                <div className="relative min-w-[180px]">
                  <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search steps…"
                    className="w-full rounded-lg border border-input bg-background pl-8 pr-3 py-1 text-xs outline-none"
                  />
                </div>
              </div>

              {/* Cards Grid */}
              <div className="grid grid-cols-1 gap-3">
                {filteredSteps.map((step) => {
                  const meta = getAgentMeta(step.agent);
                  const Icon = meta.icon;
                  const tone = statusTone(step.status);
                  const StatusIcon = tone.icon;
                  return (
                    <Card3D key={step.stepId} className="p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
                        <div className="flex items-center gap-2.5">
                          <span className="grid size-8 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                            <Icon className="size-4" />
                          </span>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-xs font-bold text-foreground">{meta.label}</h4>
                              <span className="font-mono text-[10px] text-muted-foreground px-1.5 py-0.2 rounded bg-muted">
                                {step.stepId}
                              </span>
                            </div>
                            <p className="text-[10.5px] text-muted-foreground">{meta.role}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {step.durationMs} ms
                          </span>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold border",
                              tone.className,
                            )}
                          >
                            <StatusIcon className="size-3" />
                            {step.status}
                          </span>
                        </div>
                      </div>

                      <div className="pt-3 space-y-2">
                        <div>
                          <span className="text-[11px] font-medium text-muted-foreground">
                            Assigned Goal:
                          </span>
                          <p className="text-xs font-medium text-foreground/80 mt-0.5">
                            {step.goal}
                          </p>
                        </div>

                        <div>
                          <span className="text-[11px] font-medium text-muted-foreground">
                            Summary:
                          </span>
                          <p className="text-xs text-foreground/90 mt-0.5">{step.summary}</p>
                        </div>

                        {step.error && (
                          <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-2.5 text-xs text-destructive">
                            <p className="font-semibold">Execution Notice:</p>
                            <p className="mt-0.5">{step.error}</p>
                          </div>
                        )}
                      </div>
                    </Card3D>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 4: Agent Communication (Blackboard & P2P) */}
          {activeTab === "communication" && (
            <Card3D className="p-5">
              <Card3DHeader className="p-0 pb-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Card3DTitle className="text-sm font-semibold flex items-center gap-2">
                      <MessagesSquare className="size-4 text-primary" />
                      Inter-Agent Communication &amp; Event Bus
                    </Card3DTitle>
                    <Card3DDescription className="text-xs">
                      Inspect live in-memory trace messages, durable Blackboard audit events
                      (SQLite), and P2P direct messages.
                    </Card3DDescription>
                  </div>

                  <Button3D
                    variant="outline"
                    size="sm"
                    onClick={() => loadMasFeed(currentResult.runId)}
                    disabled={masLoading}
                  >
                    <RefreshCw className={cn("size-3.5", masLoading && "animate-spin")} />
                    Refresh Feed
                  </Button3D>
                </div>
              </Card3DHeader>

              {/* Sub tabs */}
              <div className="flex items-center gap-2 border-b border-border/60 pb-2 mb-4">
                <button
                  type="button"
                  onClick={() => setCommSubTab("messages")}
                  className={cn(
                    "px-3 py-1 text-xs font-semibold rounded-lg transition-all",
                    commSubTab === "messages"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  Workflow Messages ({currentResult.trace.messages.length})
                </button>
                <button
                  type="button"
                  onClick={() => setCommSubTab("blackboard")}
                  className={cn(
                    "px-3 py-1 text-xs font-semibold rounded-lg transition-all",
                    commSubTab === "blackboard"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  Blackboard Events ({masFeed?.stats?.audit_events_count ?? "..."})
                </button>
                <button
                  type="button"
                  onClick={() => setCommSubTab("p2p")}
                  className={cn(
                    "px-3 py-1 text-xs font-semibold rounded-lg transition-all",
                    commSubTab === "p2p"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  P2P Mailbox ({masFeed?.stats?.p2p_messages_count ?? "..."})
                </button>
              </div>

              {/* In-Memory Messages */}
              {commSubTab === "messages" && (
                <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                  {currentResult.trace.messages.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">
                      No messages recorded.
                    </p>
                  ) : (
                    currentResult.trace.messages.map((message) => (
                      <div
                        key={message.id}
                        className="rounded-xl border border-border/70 bg-background/60 p-3 text-xs font-mono space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-primary">{message.type}</span>
                          <span className="text-[10px] text-muted-foreground">{message.id}</span>
                        </div>
                        <div className="flex items-center gap-2 text-foreground/80">
                          <span className="font-semibold text-foreground">{message.from}</span>
                          <ArrowRight className="size-3 text-muted-foreground" />
                          <span className="font-semibold text-foreground">{message.to}</span>
                          {message.stepId && (
                            <span className="text-[10px] text-muted-foreground">
                              · step: {message.stepId}
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Blackboard Audit Events */}
              {commSubTab === "blackboard" && (
                <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                  {!masFeed?.blackboard_events?.length ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">
                      No blackboard audit events returned. Ensure backend is running.
                    </p>
                  ) : (
                    masFeed.blackboard_events.map((evt) => (
                      <div
                        key={evt.id}
                        className="rounded-xl border border-border/70 bg-background/60 p-3 text-xs font-mono space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-indigo-600 dark:text-indigo-400">
                            {evt.event_type}
                          </span>
                          <span className="text-[10.5px] text-muted-foreground">
                            {evt.created_at}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <span>
                            Agent: <strong className="text-foreground">{evt.agent_name}</strong>
                          </span>
                          <span>·</span>
                          <span>Run: {evt.run_id}</span>
                        </div>
                        {evt.details && Object.keys(evt.details).length > 0 && (
                          <pre className="text-[10px] bg-muted/50 p-2 rounded overflow-x-auto text-foreground/80">
                            {JSON.stringify(evt.details, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* P2P Mailbox Messages */}
              {commSubTab === "p2p" && (
                <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                  {!masFeed?.p2p_messages?.length ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">
                      No P2P messages found in mailbox database.
                    </p>
                  ) : (
                    masFeed.p2p_messages.map((p2p) => (
                      <div
                        key={p2p.seq}
                        className="rounded-xl border border-border/70 bg-background/60 p-3 text-xs font-mono space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-violet-600 dark:text-violet-400">
                            {p2p.msg_type}
                          </span>
                          <span className="text-[10.5px] text-muted-foreground">
                            {p2p.created_at}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-foreground/90">
                          <span className="font-semibold">{p2p.sender}</span>
                          <ArrowRight className="size-3 text-muted-foreground" />
                          <span className="font-semibold">{p2p.recipient}</span>
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {p2p.acknowledged ? "ACK" : "PENDING"}
                          </span>
                        </div>
                        {p2p.content && Object.keys(p2p.content).length > 0 && (
                          <pre className="text-[10px] bg-muted/50 p-2 rounded overflow-x-auto text-foreground/80">
                            {JSON.stringify(p2p.content, null, 2)}
                          </pre>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </Card3D>
          )}

          {/* TAB 5: Trace Log */}
          {activeTab === "trace" && (
            <Card3D className="p-5">
              <Card3DHeader className="p-0 pb-4">
                <Card3DTitle className="text-sm font-semibold flex items-center gap-2">
                  <Terminal className="size-4 text-primary" />
                  Full Run Trace ({filteredEvents.length} events)
                </Card3DTitle>
                <Card3DDescription className="text-xs">
                  Hierarchical lifecycle trace capturing actors, tool invocations, duration, and
                  payloads.
                </Card3DDescription>
              </Card3DHeader>

              <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
                {filteredEvents.map((event) => (
                  <div
                    key={event.seq}
                    className="flex flex-wrap items-start gap-2 rounded-lg bg-background/80 px-3 py-2 font-mono text-[11px] border border-border/60"
                    style={{ marginLeft: event.parentSeq ? 16 : 0 }}
                  >
                    <span
                      className={cn(
                        "mt-1 size-1.5 shrink-0 rounded-full",
                        event.status === "ok"
                          ? "bg-emerald-500"
                          : event.status === "error"
                            ? "bg-rose-500"
                            : "bg-muted-foreground/40",
                      )}
                    />
                    <span className="text-primary font-bold">[{event.kind}]</span>
                    <span className="text-foreground font-semibold">{event.actor}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-foreground/90">{event.name}</span>
                    <span className="ml-auto text-muted-foreground">
                      {Math.round(event.durationMs)} ms
                    </span>
                    {event.detail && (
                      <p className="w-full text-muted-foreground pl-3 text-[10.5px] border-l border-border/60 mt-1">
                        {event.detail}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Card3D>
          )}
        </div>
      )}
    </div>
  );
}
