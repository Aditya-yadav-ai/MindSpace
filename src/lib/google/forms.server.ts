/**
 * Stage 8 — Google Forms API service adapter.
 * Uses the official Google Forms API (v1).
 * Supports creating forms, retrieving form details & questions,
 * listing responses, and reading response summaries.
 */
import { googleApiFetch } from "./api-fetch.server";
import type {
  FormCreateInput,
  FormCreateResult,
  FormDetails,
  FormQuestion,
  FormResponseSummary,
  FormResponseSummaryStat,
} from "./types";

const BASE = "https://forms.googleapis.com/v1/forms";

/**
 * Creates a real Google Form with title and optional description.
 * Callers must gate this behind explicit user approval.
 */
export async function createForm(
  accessToken: string,
  input: FormCreateInput,
): Promise<FormCreateResult> {
  const created = await googleApiFetch<{ formId: string; responderUri: string }>(
    accessToken,
    BASE,
    {
      method: "POST",
      body: JSON.stringify({ info: { title: input.title, documentTitle: input.title } }),
    },
  );
  if (input.description && input.description.trim()) {
    await googleApiFetch(accessToken, `${BASE}/${created.formId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            updateFormInfo: { info: { description: input.description }, updateMask: "description" },
          },
        ],
      }),
    });
  }
  return {
    formId: created.formId,
    editUrl: `https://docs.google.com/forms/d/${created.formId}/edit`,
    responderUrl: created.responderUri,
  };
}

/**
 * Retrieves full details of a form by its ID.
 */
export async function getForm(accessToken: string, formId: string): Promise<FormDetails> {
  const result = await googleApiFetch<{
    formId: string;
    info: { title: string; description?: string; documentTitle?: string };
    responderUri: string;
  }>(accessToken, `${BASE}/${encodeURIComponent(formId)}`);
  return {
    formId: result.formId,
    title: result.info.title || result.info.documentTitle || "Untitled Form",
    description: result.info.description || "",
    responderUri: result.responderUri,
  };
}

/**
 * Retrieves the list of questions / items in a Google Form.
 */
export async function getFormQuestions(
  accessToken: string,
  formId: string,
): Promise<FormQuestion[]> {
  const result = await googleApiFetch<{
    items?: {
      itemId: string;
      title?: string;
      description?: string;
      questionItem?: Record<string, unknown>;
    }[];
  }>(accessToken, `${BASE}/${encodeURIComponent(formId)}`);

  return (result.items ?? [])
    .filter((item) => Boolean(item.questionItem || item.title))
    .map((item) => ({
      itemId: item.itemId,
      title: item.title ?? "(Untitled Question)",
      description: item.description,
    }));
}

/**
 * Lists submitted responses for a form.
 */
export async function listResponses(
  accessToken: string,
  formId: string,
  limit: number = 10,
): Promise<FormResponseSummary[]> {
  const result = await googleApiFetch<{
    responses?: {
      responseId: string;
      lastSubmittedTime?: string;
      answers?: Record<string, unknown>;
    }[];
  }>(
    accessToken,
    `${BASE}/${encodeURIComponent(formId)}/responses?pageSize=${Math.min(limit, 50)}`,
  );
  return (result.responses ?? []).map((response) => ({
    responseId: response.responseId,
    submittedAt: response.lastSubmittedTime ?? null,
    answerCount: Object.keys(response.answers ?? {}).length,
  }));
}

/**
 * Calculates a summary of responses for a form.
 */
export async function getFormResponseSummary(
  accessToken: string,
  formId: string,
): Promise<FormResponseSummaryStat> {
  const responses = await listResponses(accessToken, formId, 100);
  const lastSubmitted = responses.length > 0 ? (responses[0]?.submittedAt ?? null) : null;
  return {
    formId,
    totalResponses: responses.length,
    lastSubmittedTime: lastSubmitted,
  };
}
