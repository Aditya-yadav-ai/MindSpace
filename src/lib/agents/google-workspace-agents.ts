/**
 * Stage 6 — Docs, Sheets, Slides, Forms, Meet, Classroom and Chat agents.
 * Each is a thin, tool-calling wrapper, same shape as Stage 5's Gmail/
 * Calendar/Drive agents: read actions run immediately, the one write each
 * agent can do is always the confirmation-gated tool from
 * `google-workspace-tools.ts`, so nothing changes the user's real Workspace
 * data until they explicitly approve that exact tool for this run.
 */
import { z } from "zod";

import { BaseAgent, type AgentContext, type AgentOutput, type AgentTools } from "./agent";
import { clip } from "./text-utils";
import type {
  ChatMessageResult,
  ChatSpaceSummary,
  ClassroomCourseSummary,
  ClassroomCourseWorkSummary,
  DocCreateResult,
  DocSummary,
  FormCreateResult,
  FormResponseSummary,
  MeetSpaceResult,
  SheetAppendResult,
  SheetCreateResult,
  SheetRange,
  SlidesCreateResult,
  SlidesSummary,
} from "../google/types";
import type { TaskPayload } from "./types";

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/* ------------------------------------------------------------------ */

const DocsInput = z.object({
  action: z.enum(["read", "create"]).default("read"),
  documentId: z.string().trim().optional(),
  title: z.string().trim().max(300).optional(),
  body: z.string().max(50_000).optional(),
});

export class DocsAgent extends BaseAgent {
  readonly name = "docs";
  readonly description =
    "Reads a Google Doc's text, or creates a new one with content the user approves.";
  readonly capabilities = ["read a doc's text", "create a doc"] as const;
  readonly allowedTools = ["docs.read", "docs.create"] as const;

  protected async execute(
    task: TaskPayload,
    ctx: AgentContext,
    tools: AgentTools,
  ): Promise<AgentOutput> {
    const input = DocsInput.parse(task.input);
    if (input.action === "create") {
      const title = input.title || ctx.page.title || "Untitled doc from MindSpace";
      const body = input.body ?? (ctx.page.selection.trim() || ctx.page.text.trim() || "");
      const doc = (await tools.call("docs.create", { title, body })) as DocCreateResult;
      return { summary: `Created the doc "${clip(title, 60)}".`, output: { doc } };
    }
    if (!input.documentId) throw new Error("Reading a doc needs its document ID.");
    const doc = (await tools.call("docs.read", { documentId: input.documentId })) as DocSummary;
    return {
      summary: `Read "${clip(doc.title, 60)}" (${doc.text.length} characters).`,
      output: { doc },
    };
  }
}

/* ------------------------------------------------------------------ */

const SheetsInput = z.object({
  action: z.enum(["read", "create", "append"]).default("read"),
  spreadsheetId: z.string().trim().optional(),
  range: z.string().trim().optional(),
  title: z.string().trim().max(300).optional(),
  values: z.array(z.array(z.string())).optional(),
});

export class SheetsAgent extends BaseAgent {
  readonly name = "sheets";
  readonly description =
    "Reads a range from a spreadsheet, creates a new sheet, or appends rows the user approves.";
  readonly capabilities = ["read a sheet range", "create a spreadsheet", "append rows"] as const;
  readonly allowedTools = ["sheets.read_range", "sheets.create", "sheets.append_row"] as const;

  protected async execute(
    task: TaskPayload,
    ctx: AgentContext,
    tools: AgentTools,
  ): Promise<AgentOutput> {
    const input = SheetsInput.parse(task.input);
    if (input.action === "create") {
      const title = input.title || ctx.page.title || "Sheet from MindSpace";
      const sheet = (await tools.call("sheets.create", { title })) as SheetCreateResult;
      return { summary: `Created the spreadsheet "${clip(title, 60)}".`, output: { sheet } };
    }
    if (input.action === "append") {
      if (!input.spreadsheetId || !input.range || !input.values?.length) {
        throw new Error(
          "Appending rows needs a spreadsheet ID, a range and at least one row of values.",
        );
      }
      const result = (await tools.call("sheets.append_row", {
        spreadsheetId: input.spreadsheetId,
        range: input.range,
        values: input.values,
      })) as SheetAppendResult;
      return {
        summary: `Appended ${plural(result.updatedRows, "row")} to ${result.updatedRange}.`,
        output: { result },
      };
    }
    if (!input.spreadsheetId || !input.range)
      throw new Error("Reading a range needs a spreadsheet ID and a range.");
    const range = (await tools.call("sheets.read_range", {
      spreadsheetId: input.spreadsheetId,
      range: input.range,
    })) as SheetRange;
    return {
      summary: `Read ${plural(range.values.length, "row")} from ${range.range}.`,
      output: { range },
    };
  }
}

/* ------------------------------------------------------------------ */

const SlidesInput = z.object({
  action: z.enum(["read", "create"]).default("read"),
  presentationId: z.string().trim().optional(),
  title: z.string().trim().max(300).optional(),
});

export class SlidesAgent extends BaseAgent {
  readonly name = "slides";
  readonly description = "Reads a presentation's outline, or creates a new blank deck.";
  readonly capabilities = ["read a presentation outline", "create a presentation"] as const;
  readonly allowedTools = ["slides.read", "slides.create"] as const;

  protected async execute(
    task: TaskPayload,
    ctx: AgentContext,
    tools: AgentTools,
  ): Promise<AgentOutput> {
    const input = SlidesInput.parse(task.input);
    if (input.action === "create") {
      const title = input.title || ctx.page.title || "Presentation from MindSpace";
      const deck = (await tools.call("slides.create", { title })) as SlidesCreateResult;
      return { summary: `Created the presentation "${clip(title, 60)}".`, output: { deck } };
    }
    if (!input.presentationId) throw new Error("Reading a presentation needs its ID.");
    const deck = (await tools.call("slides.read", {
      presentationId: input.presentationId,
    })) as SlidesSummary;
    return {
      summary: `"${clip(deck.title, 60)}" has ${plural(deck.slideCount, "slide")}.`,
      output: { deck },
    };
  }
}

/* ------------------------------------------------------------------ */

const FormsInput = z.object({
  action: z.enum(["create", "read_responses"]).default("create"),
  title: z.string().trim().max(300).optional(),
  description: z.string().max(2000).optional(),
  formId: z.string().trim().optional(),
  limit: z.number().int().min(1).max(20).default(5),
});

export class FormsAgent extends BaseAgent {
  readonly name = "forms";
  readonly description = "Creates a new Google Form, or lists responses already submitted to one.";
  readonly capabilities = ["create a form", "list form responses"] as const;
  readonly allowedTools = ["forms.create", "forms.read_responses"] as const;

  protected async execute(
    task: TaskPayload,
    ctx: AgentContext,
    tools: AgentTools,
  ): Promise<AgentOutput> {
    const input = FormsInput.parse(task.input);
    if (input.action === "read_responses") {
      if (!input.formId) throw new Error("Reading responses needs a form ID.");
      const responses = (await tools.call("forms.read_responses", {
        formId: input.formId,
        limit: input.limit,
      })) as FormResponseSummary[];
      return {
        summary: responses.length
          ? `Found ${plural(responses.length, "response")}.`
          : "No responses yet.",
        output: { responses },
      };
    }
    const title = input.title || ctx.page.title || "Form from MindSpace";
    const description =
      input.description ?? clip(ctx.page.selection.trim() || ctx.page.text.trim(), 300);
    const form = (await tools.call("forms.create", { title, description })) as FormCreateResult;
    return { summary: `Created the form "${clip(title, 60)}".`, output: { form } };
  }
}

/* ------------------------------------------------------------------ */

export class MeetAgent extends BaseAgent {
  readonly name = "meet";
  readonly description = "Creates a ready-to-join Google Meet link.";
  readonly capabilities = ["create a meeting link"] as const;
  readonly allowedTools = ["meet.create_space"] as const;

  protected async execute(
    _task: TaskPayload,
    _ctx: AgentContext,
    tools: AgentTools,
  ): Promise<AgentOutput> {
    const space = (await tools.call("meet.create_space", {})) as MeetSpaceResult;
    return { summary: `Created a Meet link: ${space.meetingUri}`, output: { space } };
  }
}

/* ------------------------------------------------------------------ */

const ClassroomInput = z.object({
  action: z.enum(["list_courses", "list_coursework"]).default("list_courses"),
  courseId: z.string().trim().optional(),
  limit: z.number().int().min(1).max(20).default(10),
});

export class ClassroomAgent extends BaseAgent {
  readonly name = "classroom";
  readonly description =
    "Lists the user's Classroom courses and coursework. Read-only — never posts anything.";
  readonly capabilities = ["list courses", "list coursework"] as const;
  readonly allowedTools = ["classroom.list_courses", "classroom.list_coursework"] as const;

  protected async execute(
    task: TaskPayload,
    _ctx: AgentContext,
    tools: AgentTools,
  ): Promise<AgentOutput> {
    const input = ClassroomInput.parse(task.input);
    if (input.action === "list_coursework") {
      if (!input.courseId) throw new Error("Listing coursework needs a course ID.");
      const work = (await tools.call("classroom.list_coursework", {
        courseId: input.courseId,
        limit: input.limit,
      })) as ClassroomCourseWorkSummary[];
      return { summary: `Found ${plural(work.length, "item")} of coursework.`, output: { work } };
    }
    const courses = (await tools.call("classroom.list_courses", {
      limit: input.limit,
    })) as ClassroomCourseSummary[];
    return { summary: `Found ${plural(courses.length, "active course")}.`, output: { courses } };
  }
}

/* ------------------------------------------------------------------ */

const ChatInput = z.object({
  action: z.enum(["list_spaces", "send"]).default("list_spaces"),
  space: z.string().trim().optional(),
  text: z.string().trim().max(4000).optional(),
  limit: z.number().int().min(1).max(20).default(10),
});

export class ChatAgent extends BaseAgent {
  readonly name = "chat";
  readonly description =
    "Lists the user's Google Chat spaces, or sends a message the user approves.";
  readonly capabilities = ["list chat spaces", "send a chat message"] as const;
  readonly allowedTools = ["chat.list_spaces", "chat.send_message"] as const;

  protected async execute(
    task: TaskPayload,
    _ctx: AgentContext,
    tools: AgentTools,
  ): Promise<AgentOutput> {
    const input = ChatInput.parse(task.input);
    if (input.action === "send") {
      if (!input.space || !input.text)
        throw new Error("Sending a message needs a space and message text.");
      const message = (await tools.call("chat.send_message", {
        space: input.space,
        text: input.text,
      })) as ChatMessageResult;
      return { summary: `Sent a message to ${input.space}.`, output: { message } };
    }
    const spaces = (await tools.call("chat.list_spaces", {
      limit: input.limit,
    })) as ChatSpaceSummary[];
    return { summary: `Found ${plural(spaces.length, "space")}.`, output: { spaces } };
  }
}

export {
  DocsAgent as GoogleDocsAgent,
  SheetsAgent as GoogleSheetsAgent,
  SlidesAgent as GoogleSlidesAgent,
  FormsAgent as GoogleFormsAgent,
  MeetAgent as GoogleMeetAgent,
  ClassroomAgent as GoogleClassroomAgent,
  ChatAgent as GoogleChatAgent,
};
