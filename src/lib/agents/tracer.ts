import type { AgentMessage, RunTrace, TraceEvent, TraceKind } from "./types";

export type Clock = { now: () => number };

const systemClock: Clock = {
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
};

/**
 * Basic run tracing: a flat, ordered list of events with parent links, plus
 * every structured message that crossed the bus. Runs sequentially in
 * Stage 4, so a simple parent stack is enough.
 *
 * The trace stores short action summaries only. It never stores raw model
 * reasoning.
 */
export class RunTracer {
  readonly runId: string;
  private readonly clock: Clock;
  private readonly startedAtIso: string;
  private readonly t0: number;
  private readonly events: TraceEvent[] = [];
  private readonly messages: AgentMessage[] = [];
  private readonly stack: number[] = [];
  private seq = 0;

  constructor(runId: string, clock: Clock = systemClock) {
    this.runId = runId;
    this.clock = clock;
    this.t0 = clock.now();
    this.startedAtIso = new Date().toISOString();
  }

  private elapsed() {
    return Math.max(0, this.clock.now() - this.t0);
  }

  private currentParent() {
    return this.stack.length > 0 ? (this.stack[this.stack.length - 1] ?? null) : null;
  }

  /** Time an async operation and record it as one event. */
  async span<T>(
    kind: TraceKind,
    actor: string,
    name: string,
    fn: () => Promise<T>,
    describe?: (value: T) => string,
  ): Promise<T> {
    const seq = ++this.seq;
    const parentSeq = this.currentParent();
    const startMs = this.elapsed();
    const event: TraceEvent = {
      seq,
      parentSeq,
      kind,
      actor,
      name,
      status: "info",
      startMs,
      durationMs: 0,
      detail: "",
    };
    this.events.push(event);
    this.stack.push(seq);
    try {
      const value = await fn();
      event.status = "ok";
      event.detail = describe ? describe(value).slice(0, 240) : "";
      return value;
    } catch (error) {
      event.status = "error";
      event.detail = (error instanceof Error ? error.message : String(error)).slice(0, 240);
      throw error;
    } finally {
      event.durationMs = Math.max(0, this.elapsed() - startMs);
      this.stack.pop();
    }
  }

  /** Record an instantaneous note (a ReAct thought summary, a check result). */
  note(
    kind: TraceKind,
    actor: string,
    name: string,
    detail: string,
    status: TraceEvent["status"] = "info",
  ) {
    this.events.push({
      seq: ++this.seq,
      parentSeq: this.currentParent(),
      kind,
      actor,
      name,
      status,
      startMs: this.elapsed(),
      durationMs: 0,
      detail: detail.slice(0, 240),
    });
  }

  recordMessage(message: AgentMessage) {
    this.messages.push(message);
  }

  finish(): RunTrace {
    const totalMs = this.elapsed();
    const toolCalls = this.events.filter((event) => event.kind === "tool").length;
    const agentCalls = this.events.filter((event) => event.kind === "agent").length;
    return {
      runId: this.runId,
      startedAt: this.startedAtIso,
      endedAt: new Date().toISOString(),
      totalMs,
      events: this.events.map((event) => ({ ...event })),
      messages: this.messages.map((message) => ({ ...message })),
      stats: {
        agentCalls,
        toolCalls,
        messages: this.messages.length,
        errors: this.events.filter((event) => event.status === "error").length,
      },
    };
  }
}
