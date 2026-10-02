/**
 * Stage 4 — Tool registry and the built-in internal/mock tools.
 *
 * Tools are explicit and typed: every tool has a zod input schema, a flag
 * saying whether it is a mock, and a flag saying whether it needs human
 * confirmation before it may run. The registry validates input and enforces
 * the confirmation rule for every call, so an agent cannot skip either.
 */
import { z } from "zod";

import { clip, contentTokens, normaliseWhitespace, splitSentences } from "./text-utils";
import { makeId } from "./types";
import type { GoogleServices } from "@/lib/google/adapter.server";
import type { TaskService } from "@/lib/reminders/types";

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export type ToolContext = {
  runId: string;
  actor: string;
  /** Tool names the user has explicitly approved for this run. */
  approvals: ReadonlySet<string>;
  /** Stage 5 — Google services for the signed-in user (or a not-connected stub). */
  google: GoogleServices;
  /** Stage 7 — persisted task/reminder storage for the signed-in user (or a stub). */
  tasks: TaskService;
};

export type ToolDefinition<I, O> = {
  name: string;
  description: string;
  inputSchema: z.ZodType<I, z.ZodTypeDef, unknown>;
  /** True when the tool returns canned/in-memory data instead of a real service. */
  mock: boolean;
  /** True when a human must approve the call first (sending, deleting, ...). */
  requiresConfirmation: boolean;
  execute: (input: I, ctx: ToolContext) => Promise<O> | O;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = ToolDefinition<any, any>;

export function defineTool<I, O>(tool: ToolDefinition<I, O>): ToolDefinition<I, O> {
  return tool;
}

export type ToolErrorCode =
  "unknown_tool" | "invalid_input" | "confirmation_required" | "tool_failed" | "tool_not_allowed";

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  constructor(code: ToolErrorCode, message: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}

export type ToolDescriptor = {
  name: string;
  description: string;
  mock: boolean;
  requiresConfirmation: boolean;
};

export type ToolInvocation = { output: unknown; mock: boolean };

export class ToolRegistry {
  private readonly tools = new Map<string, AnyTool>();

  register(tool: AnyTool) {
    if (this.tools.has(tool.name)) throw new Error(`Tool "${tool.name}" is already registered.`);
    this.tools.set(tool.name, tool);
    return this;
  }

  has(name: string) {
    return this.tools.has(name);
  }

  get(name: string) {
    return this.tools.get(name);
  }

  list(): ToolDescriptor[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      mock: tool.mock,
      requiresConfirmation: tool.requiresConfirmation,
    }));
  }

  async invoke(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolInvocation> {
    const tool = this.tools.get(name);
    if (!tool) throw new ToolError("unknown_tool", `No tool named "${name}" is registered.`);

    const parsed = tool.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      throw new ToolError(
        "invalid_input",
        `Invalid input for ${name} — ${where}${issue?.message ?? "bad input"}.`,
      );
    }

    if (tool.requiresConfirmation && !ctx.approvals.has(name)) {
      throw new ToolError(
        "confirmation_required",
        `${name} changes real data and needs the user's approval first. Nothing was executed.`,
      );
    }

    try {
      const output = await tool.execute(parsed.data, ctx);
      return { output, mock: tool.mock };
    } catch (error) {
      if (error instanceof ToolError) throw error;
      throw new ToolError(
        "tool_failed",
        error instanceof Error ? error.message : "The tool failed.",
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Date extraction                                                     */
/* ------------------------------------------------------------------ */

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const MONTH_PATTERN =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";

const DATE_REGEXES: RegExp[] = [
  /\b\d{4}-\d{2}-\d{2}\b/g,
  new RegExp(`\\b${MONTH_PATTERN}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, "gi"),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_PATTERN}\\.?(?:,?\\s+\\d{4})?\\b`, "gi"),
];

export type ExtractedDate = { text: string; iso: string | null; context: string };

function toIso(raw: string): string | null {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, year, month, day] = iso;
    return validIso(Number(year), Number(month), Number(day));
  }
  const monthMatch = raw.toLowerCase().match(/[a-z]+/);
  const monthName = monthMatch?.[0];
  if (!monthName) return null;
  const monthIndex = MONTHS.findIndex((name) => name.startsWith(monthName.slice(0, 3)));
  const numbers = raw.match(/\d+/g) ?? [];
  const day = Number(numbers[0]);
  const year = numbers[1] ? Number(numbers[1]) : NaN;
  if (monthIndex < 0 || !Number.isFinite(year)) return null;
  return validIso(year, monthIndex + 1, day);
}

function validIso(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export function extractDates(text: string): ExtractedDate[] {
  const sentences = splitSentences(text);
  const seen = new Set<string>();
  const found: ExtractedDate[] = [];
  for (const sentence of sentences) {
    for (const regex of DATE_REGEXES) {
      regex.lastIndex = 0;
      for (const match of sentence.matchAll(regex)) {
        const value = normaliseWhitespace(match[0]);
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ text: value, iso: toIso(value), context: clip(sentence, 200) });
      }
    }
  }
  return found;
}

/* ------------------------------------------------------------------ */
/* Link, task and summary extraction                                   */
/* ------------------------------------------------------------------ */

export function extractLinks(text: string) {
  const urls = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    urls.add(match[0].replace(/[.,;:!?]+$/, ""));
  }
  const emails = new Set<string>();
  for (const match of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    emails.add(match[0].replace(/[.,;:!?]+$/, ""));
  }
  return { urls: [...urls], emails: [...emails] };
}

const ACTION_PATTERN =
  /\b(must|need(?:s)? to|should|required to|remember to|don't forget|deadline|due|submit|to-?do|action item)\b/i;

export function extractActionSentences(text: string, limit = 12): string[] {
  return splitSentences(text)
    .filter((sentence) => sentence.length >= 15 && ACTION_PATTERN.test(sentence))
    .map((sentence) => clip(sentence, 240))
    .slice(0, limit);
}

/** Frequency-scored extractive summary: returns real sentences from the text. */
export function summariseExtractive(text: string, maxSentences = 3) {
  const sentences = splitSentences(text).filter((sentence) => sentence.length >= 25);
  if (sentences.length === 0) return { summary: "", sentences: [] as string[], sourceSentences: 0 };

  const frequency = new Map<string, number>();
  for (const sentence of sentences) {
    for (const token of contentTokens(sentence))
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }

  const scored = sentences.map((sentence, index) => {
    const tokens = contentTokens(sentence);
    const base = tokens.reduce((sum, token) => sum + (frequency.get(token) ?? 0), 0);
    const lengthPenalty = Math.sqrt(Math.max(tokens.length, 1));
    const positionBonus = index === 0 ? 1.4 : index === 1 ? 1.15 : 1;
    return { sentence, index, score: (base / lengthPenalty) * positionBonus };
  });

  const chosen = scored
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, maxSentences))
    .sort((a, b) => a.index - b.index)
    .map((item) => item.sentence);

  return { summary: chosen.join(" "), sentences: chosen, sourceSentences: sentences.length };
}

/* ------------------------------------------------------------------ */
/* Knowledge search backend (pluggable)                                */
/* ------------------------------------------------------------------ */

export type KbHit = {
  documentId: string | null;
  title: string;
  excerpt: string;
  score: number;
};

export type KbBackend = {
  name: string;
  /** False for the in-memory demo corpus. */
  live: boolean;
  search: (query: string, limit: number) => Promise<KbHit[]>;
};

const MOCK_CORPUS: { title: string; body: string }[] = [
  {
    title: "Aurora submission checklist",
    body: "Before the Aurora submission deadline, upload the signed consent form, the final budget sheet and the reviewer contact list. Late submissions are not accepted.",
  },
  {
    title: "Team offsite notes",
    body: "The team offsite covers roadmap planning and a retrospective. Book travel early and share dietary requirements with the organiser.",
  },
  {
    title: "Grant reporting calendar",
    body: "Interim grant reports are due at the end of each quarter. The finance office reviews every report and expects the budget sheet to match the ledger.",
  },
  {
    title: "Reading list: agent architectures",
    body: "Notes on planner, executor and verifier agent patterns, ReAct-style tool use, and how structured messages keep multi-agent systems debuggable.",
  },
];

export function createMockKbBackend(): KbBackend {
  return {
    name: "demo-notes",
    live: false,
    async search(query, limit) {
      const queryTokens = new Set(contentTokens(query));
      if (queryTokens.size === 0) return [];
      return MOCK_CORPUS.map((doc) => {
        const docTokens = new Set(contentTokens(`${doc.title} ${doc.body}`));
        let matched = 0;
        for (const token of queryTokens) if (docTokens.has(token)) matched += 1;
        return {
          documentId: null,
          title: doc.title,
          excerpt: doc.body,
          score: Math.round((matched / queryTokens.size) * 100) / 100,
        };
      })
        .filter((hit) => hit.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Built-in tools                                                      */
/* ------------------------------------------------------------------ */

const TextInput = z.object({ text: z.string().min(1, "text is required").max(200_000) });

export function createBuiltinTools(kb: KbBackend = createMockKbBackend()) {
  const extractDatesTool = defineTool({
    name: "text.extract_dates",
    description: "Find calendar dates and deadlines written in a block of text.",
    inputSchema: TextInput,
    mock: false,
    requiresConfirmation: false,
    execute: ({ text }) => ({ dates: extractDates(text) }),
  });

  const extractLinksTool = defineTool({
    name: "text.extract_links",
    description: "Find URLs and email addresses in a block of text.",
    inputSchema: TextInput,
    mock: false,
    requiresConfirmation: false,
    execute: ({ text }) => extractLinks(text),
  });

  const extractTasksTool = defineTool({
    name: "text.extract_tasks",
    description: "Find sentences that describe something the reader must do.",
    inputSchema: TextInput,
    mock: false,
    requiresConfirmation: false,
    execute: ({ text }) => ({ tasks: extractActionSentences(text) }),
  });

  const summariseTool = defineTool({
    name: "text.summarize_extractive",
    description: "Pick the most representative sentences from a block of text.",
    inputSchema: z.object({
      text: z.string().min(1, "text is required").max(200_000),
      maxSentences: z.number().int().min(1).max(8).default(3),
    }),
    mock: false,
    requiresConfirmation: false,
    execute: ({ text, maxSentences }) => summariseExtractive(text, maxSentences),
  });

  const kbSearchTool = defineTool({
    name: "kb.search",
    description: `Search the reader's knowledge base (${kb.live ? "live index" : "demo notes, not the real index"}).`,
    inputSchema: z.object({
      query: z.string().trim().min(2, "query is too short").max(300),
      limit: z.number().int().min(1).max(8).default(4),
    }),
    mock: !kb.live,
    requiresConfirmation: false,
    execute: async ({ query, limit }) => {
      const hits = await kb.search(query, limit);
      return { backend: kb.name, live: kb.live, hits };
    },
  });

  const draftTaskTool = defineTool({
    name: "tasks.draft",
    description: "Prepare a task or reminder draft. Drafts are not saved anywhere.",
    inputSchema: z.object({
      title: z.string().trim().min(1, "title is required").max(160),
      due: z.string().trim().max(60).nullable().default(null),
    }),
    mock: true,
    requiresConfirmation: false,
    execute: ({ title, due }) => ({
      draftId: makeId("draft"),
      title,
      due,
      status: "draft" as const,
      persisted: false as const,
      note: "Draft only — nothing was saved to any task list.",
    }),
  });

  return [
    extractDatesTool,
    extractLinksTool,
    extractTasksTool,
    summariseTool,
    kbSearchTool,
    draftTaskTool,
  ];
}
