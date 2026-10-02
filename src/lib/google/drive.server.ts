/**
 * Stage 5 — Drive Agent's real API surface: search files the app can see
 * (read) and save a text file (consequential — gate behind explicit
 * approval). Uses the `drive.file` scope, so MindSpace only ever sees files
 * it created itself, never the user's whole Drive.
 */
import { GoogleApiError } from "./types";
import { googleApiFetch } from "./api-fetch.server";
import type { DriveFileSummary, DriveSaveInput, DriveSaveResult } from "./types";

const FILES_URL = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";

type DriveListResponse = {
  files?: {
    id: string;
    name: string;
    mimeType: string;
    modifiedTime?: string;
    webViewLink?: string;
  }[];
};

export async function searchFiles(
  accessToken: string,
  options: { query: string; limit: number },
): Promise<DriveFileSummary[]> {
  const escaped = options.query.replace(/'/g, "\\'");
  const params = new URLSearchParams({
    q: `name contains '${escaped}' and trashed = false`,
    pageSize: String(options.limit),
    fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
  });
  const result = await googleApiFetch<DriveListResponse>(
    accessToken,
    `${FILES_URL}?${params.toString()}`,
  );
  return (result.files ?? []).map((file) => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    modifiedAt: file.modifiedTime ?? null,
    webViewLink: file.webViewLink ?? null,
  }));
}

const BOUNDARY = "mindspace-stage5-boundary";

/** Saves a text file to Drive (app-scoped via drive.file). Callers must gate this behind explicit approval. */
export async function saveTextFile(
  accessToken: string,
  input: DriveSaveInput,
): Promise<DriveSaveResult> {
  const metadata = JSON.stringify({ name: input.name, mimeType: input.mimeType || "text/plain" });
  const body =
    `--${BOUNDARY}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${BOUNDARY}\r\n` +
    `Content-Type: ${input.mimeType || "text/plain"}\r\n\r\n${input.content}\r\n` +
    `--${BOUNDARY}--`;

  const response = await fetch(`${UPLOAD_URL}?uploadType=multipart&fields=id,webViewLink`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${BOUNDARY}`,
    },
    body,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new GoogleApiError(
      `Drive upload failed (${response.status}). ${detail.slice(0, 300)}`,
      response.status,
    );
  }
  const created = (await response.json()) as { id: string; webViewLink?: string };
  return { fileId: created.id, webViewLink: created.webViewLink ?? null };
}
