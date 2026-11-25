/**
 * Stage 8 — History server functions. Two durable logs, both RLS-scoped to
 * the signed-in user: agent/action runs (`agent_runs`, written by
 * `history.server.ts` right after each `runWorkflow`) and conversation
 * turns (`chat_turns`, written by the chat panel as each reply finishes).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Plan, StepResult, VerificationReport } from "@/lib/agents";

export type AgentRunSummary = {
  id: string;
  goal: string;
  status: string;
  answer: string;
  verification_verdict: string | null;
  verification_score: number | null;
  step_count: number;
  failed_count: number;
  automation_id: string | null;
  created_at: string;
};

export type AgentRunDetail = AgentRunSummary & {
  plan: Plan;
  steps: StepResult[];
  verification: VerificationReport;
};

const ListAgentRunsInput = z.object({
  search: z.string().trim().max(200).default(""),
  status: z.enum(["all", "verified", "partial", "failed"]).default("all"),
  limit: z.number().int().min(1).max(100).default(30),
});

export const listAgentRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListAgentRunsInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<AgentRunSummary[]> => {
    const search = typeof data?.search === "string" ? data.search : "";
    const status = typeof data?.status === "string" ? data.status : "all";
    const limit = typeof data?.limit === "number" ? data.limit : 30;
    try {
      if (context?.supabase && typeof context.supabase.from === "function") {
        let query = context.supabase
          .from("agent_runs")
          .select(
            "id,goal,status,answer,verification_verdict,verification_score,step_count,failed_count,automation_id,created_at",
          )
          .order("created_at", { ascending: false })
          .limit(limit);
        if (status !== "all") query = query.eq("status", status);
        if (search) query = query.ilike("goal", `%${search}%`);
        const { data: rows, error } = await query;
        if (!error && rows && rows.length > 0) return rows as AgentRunSummary[];
      }
    } catch {
      // Supabase unavailable; fall through to local SQLite
    }
    const { getLocalAgentRuns } = await import("@/lib/local-db.server");
    return getLocalAgentRuns(context.userId, search, status, limit);
  });

export const getAgentRun = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ runId: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }): Promise<AgentRunDetail | null> => {
    try {
      if (context?.supabase && typeof context.supabase.from === "function") {
        const { data: row, error } = await context.supabase
          .from("agent_runs")
          .select("*")
          .eq("id", data.runId)
          .maybeSingle();
        if (!error && row) return row as unknown as AgentRunDetail;
      }
    } catch {
      // Supabase unavailable; fall through to local SQLite
    }
    const { getLocalAgentRun } = await import("@/lib/local-db.server");
    return getLocalAgentRun(data.runId);
  });

export const deleteAgentRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ runId: z.string().min(1) }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    try {
      if (context?.supabase && typeof context.supabase.from === "function") {
        const { error } = await context.supabase.from("agent_runs").delete().eq("id", data.runId);
        if (!error) {
          const { deleteLocalAgentRun } = await import("@/lib/local-db.server");
          deleteLocalAgentRun(data.runId);
          return { ok: true };
        }
      }
    } catch {
      // Supabase unavailable; fall through to local SQLite
    }
    const { deleteLocalAgentRun } = await import("@/lib/local-db.server");
    deleteLocalAgentRun(data.runId);
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Conversation history                                                 */
/* ------------------------------------------------------------------ */

export type ChatTurnRecord = {
  id: string;
  role: "user" | "assistant";
  content: string;
  page_title: string | null;
  page_url: string | null;
  created_at: string;
};

const RecordChatTurnInput = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(20_000),
  pageTitle: z.string().trim().max(300).nullable().default(null),
  pageUrl: z.string().trim().max(2000).nullable().default(null),
});

/** Append one turn. Called best-effort from the chat panel; never blocks the live reply. */
export const recordChatTurn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RecordChatTurnInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    try {
      if (context?.supabase && typeof context.supabase.from === "function") {
        const { error } = await context.supabase.from("chat_turns").insert({
          user_id: context.userId,
          role: data.role,
          content: data.content,
          page_title: data.pageTitle,
          page_url: data.pageUrl,
        });
        if (!error) return { ok: true };
      }
    } catch {
      // Supabase unavailable; fall through to local SQLite
    }
    const { recordLocalChatTurn } = await import("@/lib/local-db.server");
    recordLocalChatTurn(context.userId, {
      role: data.role,
      content: data.content,
      pageTitle: data.pageTitle,
      pageUrl: data.pageUrl,
    });
    return { ok: true };
  });

const ListChatHistoryInput = z.object({
  search: z.string().trim().max(200).default(""),
  limit: z.number().int().min(1).max(200).default(60),
});

export const listChatHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListChatHistoryInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<ChatTurnRecord[]> => {
    const search = typeof data?.search === "string" ? data.search : "";
    const limit = typeof data?.limit === "number" ? data.limit : 60;
    try {
      if (context?.supabase && typeof context.supabase.from === "function") {
        let query = context.supabase
          .from("chat_turns")
          .select("id,role,content,page_title,page_url,created_at")
          .order("created_at", { ascending: false })
          .limit(limit);
        if (search) query = query.ilike("content", `%${search}%`);
        const { data: rows, error } = await query;
        if (!error && rows && rows.length > 0) return rows as ChatTurnRecord[];
      }
    } catch {
      // Supabase unavailable; fall through to local SQLite
    }
    const { getLocalChatTurns } = await import("@/lib/local-db.server");
    return getLocalChatTurns(context.userId, search, limit);
  });

export const deleteChatTurn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ turnId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    try {
      if (context?.supabase && typeof context.supabase.from === "function") {
        const { error } = await context.supabase.from("chat_turns").delete().eq("id", data.turnId);
        if (!error) {
          const { deleteLocalChatTurn } = await import("@/lib/local-db.server");
          deleteLocalChatTurn(data.turnId);
          return { ok: true };
        }
      }
    } catch {
      // Supabase unavailable; fall through to local SQLite
    }
    const { deleteLocalChatTurn } = await import("@/lib/local-db.server");
    deleteLocalChatTurn(data.turnId);
    return { ok: true };
  });

export const clearChatHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    try {
      if (context?.supabase && typeof context.supabase.from === "function") {
        const { error } = await context.supabase
          .from("chat_turns")
          .delete()
          .eq("user_id", context.userId);
        if (!error) {
          const { clearLocalChatTurns } = await import("@/lib/local-db.server");
          clearLocalChatTurns(context.userId);
          return { ok: true };
        }
      }
    } catch {
      // Supabase unavailable; fall through to local SQLite
    }
    const { clearLocalChatTurns } = await import("@/lib/local-db.server");
    clearLocalChatTurns(context.userId);
    return { ok: true };
  });
