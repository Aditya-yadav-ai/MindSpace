/**
 * Stage 7 — Task/Reminder server functions.
 * Real, persisted tasks (distinct from the Stage 4 `tasks.draft` tool, which
 * only ever returns an in-memory, unsaved draft). Every handler is RLS-scoped
 * to the signed-in user through `requireSupabaseAuth`, same as `knowledge.functions.ts`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TaskRecord = {
  id: string;
  title: string;
  notes: string;
  due_at: string | null;
  status: "pending" | "done";
  source: "manual" | "agent";
  source_run_id: string | null;
  created_at: string;
  updated_at: string;
};

const CreateTaskInput = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).default(""),
  dueAt: z.string().trim().max(60).nullable().default(null),
});

const UpdateStatusInput = z.object({
  taskId: z.string().uuid(),
  status: z.enum(["pending", "done"]),
});

const IdInput = z.object({ taskId: z.string().uuid() });

/** List the signed-in reader's tasks, soonest-due first, then newest first. */
export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TaskRecord[]> => {
    const { data, error } = await context.supabase
      .from("tasks")
      .select("id,title,notes,due_at,status,source,source_run_id,created_at,updated_at")
      .order("status", { ascending: true })
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as TaskRecord[];
  });

/** Create a task directly from the UI (source: "manual"). */
export const createTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateTaskInput.parse(input))
  .handler(async ({ data, context }): Promise<TaskRecord> => {
    const { data: inserted, error } = await context.supabase
      .from("tasks")
      .insert({
        user_id: context.userId,
        title: data.title,
        notes: data.notes,
        due_at: data.dueAt,
        source: "manual",
      })
      .select("id,title,notes,due_at,status,source,source_run_id,created_at,updated_at")
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "Could not create this task.");
    return inserted as TaskRecord;
  });

export const updateTaskStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateStatusInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("tasks")
      .update({ status: data.status })
      .eq("id", data.taskId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.from("tasks").delete().eq("id", data.taskId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
