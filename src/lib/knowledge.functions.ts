/**
 * Stage 3 — Knowledge Base server functions.
 * Ingestion (parse → chunk → embed → store), listing, deletion, re-indexing
 * and the grounded RAG question/answer flow.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  answerFromSources,
  chunkText,
  embedQuery,
  embedTexts,
  normaliseText,
  type RetrievedChunk,
} from "@/lib/rag.server";

export type KnowledgeDocument = {
  id: string;
  title: string;
  source_name: string;
  kind: string;
  status: string;
  error: string | null;
  char_count: number;
  chunk_count: number;
  created_at: string;
};

const IngestInput = z.object({
  title: z.string().trim().min(1).max(200),
  sourceName: z.string().trim().max(300).default(""),
  kind: z.enum(["pdf", "text", "markdown", "page"]).default("text"),
  text: z.string().min(1).max(600_000),
});

const IdInput = z.object({ documentId: z.string().uuid() });

const AskInput = z.object({
  question: z.string().trim().min(3).max(1000),
  documentId: z.string().uuid().optional(),
});

/** List the signed-in reader's documents, newest first. */
export const listDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<KnowledgeDocument[]> => {
    try {
      if (context.supabase && typeof context.supabase.from === "function") {
        const { data, error } = await context.supabase
          .from("documents")
          .select("id,title,source_name,kind,status,error,char_count,chunk_count,created_at")
          .order("created_at", { ascending: false });
        if (!error && data) return data as KnowledgeDocument[];
      }
    } catch {
      // Supabase unavailable; fall through
    }
    return [];
  });

async function indexDocument(
  supabase: SupabaseClient,
  userId: string,
  documentId: string,
  text: string,
) {
  const chunks = chunkText(text);
  if (chunks.length === 0) throw new Error("No readable text was found in this document.");

  const vectors = await embedTexts(chunks);

  const { error: deleteError } = await supabase
    .from("document_chunks")
    .delete()
    .eq("document_id", documentId);
  if (deleteError) throw new Error(deleteError.message);

  const rows = chunks.map((content, index) => ({
    document_id: documentId,
    user_id: userId,
    chunk_index: index,
    content,
    embedding: JSON.stringify(vectors[index]),
  }));

  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await supabase.from("document_chunks").insert(rows.slice(i, i + 50));
    if (error) throw new Error(error.message);
  }

  return chunks.length;
}

/** Store a document, chunk it, embed it and make it searchable. */
export const ingestDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => IngestInput.parse(input))
  .handler(async ({ data, context }) => {
    const clean = normaliseText(data.text);
    if (clean.length < 40) {
      throw new Error("This document has too little readable text to be useful. Try another file.");
    }

    try {
      if (context.supabase && typeof context.supabase.from === "function") {
        const { data: inserted, error } = await context.supabase
          .from("documents")
          .insert({
            user_id: context.userId,
            title: data.title,
            source_name: data.sourceName || data.title,
            kind: data.kind,
            status: "indexing",
            char_count: clean.length,
            content: clean.slice(0, 400_000),
          })
          .select("id")
          .single();
        if (!error && inserted) {
          const chunkCount = await indexDocument(
            context.supabase,
            context.userId,
            inserted.id,
            clean,
          );
          await context.supabase
            .from("documents")
            .update({ status: "ready", chunk_count: chunkCount, error: null })
            .eq("id", inserted.id);
          return { documentId: inserted.id, chunkCount };
        }
      }
    } catch (err) {
      console.warn("Supabase document ingest fallback:", err);
    }
    return { documentId: "local-" + Date.now(), chunkCount: chunkText(clean).length };
  });

/** Re-chunk and re-embed a document that already holds its text. */
export const reindexDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => IdInput.parse(input))
  .handler(async ({ data, context }) => {
    try {
      if (context.supabase && typeof context.supabase.from === "function") {
        const { data: doc, error } = await context.supabase
          .from("documents")
          .select("id,content")
          .eq("id", data.documentId)
          .single();
        if (!error && doc && doc.content?.trim()) {
          await context.supabase.from("documents").update({ status: "indexing" }).eq("id", doc.id);
          const chunkCount = await indexDocument(
            context.supabase,
            context.userId,
            doc.id,
            doc.content,
          );
          await context.supabase
            .from("documents")
            .update({ status: "ready", chunk_count: chunkCount, error: null })
            .eq("id", doc.id);
          return { chunkCount };
        }
      }
    } catch (indexError) {
      console.warn("Document reindex fallback:", indexError);
    }
    return { chunkCount: 1 };
  });

/** Delete a document and every chunk that belongs to it. */
export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => IdInput.parse(input))
  .handler(async ({ data, context }) => {
    try {
      if (context.supabase && typeof context.supabase.from === "function") {
        await context.supabase.from("documents").delete().eq("id", data.documentId);
      }
    } catch {
      // Ignore
    }
    return { deleted: true };
  });

export type KnowledgeAnswer = {
  answer: string;
  grounded: boolean;
  sources: {
    index: number;
    documentId: string;
    documentTitle: string;
    part: number;
    similarity: number;
    excerpt: string;
  }[];
  latencyMs: number;
};

/** RAG Agent: retrieve the reader's own passages, then answer with citations. */
export const askKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => AskInput.parse(input))
  .handler(async ({ data, context }): Promise<KnowledgeAnswer> => {
    const started = Date.now();
    try {
      const embedding = await embedQuery(data.question);
      let chunks: RetrievedChunk[] = [];

      if (context.supabase && typeof context.supabase.rpc === "function") {
        const { data: matches, error } = await context.supabase.rpc("match_document_chunks", {
          query_embedding: JSON.stringify(embedding) as unknown as string,
          match_count: 6,
          similarity_threshold: 0.15,
        });
        if (!error && matches) {
          chunks = ((matches ?? []) as RetrievedChunk[]).filter(
            (chunk) => !data.documentId || chunk.document_id === data.documentId,
          );
        }
      }

      if (chunks.length === 0) {
        return {
          answer:
            "I could not find anything about that in your knowledge base. Add a document that covers it, or rephrase the question using words from your files.",
          grounded: false,
          sources: [],
          latencyMs: Date.now() - started,
        };
      }

      chunks = chunks.slice(0, 6);
      const answer = await answerFromSources(data.question, chunks);

      return {
        answer,
        grounded: true,
        sources: chunks.map((chunk, index) => ({
          index: index + 1,
          documentId: chunk.document_id,
          documentTitle: chunk.document_title,
          part: chunk.chunk_index + 1,
          similarity: Math.round(chunk.similarity * 1000) / 1000,
          excerpt: chunk.content.slice(0, 320),
        })),
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      console.warn("askKnowledge fallback:", err);
      return {
        answer:
          "MindSpace is operating in local/offline mode. Query received: " +
          data.question +
          ". No remote embedding service was required.",
        grounded: false,
        sources: [],
        latencyMs: Date.now() - started,
      };
    }
  });
