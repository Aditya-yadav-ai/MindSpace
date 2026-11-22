/**
 * Stage 4 — Manager/Orchestrator Agent.
 *
 * Coordinates a run: ask the Planner for a plan, dispatch each step (in
 * dependency order) to its agent over the message bus, resolve `$ref` inputs
 * against earlier outputs, hand everything to the Verification Agent, and
 * assemble the final `WorkflowResult`. Runs sequentially — this is the
 * "hierarchical" architecture named in the plan's `strategy` field; Stage 10
 * is where alternative architectures get compared.
 */
import type { Agent, AgentContext } from "./agent";
import { AgentRegistry, MessageBus, createMessage } from "./agent";
import { planGoal, newRunId } from "./planner";
import { RunTracer } from "./tracer";
import { ToolRegistry, createBuiltinTools, createMockKbBackend, type KbBackend } from "./tools";
import { ExtractorAgent, KnowledgeAgent, SummarizerAgent, TaskDraftAgent } from "./worker-agents";
import { HeuristicReasoner, ResearchAgent, type Reasoner } from "./research-agent";
import { GmailAgent, CalendarAgent, DriveAgent } from "./google-agents";
import { createGoogleTools } from "./google-tools";
import {
  DocsAgent,
  SheetsAgent,
  SlidesAgent,
  FormsAgent,
  MeetAgent,
  ClassroomAgent,
  ChatAgent,
} from "./google-workspace-agents";
import { createGoogleWorkspaceTools } from "./google-workspace-tools";
import {
  GoogleTasksAgent,
  GoogleContactsAgent,
  GoogleMapsAgent,
  YouTubeAgent,
} from "./google-extended-agents";
import { createGoogleExtendedTools } from "./google-extended-tools";
import { createWebTools } from "./web-tools";
import { createReminderTools } from "./reminder-tools";
import { WebReaderAgent } from "./web-reader-agent";
import { ProductAgent } from "./product-agent";
import { ReminderAgent } from "./reminder-agent";
import { verifyWorkflow } from "./verifier";
import { notConnectedGoogleServices } from "../google/not-connected";
import { notConnectedTaskService } from "../reminders/not-connected";
import type { GoogleServices } from "../google/adapter.server";
import type { TaskService } from "../reminders/types";
import {
  readPath,
  type ErrorPayload,
  type Json,
  type Plan,
  type ResultPayload,
  type StepResult,
  type TaskPayload,
  type WorkflowPage,
  type WorkflowResult,
  type WorkflowStatus,
} from "./types";

export type BuildMindSpaceAgentsOptions = {
  kb?: KbBackend;
  reasoner?: Reasoner;
};

/** Registers the Stage 4 worker agents plus the Stage 5 Google agents and their tools. */
export function buildMindSpaceAgents(options: BuildMindSpaceAgentsOptions = {}) {
  const kb = options.kb ?? createMockKbBackend();
  const tools = new ToolRegistry();
  for (const tool of createBuiltinTools(kb)) tools.register(tool);
  for (const tool of createGoogleTools()) tools.register(tool);
  for (const tool of createGoogleWorkspaceTools()) tools.register(tool);
  for (const tool of createGoogleExtendedTools()) tools.register(tool);
  for (const tool of createWebTools()) tools.register(tool);
  for (const tool of createReminderTools()) tools.register(tool);

  const registry = new AgentRegistry();
  const agents: Agent[] = [
    new ExtractorAgent(),
    new SummarizerAgent(),
    new KnowledgeAgent(),
    new TaskDraftAgent(),
    new ResearchAgent({ reasoner: options.reasoner ?? new HeuristicReasoner() }),
    new GmailAgent(),
    new CalendarAgent(),
    new DriveAgent(),
    new DocsAgent(),
    new SheetsAgent(),
    new SlidesAgent(),
    new FormsAgent(),
    new MeetAgent(),
    new ClassroomAgent(),
    new ChatAgent(),
    new GoogleTasksAgent(),
    new GoogleContactsAgent(),
    new GoogleMapsAgent(),
    new YouTubeAgent(),
    new WebReaderAgent(),
    new ProductAgent(),
    new ReminderAgent(),
  ];
  for (const agent of agents) registry.register(agent);

  return { tools, registry };
}

function resolveRefs(
  input: Record<string, unknown>,
  outputs: Map<string, Record<string, unknown>>,
): Record<string, Json> {
  const resolveValue = (value: unknown): unknown => {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "$ref" in (value as Record<string, unknown>)
    ) {
      const ref = String((value as Record<string, unknown>)["$ref"]);
      const [stepId, ...path] = ref.split(".");
      const stepOutput = stepId ? outputs.get(stepId) : undefined;
      return stepOutput ? readPath(stepOutput, path) : undefined;
    }
    if (Array.isArray(value)) return value.map(resolveValue);
    if (value && typeof value === "object") {
      const next: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value as Record<string, unknown>))
        next[key] = resolveValue(inner);
      return next;
    }
    return value;
  };

  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) resolved[key] = resolveValue(value);
  return resolved as Record<string, Json>;
}

export type RunWorkflowOptions = {
  goal: string;
  page?: Partial<WorkflowPage>;
  /** Tool names the user has pre-approved (confirmation-gated tools only). */
  approvals?: string[];
  /** Stage 5 — Google services for the signed-in user. Defaults to a "not connected" stub. */
  google?: GoogleServices;
  /** Stage 7 — persisted task service for the signed-in user. Defaults to a "not signed in" stub. */
  tasks?: TaskService;
  registry?: AgentRegistry;
  tools?: ToolRegistry;
  plan?: Plan;
};

const emptyPage: WorkflowPage = { title: "", url: "", selection: "", text: "" };

function overallStatus(
  steps: StepResult[],
  verificationVerdict: WorkflowStatus | "pass" | "pass_with_warnings" | "fail",
): WorkflowStatus {
  const anyFailed = steps.some((step) => step.status === "failed");
  if (
    verificationVerdict === "fail" ||
    (anyFailed && steps.every((step) => step.status === "failed"))
  )
    return "failed";
  if (anyFailed || verificationVerdict === "pass_with_warnings") return "partial";
  return "verified";
}

/**
 * Run one multi-agent workflow end to end: plan → dispatch → verify.
 * This is the Manager Agent's job, expressed as a function so Stage 4 does
 * not need a long-lived server process to demonstrate it.
 */
export async function runWorkflow(options: RunWorkflowOptions): Promise<WorkflowResult> {
  const page: WorkflowPage = { ...emptyPage, ...options.page };
  const built =
    options.registry && options.tools
      ? { registry: options.registry, tools: options.tools }
      : buildMindSpaceAgents();
  const { registry, tools } = built;

  const runId = newRunId();
  const tracer = new RunTracer(runId);
  const bus = new MessageBus(registry, tracer);
  const approvals = new Set(options.approvals ?? []);
  const manager = "manager";

  const plan =
    options.plan ??
    (await tracer.span(
      "plan",
      manager,
      "planner",
      async () =>
        planGoal(options.goal, registry, Boolean(page.text.trim() || page.selection.trim())),
      (value) =>
        `${value.steps.length} step(s): ${value.steps.map((step) => step.agent).join(" → ") || "none"}`,
    ));

  const google = options.google ?? notConnectedGoogleServices;
  const taskService = options.tasks ?? notConnectedTaskService;
  const ctx: AgentContext = {
    runId,
    goal: options.goal,
    page,
    tracer,
    tools,
    approvals,
    google,
    tasks: taskService,
  };
  const outputs = new Map<string, Record<string, unknown>>();
  const steps: StepResult[] = [];
  const done = new Set<string>();

  const remaining = [...plan.steps];
  let guard = remaining.length * 2 + 4;

  while (remaining.length > 0 && guard-- > 0) {
    const nextIndex = remaining.findIndex((step) => step.dependsOn.every((dep) => done.has(dep)));
    if (nextIndex === -1) {
      for (const step of remaining) {
        steps.push({
          stepId: step.id,
          agent: step.agent,
          goal: step.goal,
          status: "skipped",
          summary: "Skipped — a dependency never completed.",
          output: {},
          error: "Unresolved dependency.",
          durationMs: 0,
        });
      }
      break;
    }
    const step = remaining.splice(nextIndex, 1)[0]!;
    const started = Date.now();

    const task = createMessage<TaskPayload>({
      runId,
      from: manager,
      to: step.agent,
      type: "task",
      stepId: step.id,
      payload: { instruction: step.goal, input: resolveRefs(step.input, outputs) },
    });

    const reply = await bus.dispatch(task, ctx);
    const durationMs = Date.now() - started;

    if (reply.type === "result") {
      const payload = reply.payload as ResultPayload;
      outputs.set(step.id, payload.output);
      steps.push({
        stepId: step.id,
        agent: step.agent,
        goal: step.goal,
        status: "ok",
        summary: payload.summary,
        output: payload.output,
        error: null,
        durationMs,
      });
      done.add(step.id);
    } else {
      const payload = reply.payload as ErrorPayload;
      steps.push({
        stepId: step.id,
        agent: step.agent,
        goal: step.goal,
        status: "failed",
        summary: `Failed: ${payload.message}`,
        output: {},
        error: payload.message,
        durationMs,
      });
      // Downstream steps that depend on this one will be skipped above.
    }
  }

  const verification = await tracer.span(
    "verify",
    "verifier",
    "verify-workflow",
    async () => verifyWorkflow(steps, page, plan, approvals),
    (value) => `${value.verdict} (score ${value.score})`,
  );

  const answerParts = steps.filter((step) => step.status === "ok").map((step) => step.summary);
  const answer = answerParts.length > 0 ? answerParts.join(" ") : "No step produced output.";

  const trace = tracer.finish();
  return {
    runId,
    goal: options.goal,
    status: overallStatus(steps, verification.verdict),
    plan,
    steps,
    verification,
    answer,
    trace,
  };
}
