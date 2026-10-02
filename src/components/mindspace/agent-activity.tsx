/**
 * Stage 4 — Agent Activity view.
 * Lets a signed-in reader run a demo multi-agent workflow (Manager →
 * Planner → worker agents → Verifier) against the currently captured page,
 * and shows the plan, per-step results, structured messages and trace.
 */
import { useServerFn } from "@tanstack/react-start";
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleX,
  ListTree,
  LoaderCircle,
  MessagesSquare,
  Network,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { runAgentWorkflow } from "@/lib/agents.functions";
import type { PageContext } from "@/components/mindspace/page-context";
import type { StepStatus, VerificationCheck, WorkflowResult } from "@/lib/agents";
import { cn } from "@/lib/utils";

const SAMPLE_GOALS = [
  "Summarize this page and pull out any deadlines",
  "Extract dates and links, then draft reminders",
  "Research this question using my knowledge base",
  "Draft an email about this page",
  "What's on my calendar next?",
  "Create a Google Doc from this page",
  "Create a Meet link",
  "Save a reminder about this page",
  "Find the product and price at https://example.org/product/aurora-lamp",
  "Read https://example.org/aurora-grant/notice, create a report doc, save it to Drive and add a calendar reminder",
];

/** ToolError messages for confirmation-gated tools always start with the tool name — see agents/tools.ts. */
function findPendingApproval(result: WorkflowResult): { tool: string; agent: string } | null {
  for (const step of result.steps) {
    if (step.status !== "failed" || !step.error) continue;
    const match = /^(\S+) changes real data and needs the user's approval/.exec(step.error);
    if (match) return { tool: match[1]!, agent: step.agent };
  }
  return null;
}

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

const SAMPLE_PAGE = {
  title: "Aurora Grant — Submission Notice",
  url: "https://example.org/aurora-grant/notice",
  selection: "",
  text: "The Aurora grant submission deadline is 2026-11-14. Applicants must submit the signed consent form, the final budget sheet and a short project summary. Late submissions will not be accepted. Direct questions to grants@example.org or see https://example.org/aurora-grant/faq for the reviewer contact list.",
};

function statusTone(status: StepStatus) {
  if (status === "ok") return { icon: CheckCircle2, className: "text-positive" };
  if (status === "skipped") return { icon: CircleAlert, className: "text-caution" };
  return { icon: CircleX, className: "text-destructive" };
}

function checkTone(level: VerificationCheck["level"]) {
  if (level === "pass") return "text-positive";
  if (level === "warn") return "text-caution";
  return "text-destructive";
}

function verdictLabel(status: WorkflowResult["status"]) {
  if (status === "verified") return { text: "Verified", className: "bg-positive/15 text-positive" };
  if (status === "partial")
    return { text: "Partial — see warnings", className: "bg-caution/15 text-caution" };
  return { text: "Failed", className: "bg-destructive/15 text-destructive" };
}

export function AgentActivity({ signedIn, context }: { signedIn: boolean; context: PageContext }) {
  const run = useServerFn(runAgentWorkflow);
  const [goal, setGoal] = useState(SAMPLE_GOALS[0]!);
  const [useSample, setUseSample] = useState(!context.text.trim());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WorkflowResult | null>(null);
  const [showTrace, setShowTrace] = useState(false);
  const [showMessages, setShowMessages] = useState(false);
  const [approvals, setApprovals] = useState<string[]>([]);

  const activePage = useSample || !context.text.trim() ? SAMPLE_PAGE : context;

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-3xl">
        <Header />
        <div className="mt-7 grid min-h-72 place-items-center rounded-lg bg-panel/60 p-8 text-center ring-1 ring-foreground/5">
          <div>
            <Bot className="mx-auto size-6 text-primary" />
            <p className="mt-4 text-sm font-medium">Sign in to run agent workflows</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-foreground/50">
              The Manager Agent runs server-side under your account.
            </p>
          </div>
        </div>
      </div>
    );
  }

  async function submit(withApprovals: string[] = []) {
    if (goal.trim().length < 3 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const output = await run({
        data: { goal: goal.trim(), page: activePage, approvals: withApprovals },
      });
      setResult(output);
      setApprovals(withApprovals);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The workflow could not run.");
    } finally {
      setBusy(false);
    }
  }

  const pending = result ? findPendingApproval(result) : null;

  return (
    <div className="mx-auto max-w-3xl">
      <Header />

      <div className="mt-6 rounded-lg bg-panel/60 p-4 ring-1 ring-foreground/5">
        <label className="block text-xs font-medium text-foreground">
          Goal for the Manager Agent
          <textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            rows={2}
            placeholder="e.g. Summarize this page and pull out any deadlines"
            className="mt-1.5 w-full resize-none rounded-md border border-input bg-background/70 px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SAMPLE_GOALS.map((sample) => (
            <button
              key={sample}
              onClick={() => setGoal(sample)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs ring-1 ring-foreground/10 transition-colors",
                goal === sample
                  ? "bg-primary/15 text-primary"
                  : "text-foreground/60 hover:bg-accent",
              )}
            >
              {sample}
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-foreground/50">
          <span>
            Page in use:{" "}
            <span className="font-medium text-foreground/75">{activePage.title || "Untitled"}</span>
            {useSample || !context.text.trim() ? " (sample page)" : " (captured page)"}
          </span>
          {context.text.trim() && (
            <button
              className="text-primary hover:text-primary/75"
              onClick={() => setUseSample((value) => !value)}
            >
              {useSample ? "Use captured page instead" : "Use sample page instead"}
            </button>
          )}
        </div>

        <Button
          className="mt-3"
          onClick={() => void submit()}
          disabled={busy || goal.trim().length < 3}
        >
          {busy ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
          {busy ? "Running workflow…" : "Run multi-agent workflow"}
        </Button>
        {error && (
          <p
            className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>

      {result && (
        <div className="mt-5 space-y-4">
          <div className="rounded-lg bg-panel/60 p-4 ring-1 ring-foreground/5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium",
                  verdictLabel(result.status).className,
                )}
              >
                {verdictLabel(result.status).text}
              </span>
              <span className="font-mono text-[11px] text-foreground/45">{result.runId}</span>
              <span className="font-mono text-[11px] text-foreground/45">
                {Math.round(result.trace.totalMs)} ms
              </span>
              <span className="font-mono text-[11px] text-foreground/45">
                {result.trace.stats.agentCalls} agent calls · {result.trace.stats.toolCalls} tool
                calls · {result.trace.stats.messages} messages
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-foreground/80">{result.answer}</p>
            {pending && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-md bg-caution/10 p-3 ring-1 ring-caution/20">
                <p className="text-xs leading-5 text-caution">
                  The {pending.agent} agent wants to{" "}
                  {TOOL_LABELS[pending.tool] ?? `run ${pending.tool}`}. Nothing was written to your
                  Google account yet — approve to let it through.
                </p>
                <Button
                  size="sm"
                  onClick={() => void submit([...approvals, pending.tool])}
                  disabled={busy}
                >
                  Approve &amp; continue
                </Button>
              </div>
            )}
          </div>

          <Section icon={ListTree} title="Plan" subtitle={`strategy: ${result.plan.strategy}`}>
            <p className="text-xs leading-5 text-foreground/60">{result.plan.rationale}</p>
            {result.plan.notes.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-caution">
                {result.plan.notes.map((note, index) => (
                  <li key={index}>· {note}</li>
                ))}
              </ul>
            )}
          </Section>

          <Section icon={Network} title="Agent steps">
            <ol className="space-y-2">
              {result.steps.map((step) => {
                const tone = statusTone(step.status);
                const Icon = tone.icon;
                return (
                  <li
                    key={step.stepId}
                    className="rounded-md bg-background/50 p-3 ring-1 ring-foreground/5"
                  >
                    <div className="flex items-center gap-2 text-xs">
                      <Icon className={cn("size-3.5 shrink-0", tone.className)} />
                      <span className="font-medium">{step.stepId}</span>
                      <span className="text-foreground/40">·</span>
                      <span className="font-mono text-foreground/60">{step.agent}</span>
                      <span className="ml-auto font-mono text-[10px] text-foreground/35">
                        {step.durationMs} ms
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs leading-5 text-foreground/65">{step.summary}</p>
                  </li>
                );
              })}
            </ol>
          </Section>

          <Section
            icon={ShieldCheck}
            title="Verification"
            subtitle={`score ${result.verification.score}`}
          >
            <ul className="space-y-1.5">
              {result.verification.checks.map((check) => (
                <li key={check.id} className="flex items-start gap-2 text-xs">
                  <span
                    className={cn(
                      "mt-0.5 size-1.5 shrink-0 rounded-full",
                      checkTone(check.level).replace("text-", "bg-"),
                    )}
                  />
                  <div>
                    <span className={cn("font-medium", checkTone(check.level))}>{check.label}</span>
                    <p className="text-foreground/55">{check.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <Collapsible
            icon={MessagesSquare}
            title={`Agent-to-agent messages (${result.trace.messages.length})`}
            open={showMessages}
            onToggle={() => setShowMessages((value) => !value)}
          >
            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {result.trace.messages.map((message) => (
                <div
                  key={message.id}
                  className="rounded bg-background/50 p-2 font-mono text-[10.5px] leading-5 text-foreground/60 ring-1 ring-foreground/5"
                >
                  <span className="text-primary">{message.type}</span> · {message.from} →{" "}
                  {message.to}
                  {message.stepId ? ` · ${message.stepId}` : ""}
                </div>
              ))}
            </div>
          </Collapsible>

          <Collapsible
            icon={Network}
            title={`Run trace (${result.trace.events.length} events)`}
            open={showTrace}
            onToggle={() => setShowTrace((value) => !value)}
          >
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {result.trace.events.map((event) => (
                <div
                  key={event.seq}
                  className="flex items-start gap-2 rounded bg-background/50 px-2 py-1.5 font-mono text-[10.5px] leading-5 ring-1 ring-foreground/5"
                  style={{ marginLeft: event.parentSeq ? 12 : 0 }}
                >
                  <span
                    className={cn(
                      "mt-0.5 size-1.5 shrink-0 rounded-full",
                      event.status === "ok"
                        ? "bg-positive"
                        : event.status === "error"
                          ? "bg-destructive"
                          : "bg-foreground/30",
                    )}
                  />
                  <span className="text-foreground/40">[{event.kind}]</span>
                  <span className="text-foreground/75">{event.actor}</span>
                  <span className="text-foreground/40">·</span>
                  <span>{event.name}</span>
                  <span className="ml-auto shrink-0 text-foreground/35">
                    {Math.round(event.durationMs)} ms
                  </span>
                  {event.detail && (
                    <span className="w-full text-foreground/45">{event.detail}</span>
                  )}
                </div>
              ))}
            </div>
          </Collapsible>
        </div>
      )}
    </div>
  );
}

function Header() {
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary">MindSpace</p>
      <h1 className="mt-2 font-display text-3xl font-medium">Agent activity</h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-foreground/60">
        The Manager Agent plans a run, hands steps to specialised agents over structured messages,
        and a Verification Agent checks the result before you see it. Every tool here is internal or
        a clearly marked mock — nothing is sent, saved or deleted.
      </p>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: typeof ListTree;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-panel/60 p-4 ring-1 ring-foreground/5">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && (
          <span className="ml-auto font-mono text-[10.5px] text-foreground/40">{subtitle}</span>
        )}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Collapsible({
  icon: Icon,
  title,
  open,
  onToggle,
  children,
}: {
  icon: typeof ListTree;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-panel/60 p-4 ring-1 ring-foreground/5">
      <button className="flex w-full items-center gap-2" onClick={onToggle}>
        <Icon className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">{title}</h2>
        <ChevronDown
          className={cn(
            "ml-auto size-4 text-foreground/40 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}
