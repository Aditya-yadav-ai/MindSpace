/** Stage 6 — Meet Agent's real API surface: create an instant meeting space. */
import { googleApiFetch } from "./api-fetch.server";
import type { MeetSpaceResult } from "./types";

const BASE = "https://meet.googleapis.com/v2/spaces";

/** Creates a real, ready-to-join Meet space. Callers must gate this behind explicit approval. */
export async function createMeetingSpace(accessToken: string): Promise<MeetSpaceResult> {
  const space = await googleApiFetch<{ name: string; meetingUri: string; meetingCode: string }>(
    accessToken,
    BASE,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
  return { name: space.name, meetingUri: space.meetingUri, meetingCode: space.meetingCode };
}
