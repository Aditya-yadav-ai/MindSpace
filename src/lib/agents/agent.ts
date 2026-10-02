/**
 * Stage 4 — Agent interface, base class, registry and message bus.
 *
 * A concrete agent only implements `execute`. The base class takes care of
 * the parts every agent must do the same way: enforcing its tool allow-list,
 * tracing each call, and turning success or failure into a structured
 * message. Failures are always reported as `error` messages, never disguised
 * as results.
 */
import type { RunTracer } from "./tracer";
import { ToolError, type ToolContext, type ToolRegistry } from "./tools";
import type { GoogleServices } from "@/lib/google/adapter.server";
import type { TaskService } from "@/lib/reminders/types";
import {
  AgentMessageEnvelope,
  makeId,
  type AgentMessage,
  type ErrorPayload,
  type Json,
  type MessageType,
  type ResultPayload,
  type TaskPayload,
  type WorkflowPage,
} from "./types";

export type AgentContext = {
  runId: string;
  goal: string;
  page: WorkflowPage;
  tracer: RunTracer;
  tools: ToolRegistry;
  /** Tool names the user has approved for this run. */
  approvals: ReadonlySet<string>;
  /** Stage 5 — Google services for the signed-in user (or a not-connected stub). */
  google: GoogleServices;
  /** Stage 7 — persisted task/reminder storage for the signed-in user (or a stub). */
  tasks: TaskService;
};

export type AgentOutput = {
  summary: string;
  output: Record<string, unknown>;
};

/** What an agent can use while it runs: guarded, traced tool calls. */
export type AgentTools = {
  call: (name: string, input: unknown) => Promise<unknown>;
};

export type AgentDescriptor = {
  name: string;
  description: string;
  capabilities: string[];
  tools: string[];
  strategy: string;
};

/** The contract every agent in MindSpace satisfies. */
export interface Agent {
  readonly name: string;
  readonly description: string;
  readonly capabilities: readonly string[];
  readonly allowedTools: readonly string[];
  readonly strategy: string;
  describe(): AgentDescriptor;
  handle(
    message: AgentMessage<TaskPayload>,
    ctx: AgentContext,
  ): Promise<AgentMessage<ResultPayload> | AgentMessage<ErrorPayload>>;
}

export function createMessage<P extends Record<string, Json>>(args: {
  runId: string;
  from: string;
  to: string;
  type: MessageType;
  payload: P;
  parentId?: string | null;
  stepId?: string | null;
}): AgentMessage<P> {
  return {
    id: makeId("msg"),
    runId: args.runId,
    parentId: args.parentId ?? null,
    from: args.from,
    to: args.to,
    type: args.type,
    stepId: args.stepId ?? null,
    payload: args.payload,
    createdAt: new Date().toISOString(),
  };
}

function compactOutput(output: unknown) {
  try {
    return JSON.stringify(output).slice(0, 120);
  } catch {
    return "";
  }
}

export abstract class BaseAgent implements Agent {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly capabilities: readonly string[];
  abstract readonly allowedTools: readonly string[];
  readonly strategy: string = "tool-calling";
  /** Message type used for this agent's successful reply. */
  protected readonly replyType: MessageType = "result";

  protected abstract execute(
    task: TaskPayload,
    ctx: AgentContext,
    tools: AgentTools,
  ): Promise<AgentOutput>;

  describe(): AgentDescriptor {
    return {
      name: this.name,
      description: this.description,
      capabilities: [...this.capabilities],
      tools: [...this.allowedTools],
      strategy: this.strategy,
    };
  }

  async handle(
    message: AgentMessage<TaskPayload>,
    ctx: AgentContext,
  ): Promise<AgentMessage<ResultPayload> | AgentMessage<ErrorPayload>> {
    let toolCalls = 0;

    const tools: AgentTools = {
      call: async (toolName, input) => {
        if (!this.allowedTools.includes(toolName)) {
          const error = new ToolError(
            "tool_not_allowed",
            `${this.name} is not allowed to use ${toolName}.`,
          );
          ctx.tracer.note("tool", this.name, toolName, error.message, "error");
          throw error;
        }
        toolCalls += 1;
        const toolCtx: ToolContext = {
          runId: ctx.runId,
          actor: this.name,
          approvals: ctx.approvals,
          google: ctx.google,
          tasks: ctx.tasks,
        };
        const invocation = await ctx.tracer.span(
          "tool",
          this.name,
          toolName,
          () => ctx.tools.invoke(toolName, input, toolCtx),
          (result) => `${result.mock ? "mock · " : ""}${compactOutput(result.output)}`,
        );
        return invocation.output;
      },
    };

    try {
      const result = await ctx.tracer.span(
        "agent",
        this.name,
        message.stepId ? `${this.name} · ${message.stepId}` : this.name,
        () => this.execute(message.payload, ctx, tools),
        (value) => value.summary,
      );
      return createMessage<ResultPayload>({
        runId: ctx.runId,
        from: this.name,
        to: message.from,
        type: this.replyType,
        parentId: message.id,
        stepId: message.stepId,
        payload: {
          ok: true,
          summary: result.summary,
          output: result.output as Record<string, Json>,
          toolCalls,
        },
      });
    } catch (error) {
      const code = error instanceof ToolError ? error.code : "agent_failed";
      const text = error instanceof Error ? error.message : "The agent failed.";
      return createMessage<ErrorPayload>({
        runId: ctx.runId,
        from: this.name,
        to: message.from,
        type: "error",
        parentId: message.id,
        stepId: message.stepId,
        payload: { ok: false, code, message: text },
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export class AgentRegistry {
  private readonly agents = new Map<string, Agent>();

  register(agent: Agent) {
    if (this.agents.has(agent.name))
      throw new Error(`Agent "${agent.name}" is already registered.`);
    this.agents.set(agent.name, agent);
    return this;
  }

  has(name: string) {
    return this.agents.has(name);
  }

  get(name: string) {
    return this.agents.get(name);
  }

  names() {
    return [...this.agents.keys()];
  }

  list(): AgentDescriptor[] {
    return [...this.agents.values()].map((agent) => agent.describe());
  }
}

/* ------------------------------------------------------------------ */
/* Message bus                                                         */
/* ------------------------------------------------------------------ */

/**
 * Delivers structured messages between agents. Every message is validated
 * against the envelope schema and logged to the run trace, both directions.
 */
export class MessageBus {
  private readonly registry: AgentRegistry;
  private readonly tracer: RunTracer;

  constructor(registry: AgentRegistry, tracer: RunTracer) {
    this.registry = registry;
    this.tracer = tracer;
  }

  async dispatch(
    message: AgentMessage<TaskPayload>,
    ctx: AgentContext,
  ): Promise<AgentMessage<ResultPayload> | AgentMessage<ErrorPayload>> {
    const check = AgentMessageEnvelope.safeParse(message);
    if (!check.success) {
      throw new Error(
        `Rejected malformed agent message: ${check.error.issues[0]?.message ?? "invalid"}`,
      );
    }
    this.tracer.recordMessage(message);

    const target = this.registry.get(message.to);
    const reply = target
      ? await target.handle(message, ctx)
      : createMessage<ErrorPayload>({
          runId: message.runId,
          from: "bus",
          to: message.from,
          type: "error",
          parentId: message.id,
          stepId: message.stepId,
          payload: {
            ok: false,
            code: "unknown_agent",
            message: `No agent named "${message.to}" is registered.`,
          },
        });

    this.tracer.recordMessage(reply);
    return reply;
  }
}
