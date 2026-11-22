/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MindSpace Stage 8 — Browser / Extension Client RAG Shim.
 * Implements client-side text chunking, local vector representations, and grounded
 * offline answering without throwing fatal "AI service not configured" errors.
 */

export const EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

export type RetrievedChunk = {
  chunk_id: string;
  document_id: string;
  document_title: string;
  chunk_index: number;
  content: string;
  similarity: number;
};

/** Normalise raw extracted text: collapse whitespace, drop control characters. */
export function normaliseText(raw: string): string {
  if (!raw) return "";
  return (
    raw
      .replace(/\r\n?/g, "\n")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Split text into overlapping chunks on sentence/paragraph boundaries.
 */
export function chunkText(text: string, size = 1400, overlap = 200): string[] {
  const clean = normaliseText(text);
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const chunks: string[] = [];
  let start = 0;

  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);

    if (end < clean.length) {
      const window = clean.slice(start, end);
      const breakPoint = Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf("? "),
        window.lastIndexOf("! "),
        window.lastIndexOf("\n"),
      );
      if (breakPoint > size * 0.5) end = start + breakPoint + 1;
    }

    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

/** Deterministic pseudo-embedding for local in-browser search (1536 floats) */
function computeLocalVector(text: string): number[] {
  const vec = new Float64Array(EMBEDDING_DIMENSIONS);
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    let hash = 0;
    for (let c = 0; c < word.length; c++) {
      hash = (hash << 5) - hash + word.charCodeAt(c);
      hash |= 0;
    }
    const idx = Math.abs(hash) % EMBEDDING_DIMENSIONS;
    vec[idx] = (vec[idx] || 0) + 1;
  }
  // Normalize
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += (vec[i] || 0) * (vec[i] || 0);
  norm = Math.sqrt(norm) || 1;
  const result: number[] = new Array(EMBEDDING_DIMENSIONS);
  for (let i = 0; i < vec.length; i++) result[i] = (vec[i] || 0) / norm;
  return result;
}

export async function embedTexts(inputs: string[]): Promise<number[][]> {
  return inputs.map(computeLocalVector);
}

export async function embedQuery(text: string): Promise<number[]> {
  return computeLocalVector(text);
}

/** Ask answering model to write a grounded answer over retrieved chunks. */
export async function answerFromSources(
  question: string,
  chunks: RetrievedChunk[],
): Promise<string> {
  if (!chunks || chunks.length === 0) {
    return "No matching source documents were found to answer this question.";
  }

  // 1. Try local FastAPI agent service on 8010 if running
  try {
    const apiBase = "http://127.0.0.1:8010";
    const contextText = chunks.map((c) => `[${c.document_title}]: ${c.content}`).join("\n\n");
    const resp = await fetch(`${apiBase}/v1/assist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "ask",
        question,
        context: {
          title: chunks[0]?.document_title || "Retrieved Sources",
          url: "local://knowledge",
          text: contextText,
        },
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (resp.ok) {
      const data = (await resp.json()) as any;
      if (data?.result) return data.result;
    }
  } catch {
    // Backend offline / unreachable, fall through to client synthesis
  }

  // 2. Client-side grounded synthesis over sources (transparent offline mode)
  const sourceCitations = chunks
    .slice(0, 3)
    .map(
      (c, i) =>
        `[${i + 1}] ${c.document_title} (part ${c.chunk_index + 1}):\n"${c.content.slice(0, 240)}..."`,
    )
    .join("\n\n");

  return `[MindSpace Local Grounded Search]\n\nBased on your indexed documents, here are the most relevant findings for "${question}":\n\n${sourceCitations}`;
}
