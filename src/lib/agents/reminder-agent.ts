/**
 * Stage 7 — Reminder Agent: a thin, tool-calling wrapper over the persisted
 * `reminders.*` tools. Creating/listing/completing a reminder run
 * immediately (reversible); deleting one is gated behind the tool's
 * `requiresConfirmation`, enforced by the tool registry.
 */
import { z } from "zod";

import { BaseAgent, type AgentContext, type AgentOutput, type AgentTools } from "./agent";
import { clip } from "./text-utils";
import type { TaskPayload } from "./types";
import type { TaskServiceRecord } from "../reminders/types";

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

const ReminderInput = z.object({
  action: z.enum(["create", "list", "complete", "delete"]).default("list"),
  title: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  dueAt: z.string().trim().max(60).nullable().optional(),
  taskId: z.string().trim().optional(),
  status: z.enum(["pending", "done", "all"]).default("pending"),
  limit: z.number().int().min(1).max(20).default(10),
  /** From an earlier extractor step: reuse the first date/action item as the reminder. */
  dates: z
    .array(z.object({ text: z.string(), iso: z.string().nullable(), context: z.string() }))
    .default([]),
  tasks: z.array(z.string()).default([]),
});

export class ReminderAgent extends BaseAgent {
  readonly name = "reminders";
  readonly description =
    "Creates, lists, completes and deletes real, saved reminders/tasks for the signed-in user.";
  readonly capabilities = [
    "create a reminder",
    "list reminders",
    "mark a reminder done",
    "delete a reminder",
  ] as const;
  readonly allowedTools = [
    "reminders.create",
    "reminders.list",
    "reminders.complete",
    "reminders.delete",
  ] as const;

  protected async execute(
    task: TaskPayload,
    ctx: AgentContext,
    tools: AgentTools,
  ): Promise<AgentOutput> {
    const input = ReminderInput.parse(task.input);

    if (input.action === "create") {
      let title = input.title?.trim();
      let dueAt = input.dueAt ?? null;
      if (!title && input.dates.length > 0) {
        title = `Deadline: ${clip(input.dates[0]!.context, 120)}`;
        dueAt = input.dates[0]!.iso ?? input.dates[0]!.text;
      }
      if (!title && input.tasks.length > 0) title = clip(input.tasks[0]!, 160);
      if (!title) title = ctx.page.title ? `Follow up: ${clip(ctx.page.title, 150)}` : undefined;
      if (!title) throw new Error("Creating a reminder needs at least a title.");

      const created = (await tools.call("reminders.create", {
        title,
        notes: input.notes ?? "",
        dueAt,
      })) as TaskServiceRecord;
      return {
        summary: `Saved the reminder "${clip(created.title, 60)}"${created.dueAt ? ` (due ${created.dueAt})` : ""}.`,
        output: { task: created },
      };
    }

    if (input.action === "complete") {
      if (!input.taskId) throw new Error("Completing a reminder needs its task ID.");
      const updated = (await tools.call("reminders.complete", {
        taskId: input.taskId,
      })) as TaskServiceRecord;
      return { summary: `Marked "${clip(updated.title, 60)}" as done.`, output: { task: updated } };
    }

    if (input.action === "delete") {
      if (!input.taskId) throw new Error("Deleting a reminder needs its task ID.");
      await tools.call("reminders.delete", { taskId: input.taskId });
      return { summary: `Deleted the reminder.`, output: { taskId: input.taskId, deleted: true } };
    }

    const items = (await tools.call("reminders.list", {
      limit: input.limit,
      status: input.status,
    })) as TaskServiceRecord[];
    return {
      summary: items.length
        ? `Found ${plural(items.length, "reminder")}.`
        : "No saved reminders matched.",
      output: { tasks: items },
    };
  }
}
