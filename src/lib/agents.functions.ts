/**
 * Stage 4/5/8 — server entry point for running a multi-agent workflow from the
 * UI. Supports both authenticated sessions and local extension preview mode.
 * When the signed-in user has connected Google, real (but confirmation-gated) Gmail/
 * Calendar/Drive services are wired in; otherwise Google tools fail with a
 * clear "not connected" error instead of silently no-op'ing.
 */
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { runWorkflow } from "@/lib/agents";
import type { WorkflowResult } from "@/lib/agents";

export const optionalSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const SUPABASE_URL = process.env["SUPABASE_URL"];
    const SUPABASE_PUBLISHABLE_KEY = process.env["SUPABASE_PUBLISHABLE_KEY"];

    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      return next({ context: { userId: "local-user" } });
    }

    try {
      const request = getRequest();
      if (!request?.headers) {
        return next({ context: { userId: "local-user" } });
      }

      const authHeader = request.headers.get("authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return next({ context: { userId: "local-user" } });
      }

      const token = authHeader.replace("Bearer ", "");
      if (!token || token.split(".").length !== 3) {
        return next({ context: { userId: "local-user" } });
      }

      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });

      const { data, error } = await supabase.auth.getClaims(token);
      if (error || !data?.claims?.sub) {
        return next({ context: { userId: "local-user" } });
      }

      return next({
        context: {
          userId: data.claims.sub,
        },
      });
    } catch {
      return next({ context: { userId: "local-user" } });
    }
  },
);

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
  .middleware([optionalSupabaseAuth])
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

export type MasBlackboardEvent = {
  id: number;
  run_id: string;
  event_type: string;
  agent_name: string;
  details: Record<string, unknown>;
  created_at: string;
};

export type MasP2PMessage = {
  seq: number;
  msg_id: string;
  correlation_id: string;
  sender: string;
  recipient: string;
  msg_type: string;
  content: Record<string, unknown>;
  created_at: string;
  delivered_at: string | null;
  acknowledged: boolean;
};

export type MasActivityResponse = {
  status: string;
  stats: {
    audit_events_count: number;
    p2p_messages_count: number;
  };
  blackboard_events: MasBlackboardEvent[];
  p2p_messages: MasP2PMessage[];
};

export const getMasActivityFeed = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z
      .object({
        runId: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data }): Promise<MasActivityResponse | null> => {
    const apiBase = (
      process.env["MINDSPACE_API_URL"] ||
      process.env["FASTAPI_URL"] ||
      "http://127.0.0.1:8010"
    ).replace(/\/+$/, "");
    try {
      const url = new URL(`${apiBase}/v1/mas/activity`);
      if (data.runId) url.searchParams.set("run_id", data.runId);
      url.searchParams.set("limit", String(data.limit));
      const res = await fetch(url.toString(), {
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      return (await res.json()) as MasActivityResponse;
    } catch {
      return null;
    }
  });
