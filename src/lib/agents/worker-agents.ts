/**
 * Stage 4 — Worker agents that use the internal/mock tools.
 *
 * Each one is a small tool-calling agent: read the task, call its allowed
 * tools, return a structured output. None of them can reach outside its
 * allow-list, and none of them claims an action happened when it did not.
 */
import { z } from "zod";

import { BaseAgent, type AgentContext, type AgentOutput, type AgentTools } from "./agent";
import type { ExtractedDate, KbHit } from "./tools";
import { clip } from "./text-utils";
import type { TaskPayload } from "./types";

/** Text an agent should work on: explicit input first, then the captured page. */
export function resolveSourceText(explicit: string | undefined, ctx: AgentContext) {
  const text = explicit?.trim() || ctx.page.text.trim() || ctx.page.selection.trim();
  if (!text) {
    throw new Error("There is no page text to work with. Capture a page or paste text first.");
  }
  return text;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/* ------------------------------------------------------------------ */

const ExtractInput = z.object({
  kinds: z
    .array(z.enum(["dates", "links", "tasks"]))
    .min(1)
    .default(["dates"]),
  text: z.string().optional(),
});

export class ExtractorAgent extends BaseAgent {
  readonly name = "extractor";
  readonly description = "Pulls dates, links and action items out of the page.";
  readonly capabilities = [
    "extract dates",
    "extract links and emails",
    "extract action items",
  ] as const;
  readonly allowedTools = [
    "text.extract_dates",
    "text.extract_links",
    "text.extract_tasks",
  ] as const;

  protected async execute(
    task: TaskPayload,
    ctx: AgentContext,
    tools: AgentTools,
  ): Promise<AgentOutput> {
    const input = ExtractInput.parse(task.input);
    const text = resolveSourceText(input.text, ctx);
    const output: Record<string, unknown> = {};
    const parts: string[] = [];

    for (const kind of input.kinds) {
      if (kind === "dates") {
        const result = (await tools.call("text.extract_dates", { text })) as {
          dates: ExtractedDate[];
        };
        output["dates"] = result.dates;
        parts.push(plural(result.dates.length, "date"));
      } else if (kind === "links") {
        const result = (await tools.call("text.extract_links", { text })) as {
          urls: string[];
          emails: string[];
        };
        output["links"] = result;
        parts.push(plural(result.urls.length + result.emails.length, "link"));
      } else {
        const result = (await tools.call("text.extract_tasks", { text })) as { tasks: string[] };
        output["tasks"] = result.tasks;
        parts.push(plural(result.tasks.length, "action item"));
      }
    }

    return { summary: `Found ${parts.join(", ")}.`, output };
  }
}

/* ------------------------------------------------------------------ */

const SummariseInput = z.object({
  maxSentences: z.number().int().min(1).max(8).default(3),
  text: z.string().optional(),
});

export class SummarizerAgent extends BaseAgent {
  readonly name = "summarizer";
  readonly description = "Writes a short extractive summary using sentences from the page itself.";
  readonly capabilities = ["summarise page text"] as const;
  readonly allowedTools = ["text.summarize_extractive"] as const;

  protected async execute(
    task: TaskPayload,
    ctx: AgentContext,
    tools: AgentTools,
  ): Promise<AgentOutput> {
    const input = SummariseInput.parse(task.input);
    const text = resolveSourceText(input.text, ctx);
    const result = (await tools.call("text.summarize_extractive", {
      text,
      maxSentences: input.maxSentences,
    })) as { summary: string; sentences: string[]; sourceSentences: number };

    if (!result.summary) throw new Error("The text is too short to summarise.");
    return {
      summary: `Picked ${plural(result.sentences.length, "key sentence")} out of ${result.sourceSentences}.`,
      output: { summary: result.summary, sentences: result.sentences },
    };
  }
}

/* ------------------------------------------------------------------ */

const KnowledgeInput = z.object({
  query: z.string().trim().min(2),
  limit: z.number().int().min(1).max(8).default(4),
});

export class KnowledgeAgent extends BaseAgent {
  readonly name = "knowledge";
  readonly description = "Searches the reader's knowledge base and returns matching passages.";
  readonly capabilities = ["search the knowledge base"] as const;
  readonly allowedTools = ["kb.search"] as const;

  protected async execute(
    task: TaskPayload,
    _ctx: AgentContext,
    tools: AgentTools,
  ): Promise<AgentOutput> {
    const input = KnowledgeInput.parse(task.input);
    const result = (await tools.call("kb.search", { query: input.query, limit: input.limit })) as {
      backend: string;
      live: boolean;
      hits: KbHit[];
    };
    return {
      summary: result.hits.length
        ? `${plural(result.hits.length, "matching passage")} in ${result.backend}${result.live ? "" : " (demo notes)"}.`
        : `Nothing in ${result.backend} matched "${clip(input.query, 60)}".`,
      output: {
        query: input.query,
        backend: result.backend,
        live: result.live,
        hits: result.hits,
        grounded: result.hits.length > 0,
      },
    };
  }
}

/* ------------------------------------------------------------------ */

const DraftInput = z.object({
  dates: z
    .array(z.object({ text: z.string(), iso: z.string().nullable(), context: z.string() }))
    .default([]),
  tasks: z.array(z.string()).default([]),
  max: z.number().int().min(1).max(8).default(5),
});

type Draft = {
  draftId: string;
  title: string;
  due: string | null;
  status: "draft";
  persisted: false;
  note: string;
};

export class TaskDraftAgent extends BaseAgent {
  readonly name = "task-drafter";
  readonly description = "Turns extracted deadlines into reminder drafts. Drafts are never saved.";
  readonly capabilities = ["draft reminders from dates", "draft tasks from action items"] as const;
  readonly allowedTools = ["tasks.draft"] as const;

  protected async execute(
    task: TaskPayload,
    _ctx: AgentContext,
    tools: AgentTools,
  ): Promise<AgentOutput> {
    const input = DraftInput.parse(task.input);

    const wanted: { title: string; due: string | null }[] = input.dates.map((date) => ({
      title: `Deadline: ${clip(date.context, 120)}`,
      due: date.iso ?? date.text,
    }));
    if (wanted.length === 0) {
      for (const item of input.tasks) wanted.push({ title: clip(item, 150), due: null });
    }

    const drafts: Draft[] = [];
    const seen = new Set<string>();
    for (const item of wanted) {
      const key = `${item.title}|${item.due ?? ""}`;
      if (seen.has(key) || drafts.length >= input.max) continue;
      seen.add(key);
      drafts.push((await tools.call("tasks.draft", item)) as Draft);
    }

    return {
      summary: drafts.length
        ? `Prepared ${plural(drafts.length, "reminder draft")}. Nothing was saved.`
        : "There were no dates or action items to draft reminders from.",
      output: { drafts, persisted: false },
    };
  }
}
