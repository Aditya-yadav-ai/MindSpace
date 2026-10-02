/** Stage 6 — Chat Agent's real API surface: list spaces (read), send a message (write). */
import { googleApiFetch } from "./api-fetch.server";
import type { ChatMessageInput, ChatMessageResult, ChatSpaceSummary } from "./types";

const BASE = "https://chat.googleapis.com/v1/spaces";

export async function listSpaces(accessToken: string, limit: number): Promise<ChatSpaceSummary[]> {
  const result = await googleApiFetch<{
    spaces?: { name: string; displayName?: string; spaceType: string }[];
  }>(accessToken, `${BASE}?pageSize=${limit}`);
  return (result.spaces ?? []).map((space) => ({
    name: space.name,
    displayName: space.displayName ?? "(unnamed space)",
    type: space.spaceType,
  }));
}

/** Sends a real message to a Chat space. Callers must gate this behind explicit approval. */
export async function sendMessage(
  accessToken: string,
  input: ChatMessageInput,
): Promise<ChatMessageResult> {
  const message = await googleApiFetch<{ name: string; createTime: string }>(
    accessToken,
    `${BASE}/${encodeURIComponent(input.space)}/messages`,
    { method: "POST", body: JSON.stringify({ text: input.text }) },
  );
  return { name: message.name, createTime: message.createTime };
}
