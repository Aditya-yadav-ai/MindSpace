/**
 * Stage 8 — Automations server functions. A saved goal, run on a schedule
 * by the cron route (`src/routes/api/cron/automations.ts`) or on demand
 * here via `runAutomationNow`. Both paths share `runAutomation` in
 * `automations-runner.server.ts` so "Run now" previews exactly what the
 * unattended run will do.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeNextRun } from "@/lib/automations-schedule";
import {
  CONSEQUENTIAL_GOOGLE_TOOLS,
  CONSEQUENTIAL_WORKSPACE_TOOLS,
  CONSEQUENTIAL_REMINDER_TOOLS,
} from "@/lib/agents";

export type AutomationRecord = {
  id: string;
  name: string;
  goal: string;
  schedule_kind: "hourly" | "daily" | "weekly";
  schedule_hour: number;
  schedule_day_of_week: number | null;
  approved_tools: string[];
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string;
  created_at: string;
};

export type AutomationRunRecord = {
  id: string;
  agent_run_id: string | null;
  status: string;
  summary: string;
  ran_at: string;
};

/** Tools an automation is allowed to pre-approve for its unattended runs. */
export const APPROVABLE_AUTOMATION_TOOLS = [
  ...CONSEQUENTIAL_GOOGLE_TOOLS,
  ...CONSEQUENTIAL_WORKSPACE_TOOLS,
  ...CONSEQUENTIAL_REMINDER_TOOLS,
] as const;

const ScheduleInput = z.object({
  scheduleKind: z.enum(["hourly", "daily", "weekly"]).default("daily"),
  scheduleHour: z.number().int().min(0).max(23).default(9),
  scheduleDayOfWeek: z.number().int().min(0).max(6).nullable().default(null),
});

const CreateAutomationInput = ScheduleInput.extend({
  name: z.string().trim().min(1).max(120),
  goal: z.string().trim().min(1).max(2000),
  approvedTools: z.array(z.string()).max(20).default([]),
});

export const listAutomations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AutomationRecord[]> => {
    try {
      const { data, error } = await context.supabase
        .from("automations")
        .select(
          "id,name,goal,schedule_kind,schedule_hour,schedule_day_of_week,approved_tools,enabled,last_run_at,next_run_at,created_at",
        )
        .order("created_at", { ascending: false });
      if (!error && data) return data as AutomationRecord[];
    } catch {
      // Supabase unavailable; fall through to local SQLite
    }
    const { getLocalAutomations } = await import("@/lib/local-db.server");
    return getLocalAutomations(context.userId);
  });

export const createAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateAutomationInput.parse(input))
  .handler(async ({ data, context }): Promise<AutomationRecord> => {
    const nextRunAt = computeNextRun({
      kind: data.scheduleKind,
      hour: data.scheduleHour,
      dayOfWeek: data.scheduleDayOfWeek,
    });
    try {
      const { data: inserted, error } = await context.supabase
        .from("automations")
        .insert({
          user_id: context.userId,
          name: data.name,
          goal: data.goal,
          schedule_kind: data.scheduleKind,
          schedule_hour: data.scheduleHour,
          schedule_day_of_week: data.scheduleDayOfWeek,
          approved_tools: data.approvedTools,
          next_run_at: nextRunAt.toISOString(),
        })
        .select(
          "id,name,goal,schedule_kind,schedule_hour,schedule_day_of_week,approved_tools,enabled,last_run_at,next_run_at,created_at",
        )
        .single();
      if (!error && inserted) return inserted as AutomationRecord;
    } catch {
      // Supabase unavailable; fall through to local SQLite
    }
    const { createLocalAutomation } = await import("@/lib/local-db.server");
    return createLocalAutomation(context.userId, {
      name: data.name,
      goal: data.goal,
      scheduleKind: data.scheduleKind,
      scheduleHour: data.scheduleHour,
      scheduleDayOfWeek: data.scheduleDayOfWeek,
      approvedTools: data.approvedTools,
      nextRunAt: nextRunAt.toISOString(),
    });
  });

const UpdateAutomationInput = z.object({
  automationId: z.string().uuid(),
  enabled: z.boolean().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  goal: z.string().trim().min(1).max(2000).optional(),
});

export const updateAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateAutomationInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { automationId, ...rest } = data;
    const patch: { enabled?: boolean; name?: string; goal?: string } = {};
    if (rest.enabled !== undefined) patch.enabled = rest.enabled;
    if (rest.name !== undefined) patch.name = rest.name;
    if (rest.goal !== undefined) patch.goal = rest.goal;
    if (Object.keys(patch).length === 0) return { ok: true };

    try {
      const { error } = await context.supabase
        .from("automations")
        .update(patch)
        .eq("id", automationId);
      if (!error) return { ok: true };
    } catch {
      // Supabase unavailable; fall through to local SQLite
    }
    const { updateLocalAutomation } = await import("@/lib/local-db.server");
    updateLocalAutomation(automationId, patch);
    return { ok: true };
  });

export const deleteAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ automationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    try {
      const { error } = await context.supabase
        .from("automations")
        .delete()
        .eq("id", data.automationId);
      if (!error) return { ok: true };
    } catch {
      // Supabase unavailable; fall through to local SQLite
    }
    const { deleteLocalAutomation } = await import("@/lib/local-db.server");
    deleteLocalAutomation(data.automationId);
    return { ok: true };
  });

export const listAutomationRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ automationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<AutomationRunRecord[]> => {
    try {
      const { data: rows, error } = await context.supabase
        .from("automation_runs")
        .select("id,agent_run_id,status,summary,ran_at")
        .eq("automation_id", data.automationId)
        .order("ran_at", { ascending: false })
        .limit(20);
      if (!error && rows) return rows as AutomationRunRecord[];
    } catch {
      // Supabase unavailable; fall through to local SQLite
    }
    const { getLocalAutomationRuns } = await import("@/lib/local-db.server");
    return getLocalAutomationRuns(data.automationId);
  });

export const runAutomationNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ automationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ status: string }> => {
    let row: {
      id: string;
      user_id: string;
      name: string;
      goal: string;
      schedule_kind: string;
      schedule_hour: number;
      schedule_day_of_week: number | null;
      approved_tools: string[];
      enabled: boolean;
    } | null = null;
    try {
      const { data: automation, error } = await context.supabase
        .from("automations")
        .select(
          "id,user_id,name,goal,schedule_kind,schedule_hour,schedule_day_of_week,approved_tools,enabled",
        )
        .eq("id", data.automationId)
        .single();
      if (!error && automation) row = automation;
    } catch {
      // Supabase unavailable; fall through to local SQLite
    }

    if (!row) {
      const { getLocalAutomation } = await import("@/lib/local-db.server");
      const local = getLocalAutomation(data.automationId);
      if (local) {
        row = {
          id: local.id,
          user_id: context.userId,
          name: local.name,
          goal: local.goal,
          schedule_kind: local.schedule_kind,
          schedule_hour: local.schedule_hour,
          schedule_day_of_week: local.schedule_day_of_week,
          approved_tools: local.approved_tools,
          enabled: local.enabled,
        };
      }
    }

    if (!row) throw new Error("Automation not found.");

    const { runAutomation, toAutomationRow } = await import("@/lib/automations-runner.server");
    return runAutomation(toAutomationRow(row));
  });
