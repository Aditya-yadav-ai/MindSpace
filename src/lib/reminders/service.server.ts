/**
 * Stage 7 — server-only persistence behind the Reminder Agent's tools.
 * Mirrors `google/adapter.server.ts`'s shape: a real implementation scoped
 * to one signed-in user via the service-role client. The interface itself
 * and the "not signed in" stub live in `./types` and `./not-connected` so
 * the plain agent framework never has to import this module.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { TaskService, TaskServiceRecord } from "./types";

function row(record: {
  id: string;
  title: string;
  notes: string;
  due_at: string | null;
  status: string;
}): TaskServiceRecord {
  return {
    id: record.id,
    title: record.title,
    notes: record.notes,
    dueAt: record.due_at,
    status: record.status === "done" ? "done" : "pending",
  };
}

/** Real, per-request task service for `userId`. Writes real rows to `public.tasks`. */
export function createTaskService(userId: string): TaskService {
  return {
    available: true,
    async create(input) {
      const { data, error } = await supabaseAdmin
        .from("tasks")
        .insert({
          user_id: userId,
          title: input.title,
          notes: input.notes,
          due_at: input.dueAt,
          source: "agent",
          source_run_id: input.runId,
        })
        .select("id,title,notes,due_at,status")
        .single();
      if (error || !data) throw new Error(error?.message ?? "Could not create the task.");
      return row(data);
    },
    async list(input) {
      let query = supabaseAdmin
        .from("tasks")
        .select("id,title,notes,due_at,status")
        .eq("user_id", userId)
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(input.limit);
      if (input.status !== "all") query = query.eq("status", input.status);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []).map(row);
    },
    async complete(taskId) {
      const { data, error } = await supabaseAdmin
        .from("tasks")
        .update({ status: "done" })
        .eq("id", taskId)
        .eq("user_id", userId)
        .select("id,title,notes,due_at,status")
        .single();
      if (error || !data) throw new Error(error?.message ?? "That task could not be found.");
      return row(data);
    },
    async remove(taskId) {
      const { error } = await supabaseAdmin
        .from("tasks")
        .delete()
        .eq("id", taskId)
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      return { deleted: true };
    },
  };
}
