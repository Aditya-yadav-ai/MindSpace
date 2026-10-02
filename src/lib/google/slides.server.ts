/** Stage 6 — Slides Agent's real API surface: read a deck's outline, create a new (blank) deck. */
import { googleApiFetch } from "./api-fetch.server";
import type { SlidesCreateInput, SlidesCreateResult, SlidesSummary } from "./types";

const BASE = "https://slides.googleapis.com/v1/presentations";

export async function readPresentation(
  accessToken: string,
  presentationId: string,
): Promise<SlidesSummary> {
  const deck = await googleApiFetch<{ presentationId: string; title: string; slides?: unknown[] }>(
    accessToken,
    `${BASE}/${encodeURIComponent(presentationId)}`,
  );
  return {
    presentationId: deck.presentationId,
    title: deck.title,
    slideCount: deck.slides?.length ?? 0,
    webUrl: `https://docs.google.com/presentation/d/${deck.presentationId}/edit`,
  };
}

/** Creates a real (blank, title-slide-only) Google Slides deck. Callers must gate this behind explicit approval. */
export async function createPresentation(
  accessToken: string,
  input: SlidesCreateInput,
): Promise<SlidesCreateResult> {
  const created = await googleApiFetch<{ presentationId: string }>(accessToken, BASE, {
    method: "POST",
    body: JSON.stringify({ title: input.title }),
  });
  return {
    presentationId: created.presentationId,
    webUrl: `https://docs.google.com/presentation/d/${created.presentationId}/edit`,
  };
}
