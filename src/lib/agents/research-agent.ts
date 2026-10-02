/**
 * Stage 4 — ReAct-style Research Agent.
 *
 * The agent runs a bounded Thought → Action → Observation loop:
 *   1. a `Reasoner` looks at the goal and every observation so far and picks
 *      the next tool call (or decides it is done);
 *   2. the agent runs that tool through the guarded, traced tool interface;
 *   3. the tool result becomes the next observation.
 *
 * Only a one-sentence *thought summary* is kept for observability — never
 * raw model reasoning. Tool output is treated as untrusted data: the loop
 * never executes instructions found inside an observation.
 *
 * The bundled `HeuristicReasoner` is deterministic and needs no credentials.
 * A model-backed reasoner can be dropped in later by implementing `Reasoner`;
 * the loop, limits and tracing stay the same.
 */
import { z } from "zod";

import { BaseAgent, type AgentContext, type AgentOutput, type AgentTools } from "./agent";
import { clip, contentTokens } from "./text-utils";
import type { ExtractedDate, KbHit } from "./tools";
import type { FetchedPage, WebSearchHit } from "./web-tools";
import type { TaskPayload } from "./types";

export type ReactAction = { tool: string; input: Record<string, unknown> };

export type ReactStep = {
  index: number;
  /** One-sentence summary of why this action was chosen. */
  thought: string;
  action: ReactAction;
  ok: boolean;
  /** Short text form of the observation, safe to show and to log. */
  observation: string;
  /** Raw tool output, available to the reasoner only. */
  result: unknown;
};

export type ReactState = {
  goal: string;
  hasPageText: boolean;
  toolNames: readonly string[];
  steps: readonly ReactStep[];
  maxSteps: number;
};

export type ReactDecision =
  | { kind: "act"; thought: string; action: ReactAction }
  | { kind: "finish"; thought: string; answer: string; data: Record<string, unknown> };

export interface Reasoner {
  readonly name: string;
  next(state: ReactState): Promise<ReactDecision>;
}

/** Placeholder a reasoner uses for "the captured page text". The agent swaps it in. */
export const PAGE_TEXT_PLACEHOLDER = "$PAGE";

/* ------------------------------------------------------------------ */
/* Deterministic reasoner                                              */
/* ------------------------------------------------------------------ */

const GENERIC_WORDS = new Set([
  "research",
  "related",
  "note",
  "knowledge",
  "base",
  "document",
  "saved",
  "information",
  "anything",
]);

function findSteps(steps: readonly ReactStep[], tool: string) {
  return steps.filter((step) => step.action.tool === tool);
}

export function summariseFindings(steps: readonly ReactStep[]) {
  const data: Record<string, unknown> = {};
  const lines: string[] = [];

  const dateStep = findSteps(steps, "text.extract_dates").find((step) => step.ok);
  if (dateStep) {
    const dates = ((dateStep.result as { dates?: ExtractedDate[] } | null)?.dates ??
      []) as ExtractedDate[];
    data["dates"] = dates;
    lines.push(
      dates.length
        ? `Dates on the page: ${dates.map((date) => date.iso ?? date.text).join(", ")}.`
        : "No dates were found on the page.",
    );
  }

  const kbSteps = findSteps(steps, "kb.search").filter((step) => step.ok);
  const lastKb = kbSteps[kbSteps.length - 1];
  if (lastKb) {
    const payload = lastKb.result as { hits?: KbHit[]; backend?: string; live?: boolean } | null;
    const hits = payload?.hits ?? [];
    data["hits"] = hits;
    data["queries"] = kbSteps.map((step) => String(step.action.input["query"] ?? ""));
    lines.push(
      hits.length
        ? `Related notes: ${hits.map((hit) => `“${hit.title}”`).join(", ")}${payload?.live === false ? " (demo notes)" : ""}.`
        : "No related notes were found in the knowledge base.",
    );
  }

  const fetchStep = findSteps(steps, "web.fetch_page").find((step) => step.ok);
  if (fetchStep) {
    const page = fetchStep.result as FetchedPage | null;
    if (page) {
      data["page"] = { url: page.finalUrl, title: page.title };
      lines.push(`Fetched "${page.title}" (${page.finalUrl}).`);
    }
  }

  const searchSteps = findSteps(steps, "web.search").filter((step) => step.ok);
  const lastSearch = searchSteps[searchSteps.length - 1];
  if (lastSearch) {
    const hits = (lastSearch.result as WebSearchHit[] | null) ?? [];
    data["webResults"] = hits;
    lines.push(
      hits.length
        ? `Web search found: ${hits.map((hit) => hit.title).join(", ")}.`
        : "The web search returned no results.",
    );
  }

  const failed = steps.filter((step) => !step.ok);
  if (failed.length)
    lines.push(
      `${failed.length} step(s) failed: ${failed.map((step) => step.action.tool).join(", ")}.`,
    );

  return { answer: lines.join(" ") || "No findings.", data };
}

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/i;

export class HeuristicReasoner implements Reasoner {
  readonly name = "heuristic-reasoner";

  async next(state: ReactState): Promise<ReactDecision> {
    const { goal, steps } = state;
    const wantsDates = /\b(deadline|deadlines|due|date|dates|when)\b/i.test(goal);
    const done = (thought: string): ReactDecision => {
      const { answer, data } = summariseFindings(steps);
      return { kind: "finish", thought, answer, data };
    };

    const last = steps[steps.length - 1];
    if (last && !last.ok)
      return done("A tool call failed, so I am stopping with the partial findings.");

    const goalUrl = goal.match(URL_PATTERN)?.[0];
    if (
      goalUrl &&
      state.toolNames.includes("web.fetch_page") &&
      findSteps(steps, "web.fetch_page").length === 0
    ) {
      return {
        kind: "act",
        thought: "The goal links to a page, so I will read it before answering.",
        action: { tool: "web.fetch_page", input: { url: goalUrl } },
      };
    }

    const wantsWebSearch =
      /\b(search the web|look (?:it |this )?up online|find out online|latest|current(?:ly)?)\b/i.test(
        goal,
      );
    if (
      wantsWebSearch &&
      !goalUrl &&
      state.toolNames.includes("web.search") &&
      findSteps(steps, "web.search").length === 0
    ) {
      const tokens = contentTokens(goal).filter((token) => !GENERIC_WORDS.has(token));
      return {
        kind: "act",
        thought: "The goal asks for current/online information, so I will search the web.",
        action: {
          tool: "web.search",
          input: { query: tokens.slice(0, 6).join(" ") || goal, limit: 5 },
        },
      };
    }

    if (
      wantsDates &&
      state.hasPageText &&
      state.toolNames.includes("text.extract_dates") &&
      findSteps(steps, "text.extract_dates").length === 0
    ) {
      return {
        kind: "act",
        thought:
          "The goal is about deadlines, so I need the dates on the page before searching notes.",
        action: { tool: "text.extract_dates", input: { text: PAGE_TEXT_PLACEHOLDER } },
      };
    }

    const kbSteps = findSteps(steps, "kb.search");
    if (state.toolNames.includes("kb.search")) {
      const tokens = contentTokens(goal).filter((token) => !GENERIC_WORDS.has(token));
      if (kbSteps.length === 0) {
        const query = (tokens.slice(0, 5).join(" ") || "deadline").trim();
        return {
          kind: "act",
          thought: "Now I will look for related passages in the knowledge base.",
          action: { tool: "kb.search", input: { query, limit: 4 } },
        };
      }

      const lastKb = kbSteps[kbSteps.length - 1];
      const hits = ((lastKb?.result as { hits?: unknown[] } | null)?.hits ?? []).length;
      if (lastKb && hits === 0 && kbSteps.length < 2) {
        const previous = String(lastKb.action.input["query"] ?? "");
        const broader = tokens.slice(0, 2).join(" ") || "deadline";
        if (broader !== previous) {
          return {
            kind: "act",
            thought: "The first search found nothing, so I will retry with a broader query.",
            action: { tool: "kb.search", input: { query: broader, limit: 4 } },
          };
        }
      }
    }

    return done("I have what I need, so I am writing up the findings.");
  }
}

/* ------------------------------------------------------------------ */
/* The agent                                                           */
/* ------------------------------------------------------------------ */

const ResearchInput = z.object({
  question: z.string().trim().min(3).max(600),
});

export class ResearchAgent extends BaseAgent {
  readonly name = "researcher";
  override readonly strategy = "ReAct (thought → action → observation)";
  readonly description =
    "Investigates a question step by step, choosing tools based on what it observes — including reading a linked page or searching the web when the goal calls for it.";
  readonly capabilities = [
    "multi-step investigation",
    "cross-check page dates against notes",
    "read a linked web page",
    "search the web (when configured)",
  ] as const;
  readonly allowedTools = [
    "text.extract_dates",
    "text.extract_tasks",
    "kb.search",
    "web.fetch_page",
    "web.search",
  ] as const;

  private readonly reasoner: Reasoner;
  private readonly maxSteps: number;

  constructor(options: { reasoner?: Reasoner; maxSteps?: number } = {}) {
    super();
    this.reasoner = options.reasoner ?? new HeuristicReasoner();
    this.maxSteps = Math.min(Math.max(options.maxSteps ?? 5, 1), 8);
  }

  protected async execute(
    task: TaskPayload,
    ctx: AgentContext,
    tools: AgentTools,
  ): Promise<AgentOutput> {
    const input = ResearchInput.parse(task.input);
    const pageText = ctx.page.text.trim() || ctx.page.selection.trim();
    const steps: ReactStep[] = [];
    let stoppedBy: "final" | "max_steps" = "max_steps";
    let answer = "";
    let data: Record<string, unknown> = {};

    for (let index = 1; index <= this.maxSteps; index += 1) {
      const decision = await ctx.tracer.span(
        "react",
        this.name,
        `step ${index} · decide`,
        () =>
          this.reasoner.next({
            goal: input.question,
            hasPageText: pageText.length > 0,
            toolNames: this.allowedTools,
            steps,
            maxSteps: this.maxSteps,
          }),
        (value) => value.thought,
      );

      if (decision.kind === "finish") {
        answer = decision.answer;
        data = decision.data;
        stoppedBy = "final";
        break;
      }

      const toolInput: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(decision.action.input)) {
        toolInput[key] = value === PAGE_TEXT_PLACEHOLDER ? pageText : value;
      }

      let ok = true;
      let result: unknown = null;
      let observation: string;
      try {
        result = await tools.call(decision.action.tool, toolInput);
        observation = clip(JSON.stringify(result), 500);
      } catch (error) {
        ok = false;
        observation = error instanceof Error ? error.message : "The tool failed.";
      }

      ctx.tracer.note(
        "react",
        this.name,
        `step ${index} · observe`,
        `${decision.action.tool} → ${ok ? clip(observation, 120) : `error: ${observation}`}`,
        ok ? "ok" : "error",
      );

      steps.push({
        index,
        thought: decision.thought,
        action: { tool: decision.action.tool, input: decision.action.input },
        ok,
        observation,
        result,
      });
    }

    if (stoppedBy === "max_steps") {
      const findings = summariseFindings(steps);
      answer = `Stopped at the ${this.maxSteps}-step limit. ${findings.answer}`;
      data = findings.data;
    }

    return {
      summary: `${stoppedBy === "final" ? "Finished" : "Hit step limit"} after ${steps.length} tool step${steps.length === 1 ? "" : "s"}: ${clip(answer, 160)}`,
      output: {
        answer,
        stoppedBy,
        data,
        steps: steps.map(({ result: _result, ...rest }) => rest),
      },
    };
  }
}
