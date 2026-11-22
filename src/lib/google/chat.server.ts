/**
 * Stage 8 — Google Chat API service adapter.
 * Uses the official Google Chat API (v1).
 * Supports listing spaces, retrieving space details, reading messages,
 * sending messages, creating spaces, and listing space members.
 */
import { googleApiFetch } from "./api-fetch.server";
import type {
  ChatMemberSummary,
  ChatMessageInput,
  ChatMessageResult,
  ChatMessageSummary,
  ChatSpaceDetails,
  ChatSpaceSummary,
} from "./types";

const BASE = "https://chat.googleapis.com/v1";

/**
 * Lists Google Chat spaces the user has access to.
 */
export async function listSpaces(
  accessToken: string,
  limit: number = 10,
): Promise<ChatSpaceSummary[]> {
  const result = await googleApiFetch<{
    spaces?: { name: string; displayName?: string; spaceType: string }[];
  }>(accessToken, `${BASE}/spaces?pageSize=${Math.min(limit, 50)}`);
  return (result.spaces ?? []).map((space) => ({
    name: space.name,
    displayName: space.displayName ?? "(unnamed space)",
    type: space.spaceType,
  }));
}

/**
 * Retrieves details of a specific Chat space.
 */
export async function getSpace(accessToken: string, spaceName: string): Promise<ChatSpaceDetails> {
  const cleanName = spaceName.startsWith("spaces/") ? spaceName : `spaces/${spaceName}`;
  const space = await googleApiFetch<{
    name: string;
    displayName?: string;
    spaceType: string;
    description?: string;
  }>(accessToken, `${BASE}/${cleanName}`);
  return {
    name: space.name,
    displayName: space.displayName ?? "(unnamed space)",
    spaceType: space.spaceType,
    description: space.description,
  };
}

/**
 * Lists recent messages in a Chat space.
 */
export async function listMessages(
  accessToken: string,
  spaceName: string,
  limit: number = 10,
): Promise<ChatMessageSummary[]> {
  const cleanName = spaceName.startsWith("spaces/") ? spaceName : `spaces/${spaceName}`;
  const result = await googleApiFetch<{
    messages?: {
      name: string;
      text?: string;
      sender?: { displayName?: string };
      createTime: string;
    }[];
  }>(accessToken, `${BASE}/${cleanName}/messages?pageSize=${Math.min(limit, 50)}`);
  return (result.messages ?? []).map((m) => ({
    name: m.name,
    text: m.text ?? "",
    sender: m.sender?.displayName,
    createTime: m.createTime,
  }));
}

/**
 * Sends a real message to a Chat space.
 * Callers must gate this behind explicit user approval.
 */
export async function sendMessage(
  accessToken: string,
  input: ChatMessageInput,
): Promise<ChatMessageResult> {
  const cleanSpace = input.space.startsWith("spaces/") ? input.space : `spaces/${input.space}`;
  const message = await googleApiFetch<{ name: string; createTime: string }>(
    accessToken,
    `${BASE}/${cleanSpace}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ text: input.text }),
    },
  );
  return { name: message.name, createTime: message.createTime };
}

/**
 * Creates a new space in Google Chat where permitted.
 * Callers must gate this behind explicit user approval.
 */
export async function createSpace(
  accessToken: string,
  displayName: string,
): Promise<ChatSpaceDetails> {
  const space = await googleApiFetch<{
    name: string;
    displayName?: string;
    spaceType: string;
  }>(accessToken, `${BASE}/spaces`, {
    method: "POST",
    body: JSON.stringify({
      displayName,
      spaceType: "SPACE",
    }),
  });
  return {
    name: space.name,
    displayName: space.displayName ?? displayName,
    spaceType: space.spaceType,
  };
}

/**
 * Lists memberships in a Chat space.
 */
export async function listMembers(
  accessToken: string,
  spaceName: string,
  limit: number = 20,
): Promise<ChatMemberSummary[]> {
  const cleanName = spaceName.startsWith("spaces/") ? spaceName : `spaces/${spaceName}`;
  const result = await googleApiFetch<{
    memberships?: {
      name: string;
      state?: string;
      member?: { displayName?: string };
    }[];
  }>(accessToken, `${BASE}/${cleanName}/members?pageSize=${Math.min(limit, 50)}`);
  return (result.memberships ?? []).map((m) => ({
    name: m.name,
    displayName: m.member?.displayName,
    state: m.state,
  }));
}
