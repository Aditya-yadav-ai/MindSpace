/**
 * Stage 4/5 — server entry point for running a multi-agent workflow from the
 * UI. Auth-gated like every other MindSpace server function. When the
 * signed-in user has connected Google, real (but confirmation-gated) Gmail/
 * Calendar/Drive services are wired in; otherwise Google tools fail with a
 * clear "not connected" error instead of silently no-op'ing.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runWorkflow } from "@/lib/agents";
import type { WorkflowResult } from "@/lib/agents";

const PageInput = z.object({
  title: z.string().max(300).default(""),
  url: z.string().max(2000).default(""),
  selection: z.string().max(20_000).default(""),
  text: z.string().max(200_000).default(""),
});

const RunWorkflowInput = z.object({
  goal: z.string().trim().min(3).max(600),
  page: PageInput.default({ title: "", url: "", selection: "", text: "" }),
  /** Tool names the user has explicitly approved for this run (consequential Google writes only). */
  approvals: z.array(z.string()).max(10).default([]),
});

export const runAgentWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RunWorkflowInput.parse(input))
  .handler(async ({ data, context }): Promise<WorkflowResult> => {
    // Dynamic import: these touch Google/Supabase secrets server-side only
    // and must never end up in the client bundle for this *.functions.ts module.
    const { createGoogleServices } = await import("@/lib/google/adapter.server");
    const { getConnectionStatus } = await import("@/lib/google/oauth.server");
    const { createTaskService } = await import("@/lib/reminders/service.server");

    const status = await getConnectionStatus(context.userId).catch(() => ({
      connected: false as const,
    }));

    const result = await runWorkflow({
      goal: data.goal,
      page: data.page,
      approvals: data.approvals,
      ...(status.connected ? { google: createGoogleServices(context.userId) } : {}),
      tasks: createTaskService(context.userId),
    });

    // Stage 8 — best-effort persistence of the run for the History view.
    // Never lets a logging failure fail the workflow itself.
    const { recordAgentRun } = await import("@/lib/history.server");
    await recordAgentRun(context.userId, result).catch((error) => {
      console.error("[history] failed to record agent run", error);
    });

    return result;
  });
