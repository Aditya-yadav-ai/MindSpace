/**
 * Stage 5 — Gmail Agent's real API surface.
 * Only two operations: list recent messages (read) and create a draft
 * (never sends). Sending mail is intentionally out of scope for Stage 5.
 */
import { googleApiFetch } from "./api-fetch.server";
import type { GmailDraftInput, GmailDraftResult, GmailMessageSummary } from "./types";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

type GmailListResponse = { messages?: { id: string; threadId: string }[] };
type GmailMessageResponse = {
  id: string;
  threadId: string;
  snippet: string;
  internalDate?: string;
  payload?: { headers?: { name: string; value: string }[] };
};

function header(message: GmailMessageResponse, name: string) {
  return (
    message.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ""
  );
}

export async function listRecentMessages(
  accessToken: string,
  options: { query: string; limit: number },
): Promise<GmailMessageSummary[]> {
  const params = new URLSearchParams({ maxResults: String(options.limit) });
  if (options.query) params.set("q", options.query);

  const list = await googleApiFetch<GmailListResponse>(
    accessToken,
    `${BASE}/messages?${params.toString()}`,
  );
  const ids = list.messages ?? [];

  const messages = await Promise.all(
    ids.map((item) =>
      googleApiFetch<GmailMessageResponse>(
        accessToken,
        `${BASE}/messages/${item.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
      ),
    ),
  );

  return messages.map((message) => ({
    id: message.id,
    threadId: message.threadId,
    from: header(message, "From"),
    subject: header(message, "Subject"),
    snippet: message.snippet,
    receivedAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
  }));
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

/** Creates a Gmail draft. This is a consequential, real write to the user's account — callers must gate it behind explicit approval. */
export async function createDraft(
  accessToken: string,
  input: GmailDraftInput,
): Promise<GmailDraftResult> {
  const mime = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    input.body,
  ].join("\r\n");

  const draft = await googleApiFetch<{ id: string; message: { id: string } }>(
    accessToken,
    `${BASE}/drafts`,
    {
      method: "POST",
      body: JSON.stringify({ message: { raw: toBase64Url(mime) } }),
    },
  );

  return {
    draftId: draft.id,
    messageId: draft.message.id,
    webUrl: `https://mail.google.com/mail/u/0/#drafts/${draft.message.id}`,
  };
}
