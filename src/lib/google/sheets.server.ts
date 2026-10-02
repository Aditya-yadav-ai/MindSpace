/** Stage 6 — Sheets Agent's real API surface: read a value range, create a spreadsheet, append rows. */
import { googleApiFetch } from "./api-fetch.server";
import type {
  SheetAppendInput,
  SheetAppendResult,
  SheetCreateInput,
  SheetCreateResult,
  SheetRange,
} from "./types";

const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export async function readRange(
  accessToken: string,
  spreadsheetId: string,
  range: string,
): Promise<SheetRange> {
  const result = await googleApiFetch<{ range: string; values?: string[][] }>(
    accessToken,
    `${BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
  );
  return { range: result.range, values: result.values ?? [] };
}

export async function createSpreadsheet(
  accessToken: string,
  input: SheetCreateInput,
): Promise<SheetCreateResult> {
  const created = await googleApiFetch<{ spreadsheetId: string; spreadsheetUrl: string }>(
    accessToken,
    BASE,
    {
      method: "POST",
      body: JSON.stringify({ properties: { title: input.title } }),
    },
  );
  return { spreadsheetId: created.spreadsheetId, webUrl: created.spreadsheetUrl };
}

/** Appends rows to a sheet. Callers must gate this behind explicit approval. */
export async function appendValues(
  accessToken: string,
  input: SheetAppendInput,
): Promise<SheetAppendResult> {
  const url = `${BASE}/${encodeURIComponent(input.spreadsheetId)}/values/${encodeURIComponent(input.range)}:append?valueInputOption=USER_ENTERED`;
  const result = await googleApiFetch<{
    updates?: { updatedRange?: string; updatedRows?: number };
  }>(accessToken, url, {
    method: "POST",
    body: JSON.stringify({ values: input.values }),
  });
  return {
    updatedRange: result.updates?.updatedRange ?? input.range,
    updatedRows: result.updates?.updatedRows ?? 0,
  };
}
