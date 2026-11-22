/**
 * Stage 8 — Google Meet API service adapter.
 * Uses the official Google Meet REST API (v2).
 * Supports creating meeting spaces, generating join links, retrieving space info,
 * listing conference records, and inspecting authorized participants.
 */
import { googleApiFetch } from "./api-fetch.server";
import type {
  ConferenceParticipant,
  ConferenceRecord,
  MeetSpaceInfo,
  MeetSpaceResult,
} from "./types";

const SPACES_BASE = "https://meet.googleapis.com/v2/spaces";
const CONFERENCE_BASE = "https://meet.googleapis.com/v2/conferenceRecords";

/**
 * Creates a real, ready-to-join Meet space.
 * Callers must gate this behind explicit user approval.
 */
export async function createMeetingSpace(
  accessToken: string,
  input: { topic?: string } = {},
): Promise<MeetSpaceResult> {
  const body: Record<string, unknown> = {};
  if (input.topic) {
    body["config"] = { accessType: "OPEN" };
  }
  const space = await googleApiFetch<{ name: string; meetingUri: string; meetingCode: string }>(
    accessToken,
    SPACES_BASE,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
  return {
    name: space.name,
    meetingUri: space.meetingUri,
    meetingCode: space.meetingCode,
  };
}

/**
 * Retrieves detailed information about an existing meeting space.
 */
export async function getMeetingSpace(
  accessToken: string,
  spaceName: string,
): Promise<MeetSpaceInfo> {
  const cleanName = spaceName.startsWith("spaces/") ? spaceName : `spaces/${spaceName}`;
  const space = await googleApiFetch<{
    name: string;
    meetingUri: string;
    meetingCode: string;
    config?: Record<string, unknown>;
  }>(accessToken, `${SPACES_BASE}/${encodeURIComponent(cleanName.replace("spaces/", ""))}`);
  return {
    name: space.name,
    meetingUri: space.meetingUri,
    meetingCode: space.meetingCode,
    config: space.config,
  };
}

/**
 * Lists conference records (past or active calls) where authorized.
 */
export async function listConferenceRecords(
  accessToken: string,
  limit: number = 10,
): Promise<ConferenceRecord[]> {
  const result = await googleApiFetch<{
    conferenceRecords?: { name: string; startTime?: string; endTime?: string }[];
  }>(accessToken, `${CONFERENCE_BASE}?pageSize=${Math.min(limit, 25)}`);
  return (result.conferenceRecords ?? []).map((rec) => ({
    name: rec.name,
    startTime: rec.startTime ?? null,
    endTime: rec.endTime ?? null,
  }));
}

/**
 * Retrieves conference participants for a specific conference record.
 */
export async function listConferenceParticipants(
  accessToken: string,
  conferenceRecord: string,
  limit: number = 20,
): Promise<ConferenceParticipant[]> {
  const recordName = conferenceRecord.startsWith("conferenceRecords/")
    ? conferenceRecord
    : `conferenceRecords/${conferenceRecord}`;
  const result = await googleApiFetch<{
    participants?: {
      name: string;
      earliestStartTime?: string;
      latestEndTime?: string;
    }[];
  }>(
    accessToken,
    `https://meet.googleapis.com/v2/${encodeURIComponent(recordName)}/participants?pageSize=${limit}`,
  );
  return (result.participants ?? []).map((p) => ({
    name: p.name,
    earliestStartTime: p.earliestStartTime ?? null,
    latestEndTime: p.latestEndTime ?? null,
  }));
}
