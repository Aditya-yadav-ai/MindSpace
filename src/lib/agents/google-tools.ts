/**
 * Stage 5 — tools backing the Gmail, Calendar and Drive agents.
 * Every read tool is safe to auto-run. Every tool that writes to the user's
 * real Google account has `requiresConfirmation: true`, so the registry
 * refuses it until the run's approvals explicitly include its name — see
 * `tools.ts`'s `invoke()`. None of these are mock: `mock: false` because a
 * connected account really is queried/written; when nothing is connected
 * they fail with a clear, typed message instead of pretending to succeed.
 */
import { z } from "zod";

import { defineTool } from "./tools";
import { GoogleNotConnectedError } from "@/lib/google/types";

function requireConnected<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((error) => {
    if (error instanceof GoogleNotConnectedError) throw error;
    throw error;
  });
}

/* ------------------------------------------------------------------ */
/* Gmail                                                                */
/* ------------------------------------------------------------------ */

export const gmailListRecentTool = defineTool({
  name: "gmail.list_recent",
  description: "List recent Gmail messages matching a search query (read-only).",
  inputSchema: z.object({
    query: z.string().trim().max(300).default(""),
    limit: z.number().int().min(1).max(10).default(5),
  }),
  mock: false,
  requiresConfirmation: false,
  execute: (input, ctx) => requireConnected(() => ctx.google.listRecentEmails(input)),
});

export const gmailCreateDraftTool = defineTool({
  name: "gmail.create_draft",
  description: "Create a Gmail draft (never sends it). Writes to the user's real Gmail account.",
  inputSchema: z.object({
    to: z.string().trim().email("must be a valid email address"),
    subject: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(20_000),
  }),
  mock: false,
  requiresConfirmation: true,
  execute: (input, ctx) => requireConnected(() => ctx.google.createEmailDraft(input)),
});

/* ------------------------------------------------------------------ */
/* Calendar                                                             */
/* ------------------------------------------------------------------ */

export const calendarListEventsTool = defineTool({
  name: "calendar.list_events",
  description: "List the user's next upcoming calendar events (read-only).",
  inputSchema: z.object({ maxResults: z.number().int().min(1).max(15).default(5) }),
  mock: false,
  requiresConfirmation: false,
  execute: (input, ctx) => requireConnected(() => ctx.google.listUpcomingEvents(input)),
});

export const calendarCreateEventTool = defineTool({
  name: "calendar.create_event",
  description: "Create a real event on the user's primary Google Calendar.",
  inputSchema: z.object({
    summary: z.string().trim().min(1).max(300),
    description: z.string().trim().max(4000).default(""),
    location: z.string().trim().max(300).default(""),
    start: z.string().trim().min(4),
    end: z.string().trim().min(4),
  }),
  mock: false,
  requiresConfirmation: true,
  execute: (input, ctx) => requireConnected(() => ctx.google.createCalendarEvent(input)),
});

/* ------------------------------------------------------------------ */
/* Drive                                                                */
/* ------------------------------------------------------------------ */

export const driveSearchTool = defineTool({
  name: "drive.search",
  description: "Search Drive files MindSpace can see (files it created; read-only).",
  inputSchema: z.object({
    query: z.string().trim().min(1).max(300),
    limit: z.number().int().min(1).max(10).default(5),
  }),
  mock: false,
  requiresConfirmation: false,
  execute: (input, ctx) => requireConnected(() => ctx.google.searchDriveFiles(input)),
});

export const driveSaveFileTool = defineTool({
  name: "drive.save_file",
  description:
    "Save a text file to the user's Drive (app-scoped). Writes to the user's real Drive.",
  inputSchema: z.object({
    name: z.string().trim().min(1).max(255),
    content: z.string().min(1).max(200_000),
    mimeType: z.string().trim().max(120).default("text/plain"),
  }),
  mock: false,
  requiresConfirmation: true,
  execute: (input, ctx) => requireConnected(() => ctx.google.saveDriveFile(input)),
});

export function createGoogleTools() {
  return [
    gmailListRecentTool,
    gmailCreateDraftTool,
    calendarListEventsTool,
    calendarCreateEventTool,
    driveSearchTool,
    driveSaveFileTool,
  ];
}

/** Tool names that write to the user's real Google account — used by the verifier and the UI's approval prompt. */
export const CONSEQUENTIAL_GOOGLE_TOOLS = [
  "gmail.create_draft",
  "calendar.create_event",
  "drive.save_file",
] as const;
