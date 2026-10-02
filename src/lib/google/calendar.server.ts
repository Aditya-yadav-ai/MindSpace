/**
 * Stage 5 — Calendar Agent's real API surface: list upcoming events (read)
 * and create one event (consequential — gate behind explicit approval).
 */
import { googleApiFetch } from "./api-fetch.server";
import type { CalendarEventInput, CalendarEventResult, CalendarEventSummary } from "./types";

const BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

type CalendarListResponse = {
  items?: {
    id: string;
    summary?: string;
    location?: string;
    htmlLink?: string;
    start?: { date?: string; dateTime?: string };
    end?: { date?: string; dateTime?: string };
  }[];
};

export async function listUpcomingEvents(
  accessToken: string,
  options: { maxResults: number },
): Promise<CalendarEventSummary[]> {
  const params = new URLSearchParams({
    maxResults: String(options.maxResults),
    singleEvents: "true",
    orderBy: "startTime",
    timeMin: new Date().toISOString(),
  });
  const result = await googleApiFetch<CalendarListResponse>(
    accessToken,
    `${BASE}?${params.toString()}`,
  );
  return (result.items ?? []).map((item) => ({
    id: item.id,
    summary: item.summary ?? "(untitled event)",
    start: item.start?.dateTime ?? item.start?.date ?? null,
    end: item.end?.dateTime ?? item.end?.date ?? null,
    location: item.location ?? null,
    htmlLink: item.htmlLink ?? null,
  }));
}

function isAllDay(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Creates a real calendar event. Callers must gate this behind explicit approval. */
export async function createEvent(
  accessToken: string,
  input: CalendarEventInput,
): Promise<CalendarEventResult> {
  const allDay = isAllDay(input.start) && isAllDay(input.end);
  const body = {
    summary: input.summary,
    description: input.description || undefined,
    location: input.location || undefined,
    start: allDay ? { date: input.start } : { dateTime: input.start },
    end: allDay ? { date: input.end } : { dateTime: input.end },
  };
  const created = await googleApiFetch<{ id: string; htmlLink?: string }>(accessToken, BASE, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { eventId: created.id, htmlLink: created.htmlLink ?? null };
}
