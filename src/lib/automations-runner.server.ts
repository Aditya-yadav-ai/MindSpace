/**
 * Stage 8 — executes one automation: runs its saved goal through the real
 * agent framework, with pre-approval limited to exactly the tools the user
 * chose at creation time (see the migration's comment on `approved_tools`),
 * then records both an `agent_runs` row and an `automation_runs` row and
 * advances `next_run_at`. Shared by the "Run now" server function and the
 * cron route so both paths behave identically.
 */
import { runWorkflow } from "@/lib/agents";
import { recordAgentRun } from "@/lib/history.server";
import { computeNextRun, type Schedule } from "@/lib/automations-schedule";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AutomationRow = {
  id: string;
  user_id: string;
  name: string;
  goal: string;
  schedule_kind: "hourly" | "daily" | "weekly";
  schedule_hour: number;
  schedule_day_of_week: number | null;
  approved_tools: string[];
  enabled: boolean;
};

/** Narrows a DB row's loosely-typed `schedule_kind` (CHECK-constrained, not enum-typed) to the literal union. */
export function toAutomationRow(row: {
  id: string;
  user_id: string;
  name: string;
  goal: string;
  schedule_kind: string;
  schedule_hour: number;
  schedule_day_of_week: number | null;
  approved_tools: string[];
  enabled: boolean;
}): AutomationRow {
  const kind =
    row.schedule_kind === "hourly" || row.schedule_kind === "weekly" ? row.schedule_kind : "daily";
  return { ...row, schedule_kind: kind };
}

export async function runAutomation(automation: AutomationRow): Promise<{ status: string }> {
  const { createGoogleServices } = await import("@/lib/google/adapter.server");
  const { getConnectionStatus } = await import("@/lib/google/oauth.server");
  const { createTaskService } = await import("@/lib/reminders/service.server");

  const status = await getConnectionStatus(automation.user_id).catch(() => ({
    connected: false as const,
  }));

  let result: Awaited<ReturnType<typeof runWorkflow>> | null = null;
  let runStatus = "failed";
  let summary = "";

  try {
    result = await runWorkflow({
      goal: automation.goal,
      approvals: automation.approved_tools,
      ...(status.connected ? { google: createGoogleServices(automation.user_id) } : {}),
      tasks: createTaskService(automation.user_id),
    });
    runStatus = result.status;
    summary = result.answer.slice(0, 500);
    await recordAgentRun(automation.user_id, result, automation.id);
  } catch (error) {
    summary = error instanceof Error ? error.message : "The automation failed to run.";
  }

  const schedule: Schedule = {
    kind: automation.schedule_kind,
    hour: automation.schedule_hour,
    dayOfWeek: automation.schedule_day_of_week,
  };
  const nextRunAt = computeNextRun(schedule);

  await supabaseAdmin
    .from("automations")
    .update({ last_run_at: new Date().toISOString(), next_run_at: nextRunAt.toISOString() })
    .eq("id", automation.id);

  await supabaseAdmin.from("automation_runs").insert({
    automation_id: automation.id,
    user_id: automation.user_id,
    agent_run_id: result?.runId ?? null,
    status: runStatus,
    summary,
  });

  return { status: runStatus };
}
