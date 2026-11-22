/**
 * Stage 5 — Gmail, Calendar and Drive agents.
 *
 * Each agent is a thin, tool-calling wrapper: it turns the task's input into
 * one Google API call. The consequential call (draft/event/file creation) is
 * always the *last* thing each agent does, and the underlying tool is
 * confirmation-gated (see `google-tools.ts`), so nothing is written to the
 * user's real account until they explicitly approve that exact tool for
 * this run.
 */
import { z } from "zod";

import { BaseAgent, type AgentContext, type AgentOutput, type AgentTools } from "./agent";
import { clip } from "./text-utils";
import { extractLinks } from "./tools";
import type {
  CalendarEventResult,
  CalendarEventSummary,
  DriveFileSummary,
  DriveSaveResult,
  GmailDraftResult,
  GmailMessageSummary,
} from "../google/types";
import type { TaskPayload } from "./types";

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/* ------------------------------------------------------------------ */

const GmailInput = z.object({
  action: z.enum(["list", "draft"]).default("list"),
  query: z.string().trim().max(300).default(""),
  limit: z.number().int().min(1).max(10).default(5),
  to: z.string().trim().max(320).optional(),
  subject: z.string().trim().max(300).optional(),
  body: z.string().trim().max(20_000).optional(),
});

export class GmailAgent extends BaseAgent {
  readonly name = "gmail";
  readonly description =
    "Reads recent Gmail messages and can prepare a draft for the user to send themselves.";
  readonly capabilities = ["search recent email", "draft an email (never sends)"] as const;
  readonly allowedTools = ["gmail.list_recent", "gmail.create_draft"] as const;

  protected async execute(
    task: TaskPayload,
    ctx: AgentContext,
    tools: AgentTools,
  ): Promise<AgentOutput> {
    const input = GmailInput.parse(task.input);

    if (input.action === "draft") {
      const pageText = `${ctx.page.selection} ${ctx.page.text}`.trim();
      const to = input.to || extractLinks(pageText).emails[0];
      if (!to) {
        throw new Error(
          'Drafting an email needs a recipient. No email address was found on the page — specify one (e.g. "draft an email to alex@example.com about this page").',
        );
      }
      const subject =
        input.subject ||
        (ctx.page.title ? `Re: ${clip(ctx.page.title, 200)}` : "Notes from MindSpace");
      const body =
        input.body ||
        (ctx.page.selection.trim() || ctx.page.text.trim()
          ? clip(ctx.page.selection.trim() || ctx.page.text.trim(), 4000)
          : null);
      if (!body)
        throw new Error(
          "Drafting an email needs some content — capture a page or paste text first.",
        );

      const draft = (await tools.call("gmail.create_draft", {
        to,
        subject,
        body,
      })) as GmailDraftResult;
      return {
        summary: `Created a Gmail draft to ${to}: "${clip(subject, 60)}". It was not sent.`,
        output: { draft },
      };
    }

    const messages = (await tools.call("gmail.list_recent", {
      query: input.query,
      limit: input.limit,
    })) as GmailMessageSummary[];
    return {
      summary: messages.length
        ? `Found ${plural(messages.length, "message")}${input.query ? ` matching "${clip(input.query, 40)}"` : ""}.`
        : "No matching messages were found.",
      output: { messages },
    };
  }
}

/* ------------------------------------------------------------------ */

const CalendarInput = z.object({
  action: z.enum(["list", "create"]).default("list"),
  maxResults: z.number().int().min(1).max(15).default(5),
  summary: z.string().trim().max(300).optional(),
  description: z.string().trim().max(4000).optional(),
  location: z.string().trim().max(300).optional(),
  start: z.string().trim().optional(),
  end: z.string().trim().optional(),
});

export class CalendarAgent extends BaseAgent {
  readonly name = "calendar";
  readonly description = "Lists upcoming events and can create a new one on the user's calendar.";
  readonly capabilities = ["list upcoming events", "create a calendar event"] as const;
  readonly allowedTools = ["calendar.list_events", "calendar.create_event"] as const;

  protected async execute(
    task: TaskPayload,
    _ctx: AgentContext,
    tools: AgentTools,
  ): Promise<AgentOutput> {
    const input = CalendarInput.parse(task.input);

    if (input.action === "create") {
      if (!input.summary || !input.start || !input.end) {
        throw new Error("Creating an event needs at least a title, start time and end time.");
      }
      const event = (await tools.call("calendar.create_event", {
        summary: input.summary,
        description: input.description ?? "",
        location: input.location ?? "",
        start: input.start,
        end: input.end,
      })) as CalendarEventResult;
      return {
        summary: `Created the event "${clip(input.summary, 60)}" on the user's calendar.`,
        output: { event },
      };
    }

    const events = (await tools.call("calendar.list_events", {
      maxResults: input.maxResults,
    })) as CalendarEventSummary[];
    return {
      summary: events.length
        ? `Found ${plural(events.length, "upcoming event")}.`
        : "No upcoming events were found.",
      output: { events },
    };
  }
}

/* ------------------------------------------------------------------ */

const DriveInput = z.object({
  action: z.enum(["search", "save"]).default("search"),
  query: z.string().trim().max(300).optional(),
  limit: z.number().int().min(1).max(10).default(5),
  name: z.string().trim().max(255).optional(),
  content: z.string().max(200_000).optional(),
  mimeType: z.string().trim().max(120).default("text/plain"),
});

export class DriveAgent extends BaseAgent {
  readonly name = "drive";
  readonly description =
    "Searches Drive files MindSpace can see and can save a new text file there.";
  readonly capabilities = ["search drive files", "save a text file to drive"] as const;
  readonly allowedTools = ["drive.search", "drive.save_file"] as const;

  protected async execute(
    task: TaskPayload,
    _ctx: AgentContext,
    tools: AgentTools,
  ): Promise<AgentOutput> {
    const input = DriveInput.parse(task.input);

    if (input.action === "save") {
      if (!input.name || !input.content) throw new Error("Saving a file needs a name and content.");
      const file = (await tools.call("drive.save_file", {
        name: input.name,
        content: input.content,
        mimeType: input.mimeType,
      })) as DriveSaveResult;
      return { summary: `Saved "${clip(input.name, 60)}" to the user's Drive.`, output: { file } };
    }

    if (!input.query) throw new Error("Searching Drive needs a query.");
    const files = (await tools.call("drive.search", {
      query: input.query,
      limit: input.limit,
    })) as DriveFileSummary[];
    return {
      summary: files.length
        ? `Found ${plural(files.length, "file")} matching "${clip(input.query, 40)}".`
        : "No matching files were found.",
      output: { files },
    };
  }
}

export {
  CalendarAgent as GoogleCalendarAgent,
  DriveAgent as GoogleDriveAgent,
  GmailAgent as GoogleGmailAgent,
};
