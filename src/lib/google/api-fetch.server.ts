/** Stage 5 — small shared fetch wrapper for Google's JSON APIs. */
import { GoogleApiError } from "./types";

export async function googleApiFetch<T>(
  accessToken: string,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new GoogleApiError(
      `Google API request failed (${response.status}). ${detail.slice(0, 300)}`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
