/**
 * Stage 8 — Agent/action history. Persists a trimmed, durable record of
 * each finished `WorkflowResult` so the History view can list, search and
 * re-open past runs after the page (and the in-memory trace) is gone.
 *
 * Deliberately NOT the full `RunTrace` — that can carry thousands of trace
 * events for a long run — just plan, step summaries/outputs and the
 * verification report, which is what the UI actually needs to show.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json, Plan, StepResult, VerificationReport, WorkflowResult } from "@/lib/agents";

const MAX_STEPS_STORED = 40;

function trimSteps(steps: StepResult[]): Json {
  return steps.slice(0, MAX_STEPS_STORED).map((step) => ({
    stepId: step.stepId,
    agent: step.agent,
    goal: step.goal,
    status: step.status,
    summary: step.summary,
    error: step.error,
    durationMs: step.durationMs,
  })) as unknown as Json;
}

export async function recordAgentRun(
  userId: string,
  result: WorkflowResult,
  automationId?: string,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("agent_runs").insert({
      id: result.runId,
      user_id: userId,
      goal: result.goal,
      status: result.status,
      answer: result.answer,
      verification_verdict: result.verification.verdict,
      verification_score: result.verification.score,
      step_count: result.steps.length,
      failed_count: result.steps.filter((step) => step.status === "failed").length,
      plan: result.plan as unknown as Json,
      steps: trimSteps(result.steps),
      verification: result.verification as unknown as Json,
      automation_id: automationId ?? null,
    });
    if (!error) return;
  } catch {
    // Supabase unavailable; fall through to local SQLite
  }

  const { recordLocalAgentRun } = await import("@/lib/local-db.server");
  recordLocalAgentRun(userId, {
    id: result.runId,
    goal: result.goal,
    status: result.status,
    answer: result.answer,
    verificationVerdict: result.verification.verdict,
    verificationScore: result.verification.score,
    stepCount: result.steps.length,
    failedCount: result.steps.filter((step) => step.status === "failed").length,
    plan: result.plan,
    steps: result.steps,
    verification: result.verification,
    automationId: automationId ?? null,
  });
}

export type StoredAgentRun = {
  id: string;
  goal: string;
  status: string;
  answer: string;
  verification_verdict: string | null;
  verification_score: number | null;
  step_count: number;
  failed_count: number;
  plan: Plan;
  steps: StepResult[];
  verification: VerificationReport;
  automation_id: string | null;
  created_at: string;
};
