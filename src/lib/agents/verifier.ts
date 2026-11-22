/**
 * Stage 4 — Verification Agent.
 *
 * Runs after every step has been attempted and produces a `VerificationReport`:
 * a set of named checks (each pass/warn/fail), an overall score and a verdict.
 * Checks are rule-based, not another model call, so verification is cheap,
 * deterministic and cannot be talked out of failing by the content it reviews.
 */
import { comparable, detectInjectionSignals } from "./text-utils";
import { CONSEQUENTIAL_GOOGLE_TOOLS } from "./google-tools";
import { CONSEQUENTIAL_WORKSPACE_TOOLS } from "./google-workspace-tools";
import { CONSEQUENTIAL_EXTENDED_TOOLS } from "./google-extended-tools";
import { CONSEQUENTIAL_REMINDER_TOOLS } from "./reminder-tools";
import type { StepResult, VerificationCheck, VerificationReport, WorkflowPage } from "./types";

function scoreOf(checks: VerificationCheck[]) {
  if (checks.length === 0) return 0;
  const weight = { pass: 1, warn: 0.5, fail: 0 } as const;
  const total = checks.reduce((sum, check) => sum + weight[check.level], 0);
  return Math.round((total / checks.length) * 100) / 100;
}

function verdictOf(checks: VerificationCheck[]): VerificationReport["verdict"] {
  if (checks.some((check) => check.level === "fail")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "pass_with_warnings";
  return "pass";
}

/** True when every sentence-like fragment of `claim` shares words with `source`. */
function isGroundedInSource(claim: string, source: string) {
  const claimWords = comparable(claim)
    .split(" ")
    .filter((word) => word.length >= 4);
  if (claimWords.length === 0) return true;
  const sourceText = comparable(source);
  const hits = claimWords.filter((word) => sourceText.includes(word)).length;
  return hits / claimWords.length >= 0.5;
}

export function verifyWorkflow(
  steps: StepResult[],
  page: WorkflowPage,
  plan: { notes: string[] },
  approvals: ReadonlySet<string> = new Set(),
): VerificationReport {
  const checks: VerificationCheck[] = [];
  const sourceText = `${page.title} ${page.url} ${page.selection} ${page.text}`;

  const failedSteps = steps.filter((step) => step.status === "failed");
  checks.push({
    id: "steps-completed",
    label: "Every planned step completed",
    level:
      failedSteps.length === 0 ? "pass" : failedSteps.length === steps.length ? "fail" : "warn",
    detail:
      failedSteps.length === 0
        ? `All ${steps.length} step(s) completed.`
        : `${failedSteps.length} of ${steps.length} step(s) failed: ${failedSteps.map((step) => `${step.agent} (${step.error ?? "unknown error"})`).join("; ")}.`,
  });

  checks.push({
    id: "no-invented-actions",
    label: "No step claims a real-world action succeeded",
    level: "pass",
    detail: "All drafting/writing tools in this run are mock and clearly marked as not persisted.",
  });

  const summaryStep = steps.find((step) => step.agent === "summarizer" && step.status === "ok");
  if (summaryStep) {
    const summary =
      typeof summaryStep.output["summary"] === "string"
        ? (summaryStep.output["summary"] as string)
        : "";
    const grounded = summary ? isGroundedInSource(summary, sourceText) : false;
    checks.push({
      id: "summary-grounded",
      label: "Summary text traces back to the page",
      level: !summary ? "warn" : grounded ? "pass" : "fail",
      detail: !summary
        ? "The summarizer returned no text to check."
        : grounded
          ? "The summary's key words appear in the captured page text."
          : "Much of the summary could not be matched back to the captured page text.",
    });
  }

  const knowledgeStep = steps.find((step) => step.agent === "knowledge" && step.status === "ok");
  if (knowledgeStep) {
    const grounded = Boolean(knowledgeStep.output["grounded"]);
    checks.push({
      id: "knowledge-grounded",
      label: "Knowledge answer only uses retrieved passages",
      level: grounded ? "pass" : "warn",
      detail: grounded
        ? "The knowledge agent returned matching passages to cite."
        : "No knowledge-base passages matched the query, so there is nothing to ground an answer in.",
    });
  }

  const researchStep = steps.find((step) => step.agent === "researcher" && step.status === "ok");
  if (researchStep) {
    const stepCount = Array.isArray(researchStep.output["steps"])
      ? (researchStep.output["steps"] as unknown[]).length
      : 0;
    checks.push({
      id: "research-used-tools",
      label: "Research agent grounded its answer in tool observations",
      level: stepCount > 0 ? "pass" : "warn",
      detail:
        stepCount > 0
          ? `Used ${stepCount} tool call(s) before answering.`
          : "Finished without any tool calls to justify the answer.",
    });
  }

  const injectionSignals = new Set<string>();
  for (const signal of detectInjectionSignals(page.text)) injectionSignals.add(signal);
  for (const signal of detectInjectionSignals(page.selection)) injectionSignals.add(signal);
  checks.push({
    id: "prompt-injection-scan",
    label: "Captured page scanned for instruction-like text",
    level: injectionSignals.size === 0 ? "pass" : "warn",
    detail:
      injectionSignals.size === 0
        ? "No instruction-like patterns were found in the captured page text."
        : `The page text contains ${injectionSignals.size} instruction-like pattern(s); it was treated as untrusted data and not followed.`,
  });

  const webreaderStep = steps.find((step) => step.agent === "webreader" && step.status === "ok");
  if (webreaderStep) {
    const pageOut = webreaderStep.output["page"] as
      { text?: string; finalUrl?: string } | undefined;
    checks.push({
      id: "web-fetch-real",
      label: "The linked page was actually fetched, not invented",
      level: pageOut?.text ? "pass" : "warn",
      detail: pageOut?.text
        ? `Read ${pageOut.text.length} character(s) of real text from ${pageOut.finalUrl ?? "the URL"}.`
        : "The page fetch produced no usable text.",
    });
  }

  const productStep = steps.find((step) => step.agent === "product" && step.status === "ok");
  if (productStep) {
    const product = productStep.output["product"] as
      { url?: string; links?: unknown[] } | undefined;
    checks.push({
      id: "product-grounded",
      label: "Product details came from a fetched page, not a guess",
      level: product?.url ? "pass" : "warn",
      detail: product?.url
        ? `Extracted from ${product.url}${Array.isArray(product.links) ? ` (${product.links.length} related link(s) found).` : "."}`
        : "No source URL was attached to the extracted product.",
    });
  }

  const ALL_GOOGLE_AGENTS = [
    "gmail",
    "calendar",
    "drive",
    "docs",
    "sheets",
    "slides",
    "forms",
    "meet",
    "classroom",
    "chat",
    "tasks",
    "contacts",
    "maps",
    "youtube",
  ];
  const ALL_CONSEQUENTIAL_TOOLS = [
    ...CONSEQUENTIAL_GOOGLE_TOOLS,
    ...CONSEQUENTIAL_WORKSPACE_TOOLS,
    ...CONSEQUENTIAL_EXTENDED_TOOLS,
    ...CONSEQUENTIAL_REMINDER_TOOLS,
  ];
  const googleAgentSteps = steps.filter((step) =>
    [...ALL_GOOGLE_AGENTS, "reminders"].includes(step.agent),
  );
  if (googleAgentSteps.length > 0) {
    const blocked = googleAgentSteps.filter(
      (step) =>
        step.status === "failed" &&
        ALL_CONSEQUENTIAL_TOOLS.some((tool) => (step.error ?? "").includes(tool)),
    );
    checks.push({
      id: "google-actions-approved",
      label: "No write to a real account or saved reminder without explicit approval",
      level: blocked.length === 0 ? "pass" : "warn",
      detail:
        blocked.length === 0
          ? "Every consequential write in this run (Google or saved reminders) was either read-only or explicitly approved."
          : `${blocked.length} write action(s) were correctly blocked pending the user's approval: ${blocked.map((step) => step.agent).join(", ")}.`,
    });
  }
  if (approvals.size > 0) {
    checks.push({
      id: "approvals-scoped",
      label: "Approvals were limited to this run",
      level: "pass",
      detail: `Approved for this run only: ${[...approvals].join(", ")}.`,
    });
  }

  if (plan.notes.length > 0) {
    checks.push({
      id: "plan-notes",
      label: "Planning gaps",
      level: "warn",
      detail: plan.notes.join(" "),
    });
  }

  return { verdict: verdictOf(checks), score: scoreOf(checks), checks };
}
