/**
 * Stage 6 — tools backing the Docs, Sheets, Slides, Forms, Meet, Classroom
 * and Chat agents. Same pattern as Stage 5's `google-tools.ts`: read tools
 * run freely, anything that writes to the user's real account is
 * `requiresConfirmation: true`.
 */
import { z } from "zod";

import { defineTool } from "./tools";

/* ------------------------------------------------------------------ */
/* Docs                                                                 */
/* ------------------------------------------------------------------ */

export const docsReadTool = defineTool({
  name: "docs.read",
  description: "Read the text of a Google Doc by its document ID (read-only).",
  inputSchema: z.object({ documentId: z.string().trim().min(5) }),
  mock: false,
  requiresConfirmation: false,
  execute: ({ documentId }, ctx) => ctx.google.readDocument(documentId),
});

export const docsCreateTool = defineTool({
  name: "docs.create",
  description: "Create a real Google Doc with an initial body of text.",
  inputSchema: z.object({
    title: z.string().trim().min(1).max(300),
    body: z.string().max(50_000).default(""),
  }),
  mock: false,
  requiresConfirmation: true,
  execute: (input, ctx) => ctx.google.createDocument(input),
});

/* ------------------------------------------------------------------ */
/* Sheets                                                               */
/* ------------------------------------------------------------------ */

export const sheetsReadTool = defineTool({
  name: "sheets.read_range",
  description: "Read a value range (e.g. 'Sheet1!A1:D20') from a spreadsheet (read-only).",
  inputSchema: z.object({
    spreadsheetId: z.string().trim().min(5),
    range: z.string().trim().min(1),
  }),
  mock: false,
  requiresConfirmation: false,
  execute: ({ spreadsheetId, range }, ctx) => ctx.google.readSheetRange(spreadsheetId, range),
});

export const sheetsCreateTool = defineTool({
  name: "sheets.create",
  description: "Create a real, blank Google Sheet with the given title.",
  inputSchema: z.object({ title: z.string().trim().min(1).max(300) }),
  mock: false,
  requiresConfirmation: true,
  execute: (input, ctx) => ctx.google.createSpreadsheet(input),
});

export const sheetsAppendTool = defineTool({
  name: "sheets.append_row",
  description: "Append one or more rows of values to a spreadsheet range.",
  inputSchema: z.object({
    spreadsheetId: z.string().trim().min(5),
    range: z.string().trim().min(1),
    values: z.array(z.array(z.string())).min(1),
  }),
  mock: false,
  requiresConfirmation: true,
  execute: (input, ctx) => ctx.google.appendSheetValues(input),
});

/* ------------------------------------------------------------------ */
/* Slides                                                               */
/* ------------------------------------------------------------------ */

export const slidesReadTool = defineTool({
  name: "slides.read",
  description: "Read a presentation's title and slide count by ID (read-only).",
  inputSchema: z.object({ presentationId: z.string().trim().min(5) }),
  mock: false,
  requiresConfirmation: false,
  execute: ({ presentationId }, ctx) => ctx.google.readPresentation(presentationId),
});

export const slidesCreateTool = defineTool({
  name: "slides.create",
  description: "Create a real, blank Google Slides presentation with the given title.",
  inputSchema: z.object({ title: z.string().trim().min(1).max(300) }),
  mock: false,
  requiresConfirmation: true,
  execute: (input, ctx) => ctx.google.createPresentation(input),
});

/* ------------------------------------------------------------------ */
/* Forms                                                                */
/* ------------------------------------------------------------------ */

export const formsCreateTool = defineTool({
  name: "forms.create",
  description: "Create a real Google Form with a title and description.",
  inputSchema: z.object({
    title: z.string().trim().min(1).max(300),
    description: z.string().max(2000).default(""),
  }),
  mock: false,
  requiresConfirmation: true,
  execute: (input, ctx) => ctx.google.createForm(input),
});

export const formsReadResponsesTool = defineTool({
  name: "forms.read_responses",
  description: "List responses submitted to a form by its form ID (read-only).",
  inputSchema: z.object({
    formId: z.string().trim().min(5),
    limit: z.number().int().min(1).max(20).default(5),
  }),
  mock: false,
  requiresConfirmation: false,
  execute: ({ formId, limit }, ctx) => ctx.google.listFormResponses(formId, limit),
});

/* ------------------------------------------------------------------ */
/* Meet                                                                 */
/* ------------------------------------------------------------------ */

export const meetCreateSpaceTool = defineTool({
  name: "meet.create_space",
  description: "Create a real, ready-to-join Google Meet meeting link.",
  inputSchema: z.object({}),
  mock: false,
  requiresConfirmation: true,
  execute: (_input, ctx) => ctx.google.createMeetingSpace(),
});

/* ------------------------------------------------------------------ */
/* Classroom (read-only: this app never posts on the user's behalf)    */
/* ------------------------------------------------------------------ */

export const classroomListCoursesTool = defineTool({
  name: "classroom.list_courses",
  description: "List the user's active Google Classroom courses (read-only).",
  inputSchema: z.object({ limit: z.number().int().min(1).max(20).default(10) }),
  mock: false,
  requiresConfirmation: false,
  execute: ({ limit }, ctx) => ctx.google.listClassroomCourses(limit),
});

export const classroomListCourseWorkTool = defineTool({
  name: "classroom.list_coursework",
  description: "List coursework/assignments for one course by course ID (read-only).",
  inputSchema: z.object({
    courseId: z.string().trim().min(1),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  mock: false,
  requiresConfirmation: false,
  execute: ({ courseId, limit }, ctx) => ctx.google.listClassroomCourseWork(courseId, limit),
});

/* ------------------------------------------------------------------ */
/* Chat                                                                 */
/* ------------------------------------------------------------------ */

export const chatListSpacesTool = defineTool({
  name: "chat.list_spaces",
  description: "List Google Chat spaces the user is a member of (read-only).",
  inputSchema: z.object({ limit: z.number().int().min(1).max(20).default(10) }),
  mock: false,
  requiresConfirmation: false,
  execute: ({ limit }, ctx) => ctx.google.listChatSpaces(limit),
});

export const chatSendMessageTool = defineTool({
  name: "chat.send_message",
  description: "Send a real message to a Google Chat space (e.g. 'spaces/AAAA...').",
  inputSchema: z.object({
    space: z.string().trim().min(1),
    text: z.string().trim().min(1).max(4000),
  }),
  mock: false,
  requiresConfirmation: true,
  execute: (input, ctx) => ctx.google.sendChatMessage(input),
});

export function createGoogleWorkspaceTools() {
  return [
    docsReadTool,
    docsCreateTool,
    sheetsReadTool,
    sheetsCreateTool,
    sheetsAppendTool,
    slidesReadTool,
    slidesCreateTool,
    formsCreateTool,
    formsReadResponsesTool,
    meetCreateSpaceTool,
    classroomListCoursesTool,
    classroomListCourseWorkTool,
    chatListSpacesTool,
    chatSendMessageTool,
  ];
}

/** Tool names that write to the user's real Google account — used by the verifier and the UI's approval prompt. */
export const CONSEQUENTIAL_WORKSPACE_TOOLS = [
  "docs.create",
  "sheets.create",
  "sheets.append_row",
  "slides.create",
  "forms.create",
  "meet.create_space",
  "chat.send_message",
] as const;
