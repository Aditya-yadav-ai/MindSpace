/** Stage 6 — Docs Agent's real API surface: read a doc's text, create a new one with initial text. */
import { googleApiFetch } from "./api-fetch.server";
import type { DocCreateInput, DocCreateResult, DocSummary } from "./types";

const BASE = "https://docs.googleapis.com/v1/documents";

type DocsApiResponse = {
  documentId: string;
  title: string;
  body?: { content?: { paragraph?: { elements?: { textRun?: { content?: string } }[] } }[] };
};

function extractText(doc: DocsApiResponse): string {
  const blocks = doc.body?.content ?? [];
  const parts: string[] = [];
  for (const block of blocks) {
    for (const element of block.paragraph?.elements ?? []) {
      if (element.textRun?.content) parts.push(element.textRun.content);
    }
  }
  return parts.join("").trim();
}

export async function readDocument(accessToken: string, documentId: string): Promise<DocSummary> {
  const doc = await googleApiFetch<DocsApiResponse>(
    accessToken,
    `${BASE}/${encodeURIComponent(documentId)}`,
  );
  return {
    documentId: doc.documentId,
    title: doc.title,
    text: extractText(doc),
    webUrl: `https://docs.google.com/document/d/${doc.documentId}/edit`,
  };
}

/** Creates a real Google Doc with `input.body` as its initial text. Callers must gate this behind explicit approval. */
export async function createDocument(
  accessToken: string,
  input: DocCreateInput,
): Promise<DocCreateResult> {
  const created = await googleApiFetch<{ documentId: string }>(accessToken, BASE, {
    method: "POST",
    body: JSON.stringify({ title: input.title }),
  });
  if (input.body.trim()) {
    await googleApiFetch(accessToken, `${BASE}/${created.documentId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        requests: [{ insertText: { location: { index: 1 }, text: input.body } }],
      }),
    });
  }
  return {
    documentId: created.documentId,
    webUrl: `https://docs.google.com/document/d/${created.documentId}/edit`,
  };
}
