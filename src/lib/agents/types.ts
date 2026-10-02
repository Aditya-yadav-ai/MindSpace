/**
 * Stage 4 — Agent framework: shared types.
 *
 * Everything in `src/lib/agents` is plain TypeScript with no server-only
 * imports, so the same framework runs in the browser preview, in a server
 * function (later stages) and inside unit tests.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Page context handed to a workflow (mirrors the Stage 2 capture).    */
/* ------------------------------------------------------------------ */

export type WorkflowPage = {
  title: string;
  url: string;
  selection: string;
  text: string;
};

/* ------------------------------------------------------------------ */
/* Structured agent-to-agent messages                                  */
/* ------------------------------------------------------------------ */

export const MESSAGE_TYPES = ["task", "result", "plan", "verification", "error"] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

/** Runtime-validated envelope. Every message on the bus must satisfy it. */
export const AgentMessageEnvelope = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  parentId: z.string().nullable(),
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.enum(MESSAGE_TYPES),
  stepId: z.string().nullable(),
  payload: z.record(z.unknown()),
  createdAt: z.string().min(1),
});

export type AgentMessage<P extends Record<string, Json> = Record<string, Json>> = Omit<
  z.infer<typeof AgentMessageEnvelope>,
  "payload"
> & { payload: P };

/** Manager → agent: do this one piece of work. */
export type TaskPayload = {
  instruction: string;
  input: Record<string, Json>;
};

/** Agent → manager: the work succeeded. */
export type ResultPayload = {
  ok: true;
  summary: string;
  output: Record<string, Json>;
  toolCalls: number;
};

/** Agent → manager: the work failed. Never disguised as a success. */
export type ErrorPayload = {
  ok: false;
  code: string;
  message: string;
};

/* ------------------------------------------------------------------ */
/* Planning                                                            */
/* ------------------------------------------------------------------ */

export type PlanStep = {
  id: string;
  agent: string;
  goal: string;
  /**
   * Static input for the agent. A value shaped `{ "$ref": "s1.dates" }`
   * is replaced by the manager with that field of an earlier step's output.
   */
  input: Record<string, Json>;
  dependsOn: string[];
};

export type Plan = {
  goal: string;
  steps: PlanStep[];
  rationale: string;
  strategy: string;
  /** Things the planner could not do (unknown agent, no page text, ...). */
  notes: string[];
};

/* ------------------------------------------------------------------ */
/* Verification                                                        */
/* ------------------------------------------------------------------ */

export type CheckLevel = "pass" | "warn" | "fail";

export type VerificationCheck = {
  id: string;
  label: string;
  level: CheckLevel;
  detail: string;
};

export type Verdict = "pass" | "pass_with_warnings" | "fail";

export type VerificationReport = {
  verdict: Verdict;
  score: number;
  checks: VerificationCheck[];
};

/* ------------------------------------------------------------------ */
/* Tracing                                                             */
/* ------------------------------------------------------------------ */

export type TraceKind = "run" | "plan" | "agent" | "tool" | "react" | "verify" | "message";

export type TraceEvent = {
  seq: number;
  parentSeq: number | null;
  kind: TraceKind;
  actor: string;
  name: string;
  status: "ok" | "error" | "info";
  /** Milliseconds since the run started. */
  startMs: number;
  durationMs: number;
  /** Short, human-readable note. Never raw model reasoning. */
  detail: string;
};

export type RunTrace = {
  runId: string;
  startedAt: string;
  endedAt: string;
  totalMs: number;
  events: TraceEvent[];
  messages: AgentMessage[];
  stats: {
    agentCalls: number;
    toolCalls: number;
    messages: number;
    errors: number;
  };
};

/* ------------------------------------------------------------------ */
/* Workflow result                                                     */
/* ------------------------------------------------------------------ */

export type StepStatus = "ok" | "failed" | "skipped";

export type StepResult = {
  stepId: string;
  agent: string;
  goal: string;
  status: StepStatus;
  summary: string;
  output: Record<string, Json>;
  error: string | null;
  durationMs: number;
};

export type WorkflowStatus = "verified" | "partial" | "failed";

export type WorkflowResult = {
  runId: string;
  goal: string;
  status: WorkflowStatus;
  plan: Plan;
  steps: StepResult[];
  verification: VerificationReport;
  answer: string;
  trace: RunTrace;
};

/* ------------------------------------------------------------------ */
/* Small shared helpers                                                */
/* ------------------------------------------------------------------ */

/** JSON-serialisable value: what every tool/agent output, task input and
 * traced message payload is restricted to, so a workflow result can cross
 * the server function boundary without a "may not be serializable" error. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

let counter = 0;

/** Short unique id, stable enough for a single browser session or process. */
export function makeId(prefix: string) {
  counter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${counter.toString(36)}${random}`;
}

/** Look up `a.b.c` inside a plain object. Returns undefined when missing. */
export function readPath(source: unknown, path: string[]): unknown {
  let current: unknown = source;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Deep-clone through JSON to guarantee a value is plain, serialisable data. */
export function toJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
