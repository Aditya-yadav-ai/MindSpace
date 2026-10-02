/**
 * Stage 4 — Planner Agent.
 *
 * Turns a goal into an ordered `Plan` of steps, each assigned to one
 * registered agent. Deterministic and rule-based (no LLM credentials
 * needed): it matches goal keywords against agent capabilities and wires
 * steps together with `dependsOn` plus `$ref` inputs so later steps can use
 * earlier steps' output. An agent named in the goal but not registered is
 * dropped with a note instead of silently producing a broken plan.
 */
import { contentTokens } from "./text-utils";
import { makeId, type Json, type Plan, type PlanStep } from "./types";
import type { AgentRegistry } from "./agent";

export type PlanIntent =
  | "extract"
  | "summarize"
  | "research"
  | "remind"
  | "ask_knowledge"
  | "gmail"
  | "calendar"
  | "drive"
  | "docs"
  | "sheets"
  | "slides"
  | "forms"
  | "meet"
  | "classroom"
  | "chat"
  | "product"
  | "task_manage";

const INTENT_KEYWORDS: Record<PlanIntent, RegExp> = {
  extract: /\b(extract|dates?|deadlines?|links?|tasks?|action items?)\b/i,
  summarize: /\b(summar(y|ize|ise)|brief|tl;?dr)\b/i,
  research: /\b(research|investigate|look into|cross[- ]check|find out)\b/i,
  remind: /\b(remind\w*|task list|to-?do)\b/i,
  ask_knowledge: /\b(knowledge base|notes|my documents|previously saved|kb)\b/i,
  gmail: /\b(email|e-mail|gmail|inbox)\b/i,
  calendar: /\b(calendar|meeting|schedule|event|appointment)\b/i,
  drive: /\b(drive|save (?:it|this|a copy) to|upload)\b/i,
  docs: /\b(google docs?|a doc\b|document)\b/i,
  sheets: /\b(sheets?|spreadsheet)\b/i,
  slides: /\b(slides?|presentation|deck)\b/i,
  forms: /\b(google forms?|a form\b|survey)\b/i,
  meet: /\b(meet link|video call|meeting link|google meet)\b/i,
  classroom: /\b(classroom|coursework|assignment)\b/i,
  chat: /\b(google chat|chat space|chat message)\b/i,
  product: /\b(product|price|buy|purchase|shop(?:ping)?)\b/i,
  task_manage:
    /\b(save (?:a |this )?reminder|create a (?:real )?task|add (?:a |this )?(?:task|reminder)|list my (?:tasks|reminders)|mark .* done|complete (?:the |this |my )?(?:task|reminder)|delete (?:the |this |my )?(?:task|reminder))\b/i,
};

/**
 * Cross-service "webflow" chain (Stage 7): read a linked page, extract its
 * tasks, write a report doc, save it to Drive and prepare a calendar event —
 * only when the goal both links to a page and names at least two of those
 * downstream actions, so an ordinary summarisation goal never triggers it.
 */
const URL_IN_GOAL = /https?:\/\/[^\s<>"')\]]+/i;
const REPORT_WORDS = /\b(report|doc|document)\b/i;
const DRIVE_WORDS = /\b(drive|save (?:it|this|a copy))\b/i;
const CALENDAR_WORDS = /\b(calendar|event|remind(?:er)?|meeting)\b/i;

function isWebflowGoal(goal: string, url: string | null): boolean {
  if (!url) return false;
  const hits = [REPORT_WORDS.test(goal), DRIVE_WORDS.test(goal), CALENDAR_WORDS.test(goal)].filter(
    Boolean,
  ).length;
  return hits >= 2;
}

function buildWebflowPlan(goal: string, url: string): Plan {
  const steps: PlanStep[] = [
    { id: "s1", agent: "webreader", goal: "Read the linked page.", input: { url }, dependsOn: [] },
    {
      id: "s2",
      agent: "extractor",
      goal: "Extract action items and dates from the page.",
      input: { kinds: ["tasks", "dates"], text: { $ref: "s1.page.text" } },
      dependsOn: ["s1"],
    },
    {
      id: "s3",
      agent: "docs",
      goal: "Create a report doc from the page.",
      input: { action: "create", title: { $ref: "s1.page.title" }, body: { $ref: "s1.page.text" } },
      dependsOn: ["s1"],
    },
    {
      id: "s4",
      agent: "drive",
      goal: "Save a copy of the report to Drive.",
      input: {
        action: "save",
        name: { $ref: "s1.page.title" },
        content: { $ref: "s1.page.text" },
        mimeType: "text/plain",
      },
      dependsOn: ["s1"],
    },
    {
      id: "s5",
      agent: "calendar",
      goal: "Prepare a calendar event for the first action item found.",
      input: { action: "create", summary: { $ref: "s2.tasks.0" } },
      dependsOn: ["s2"],
    },
  ];
  return {
    goal,
    steps,
    strategy: "hierarchical",
    rationale:
      'Detected a cross-service "read a page → report → Drive → Calendar" workflow: webreader reads the linked page, extractor pulls out action items, then docs/drive/calendar each reuse that output via $ref chaining.',
    notes: [
      "The calendar step only has a title from the page — it still needs a start and end time, which the agent will ask for.",
      "docs.create, drive.save_file and calendar.create_event all write to your real Google account and are held for your approval before they run.",
    ],
  };
}

function detectIntents(goal: string): PlanIntent[] {
  const found = (Object.keys(INTENT_KEYWORDS) as PlanIntent[]).filter((intent) =>
    INTENT_KEYWORDS[intent].test(goal),
  );
  return found.length > 0 ? found : ["summarize"];
}

/**
 * Build a plan for `goal` using only agents present in `registry`.
 * Falls back to whichever relevant agents are actually registered, and
 * records anything it could not plan for in `notes`.
 */
export function planGoal(goal: string, registry: AgentRegistry, hasPageText: boolean): Plan {
  const intents = detectIntents(goal);
  const notes: string[] = [];
  const steps: PlanStep[] = [];

  const have = (name: string) => registry.has(name);
  const missing = (name: string, reason: string) => {
    if (!have(name)) notes.push(`Skipped ${reason}: agent "${name}" is not registered.`);
    return have(name);
  };

  const goalUrl = goal.match(URL_IN_GOAL)?.[0] ?? null;
  if (
    isWebflowGoal(goal, goalUrl) &&
    ["webreader", "extractor", "docs", "drive", "calendar"].every(have)
  ) {
    return buildWebflowPlan(goal, goalUrl!);
  }

  if (!hasPageText && (intents.includes("extract") || intents.includes("summarize"))) {
    notes.push(
      "No page text is captured — steps that read the page will fall back to the question text only.",
    );
  }

  let extractStep: PlanStep | null = null;
  if (intents.includes("extract") || intents.includes("remind")) {
    if (missing("extractor", "extraction")) {
      extractStep = {
        id: "s1",
        agent: "extractor",
        goal: "Extract dates, links and action items from the page.",
        input: { kinds: ["dates", "links", "tasks"] },
        dependsOn: [],
      };
      steps.push(extractStep);
    }
  }

  if (intents.includes("summarize") && missing("summarizer", "summarisation")) {
    steps.push({
      id: `s${steps.length + 1}`,
      agent: "summarizer",
      goal: "Summarise the page in a few sentences.",
      input: { maxSentences: 3 },
      dependsOn: [],
    });
  }

  if (intents.includes("ask_knowledge") && missing("knowledge", "a knowledge-base search")) {
    steps.push({
      id: `s${steps.length + 1}`,
      agent: "knowledge",
      goal: "Search the knowledge base for passages related to the question.",
      input: { query: goal, limit: 4 },
      dependsOn: [],
    });
  }

  if (intents.includes("research") && missing("researcher", "a multi-step investigation")) {
    steps.push({
      id: `s${steps.length + 1}`,
      agent: "researcher",
      goal: "Investigate the question step by step, using tools as needed.",
      input: { question: goal },
      dependsOn: [],
    });
  }

  if (intents.includes("gmail") && missing("gmail", "Gmail")) {
    const wantsDraft = /\b(draft|write|send|compose)\b/i.test(goal);
    steps.push({
      id: `s${steps.length + 1}`,
      agent: "gmail",
      goal: wantsDraft
        ? "Prepare an email draft (does not send it)."
        : "Search recent Gmail messages.",
      input: wantsDraft ? { action: "draft" } : { action: "list", query: goal },
      dependsOn: [],
    });
    if (wantsDraft)
      notes.push(
        "Drafting an email needs a recipient, subject and body — the agent will ask if any are missing.",
      );
  }

  if (intents.includes("calendar") && missing("calendar", "Calendar")) {
    const wantsCreate = /\b(create|add|schedule|book)\b/i.test(goal);
    steps.push({
      id: `s${steps.length + 1}`,
      agent: "calendar",
      goal: wantsCreate ? "Create a calendar event." : "List upcoming calendar events.",
      input: wantsCreate ? { action: "create" } : { action: "list" },
      dependsOn: [],
    });
    if (wantsCreate)
      notes.push(
        "Creating an event needs a title, start and end time — the agent will ask if any are missing.",
      );
  }

  if (intents.includes("drive") && missing("drive", "Drive")) {
    const wantsSave = /\b(save|upload|store|export)\b/i.test(goal);
    steps.push({
      id: `s${steps.length + 1}`,
      agent: "drive",
      goal: wantsSave ? "Save a file to Drive." : "Search Drive files.",
      input: wantsSave ? { action: "save" } : { action: "search", query: goal },
      dependsOn: [],
    });
    if (wantsSave)
      notes.push("Saving a file needs a name and content — the agent will ask if any are missing.");
  }

  const wantsCreate = /\b(create|new|make|start)\b/i.test(goal);

  if (intents.includes("docs") && missing("docs", "Docs")) {
    steps.push({
      id: `s${steps.length + 1}`,
      agent: "docs",
      goal: wantsCreate ? "Create a Google Doc." : "Read a Google Doc.",
      input: wantsCreate ? { action: "create" } : { action: "read" },
      dependsOn: [],
    });
    notes.push(
      wantsCreate
        ? "Creating a doc needs a title — the agent will ask if missing."
        : "Reading a doc needs its document ID.",
    );
  }

  if (intents.includes("sheets") && missing("sheets", "Sheets")) {
    steps.push({
      id: `s${steps.length + 1}`,
      agent: "sheets",
      goal: wantsCreate ? "Create a Google Sheet." : "Read a range from a Google Sheet.",
      input: wantsCreate ? { action: "create" } : { action: "read" },
      dependsOn: [],
    });
    notes.push(
      wantsCreate
        ? "Creating a sheet needs a title — the agent will ask if missing."
        : "Reading a sheet needs a spreadsheet ID and range.",
    );
  }

  if (intents.includes("slides") && missing("slides", "Slides")) {
    steps.push({
      id: `s${steps.length + 1}`,
      agent: "slides",
      goal: wantsCreate ? "Create a Google Slides presentation." : "Read a presentation's outline.",
      input: wantsCreate ? { action: "create" } : { action: "read" },
      dependsOn: [],
    });
    notes.push(
      wantsCreate
        ? "Creating a deck needs a title — the agent will ask if missing."
        : "Reading a presentation needs its ID.",
    );
  }

  if (intents.includes("forms") && missing("forms", "Forms")) {
    steps.push({
      id: `s${steps.length + 1}`,
      agent: "forms",
      goal: wantsCreate ? "Create a Google Form." : "Read a form's responses.",
      input: wantsCreate ? { action: "create" } : { action: "read_responses" },
      dependsOn: [],
    });
    notes.push(
      wantsCreate
        ? "Creating a form needs a title — the agent will ask if missing."
        : "Reading responses needs a form ID.",
    );
  }

  if (intents.includes("meet") && missing("meet", "Meet")) {
    steps.push({
      id: `s${steps.length + 1}`,
      agent: "meet",
      goal: "Create a Google Meet link.",
      input: {},
      dependsOn: [],
    });
  }

  if (intents.includes("classroom") && missing("classroom", "Classroom")) {
    steps.push({
      id: `s${steps.length + 1}`,
      agent: "classroom",
      goal: "List the user's active Classroom courses.",
      input: { action: "list_courses" },
      dependsOn: [],
    });
  }

  if (intents.includes("chat") && missing("chat", "Chat")) {
    const wantsSend = /\b(send|message|tell|notify)\b/i.test(goal);
    steps.push({
      id: `s${steps.length + 1}`,
      agent: "chat",
      goal: wantsSend ? "Send a Google Chat message." : "List the user's Chat spaces.",
      input: wantsSend ? { action: "send" } : { action: "list_spaces" },
      dependsOn: [],
    });
    if (wantsSend)
      notes.push(
        "Sending a chat message needs a space and message text — the agent will ask if missing.",
      );
  }

  if (intents.includes("remind") && missing("task-drafter", "reminder drafting")) {
    const stepId = `s${steps.length + 1}`;
    const dependsOn: string[] = [];
    const input: Record<string, Json> = { max: 5 };
    if (extractStep) {
      dependsOn.push(extractStep.id);
      input["dates"] = { $ref: `${extractStep.id}.dates` };
      input["tasks"] = { $ref: `${extractStep.id}.tasks` };
    }
    steps.push({
      id: stepId,
      agent: "task-drafter",
      goal: "Draft reminders for anything time-bound found so far.",
      input,
      dependsOn,
    });
  }

  if (intents.includes("product") && missing("product", "product identification")) {
    steps.push({
      id: `s${steps.length + 1}`,
      agent: "product",
      goal: "Identify a product and its related links.",
      input: goalUrl ? { url: goalUrl } : {},
      dependsOn: [],
    });
    if (!goalUrl)
      notes.push(
        "No product URL was given — the agent will look for a link on the captured page instead.",
      );
  }

  if (intents.includes("task_manage") && missing("reminders", "saved reminders")) {
    const wantsDelete = /\b(delete|remove)\b/i.test(goal);
    const wantsComplete = /\b(complete|mark .* done|finish(?:ed)?)\b/i.test(goal);
    const wantsList = /\b(list|show|what are|view)\b/i.test(goal);
    const action = wantsDelete
      ? "delete"
      : wantsComplete
        ? "complete"
        : wantsList
          ? "list"
          : "create";
    steps.push({
      id: `s${steps.length + 1}`,
      agent: "reminders",
      goal:
        action === "create"
          ? "Save a real reminder."
          : action === "list"
            ? "List saved reminders."
            : action === "complete"
              ? "Mark a reminder as done."
              : "Delete a reminder.",
      input: { action },
      dependsOn: [],
    });
    if (action !== "list")
      notes.push(
        `Reminder ${action === "create" ? "creation" : action} may need extra detail (a title, or which task) — the agent will ask if anything is missing.`,
      );
  }

  if (steps.length === 0) {
    // Nothing matched a known intent with a registered agent — fall back to
    // whichever general-purpose agent exists so the run still does something.
    const fallback = ["summarizer", "researcher", "knowledge", "extractor"].find((name) =>
      have(name),
    );
    if (fallback) {
      steps.push({
        id: "s1",
        agent: fallback,
        goal: `Best-effort handling of: ${goal}`,
        input:
          fallback === "knowledge"
            ? { query: goal }
            : fallback === "researcher"
              ? { question: goal }
              : {},
        dependsOn: [],
      });
      notes.push(`No agent matched the goal precisely; falling back to "${fallback}".`);
    } else {
      notes.push("No registered agent could handle this goal.");
    }
  }

  const tokenHint = contentTokens(goal).slice(0, 6).join(", ");
  return {
    goal,
    steps,
    strategy: "hierarchical",
    rationale: `Matched intent(s): ${intents.join(", ")}${tokenHint ? ` (key terms: ${tokenHint})` : ""}. Steps run in dependency order; a task-drafter step waits for extraction so it can reuse the dates found there.`,
    notes,
  };
}

export function newRunId() {
  return makeId("run");
}
