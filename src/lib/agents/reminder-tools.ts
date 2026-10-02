/**
 * Stage 7 — tools backing the Reminder Agent. Unlike the Stage 4
 * `tasks.draft` tool (which only ever returns an unsaved in-memory draft),
 * these write real rows to `public.tasks` for the signed-in user via
 * `ctx.tasks` (see `reminders/service.server.ts`). Creating and completing a
 * task is reversible and low-risk, so those run immediately; deleting one is
 * the one irreversible, confirmation-gated action here, same policy as the
 * Google tools' writes.
 */
import { z } from "zod";

import { defineTool } from "./tools";
import { TaskServiceUnavailableError } from "@/lib/reminders/types";

function requireTasks<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((error) => {
    if (error instanceof TaskServiceUnavailableError) throw error;
    throw error;
  });
}

export const remindersCreateTool = defineTool({
  name: "reminders.create",
  description: "Create a real, persisted reminder/task for the signed-in user.",
  inputSchema: z.object({
    title: z.string().trim().min(1).max(200),
    notes: z.string().trim().max(2000).default(""),
    dueAt: z.string().trim().max(60).nullable().default(null),
  }),
  mock: false,
  requiresConfirmation: false,
  execute: (input, ctx) => requireTasks(() => ctx.tasks.create({ ...input, runId: ctx.runId })),
});

export const remindersListTool = defineTool({
  name: "reminders.list",
  description: "List the signed-in user's saved reminders/tasks (read-only).",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(20).default(10),
    status: z.enum(["pending", "done", "all"]).default("pending"),
  }),
  mock: false,
  requiresConfirmation: false,
  execute: (input, ctx) => requireTasks(() => ctx.tasks.list(input)),
});

export const remindersCompleteTool = defineTool({
  name: "reminders.complete",
  description: "Mark one of the user's reminders/tasks as done.",
  inputSchema: z.object({ taskId: z.string().trim().min(1) }),
  mock: false,
  requiresConfirmation: false,
  execute: ({ taskId }, ctx) => requireTasks(() => ctx.tasks.complete(taskId)),
});

export const remindersDeleteTool = defineTool({
  name: "reminders.delete",
  description: "Permanently delete one of the user's reminders/tasks.",
  inputSchema: z.object({ taskId: z.string().trim().min(1) }),
  mock: false,
  requiresConfirmation: true,
  execute: ({ taskId }, ctx) => requireTasks(() => ctx.tasks.remove(taskId)),
});

export function createReminderTools() {
  return [remindersCreateTool, remindersListTool, remindersCompleteTool, remindersDeleteTool];
}

/** Tool names that permanently change the user's saved reminders — used by the verifier and the UI's approval prompt. */
export const CONSEQUENTIAL_REMINDER_TOOLS = ["reminders.delete"] as const;
