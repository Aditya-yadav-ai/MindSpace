/** Stage 6 — Forms Agent's real API surface: create a form, read its responses (both read-only against user data; creating a form is the one write). */
import { googleApiFetch } from "./api-fetch.server";
import type { FormCreateInput, FormCreateResult, FormResponseSummary } from "./types";

const BASE = "https://forms.googleapis.com/v1/forms";

/** Creates a real Google Form. Callers must gate this behind explicit approval. */
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
  if (input.description.trim()) {
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

export async function listResponses(
  accessToken: string,
  formId: string,
  limit: number,
): Promise<FormResponseSummary[]> {
  const result = await googleApiFetch<{
    responses?: {
      responseId: string;
      lastSubmittedTime?: string;
      answers?: Record<string, unknown>;
    }[];
  }>(accessToken, `${BASE}/${encodeURIComponent(formId)}/responses?pageSize=${limit}`);
  return (result.responses ?? []).map((response) => ({
    responseId: response.responseId,
    submittedAt: response.lastSubmittedTime ?? null,
    answerCount: Object.keys(response.answers ?? {}).length,
  }));
}
