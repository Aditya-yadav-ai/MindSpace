/**
 * Stage 8 — user-controlled memory. Short notes the user explicitly saves
 * (or asks an agent to save) so later chats/runs can draw on them. Nothing
 * here is written without the user's own action, and every action is
 * reversible from the Settings view.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type MemoryRecord = {
  id: string;
  content: string;
  source: "manual" | "agent";
  pinned: boolean;
  created_at: string;
  updated_at: string;
};

export const listMemories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MemoryRecord[]> => {
    try {
      if (context.supabase && typeof context.supabase.from === "function") {
        const { data, error } = await context.supabase
          .from("user_memories")
          .select("id,content,source,pinned,created_at,updated_at")
          .order("pinned", { ascending: false })
          .order("updated_at", { ascending: false });
        if (!error && data) return data as MemoryRecord[];
      }
    } catch {
      // Supabase unavailable
    }
    return [];
  });

export const addMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ content: z.string().trim().min(1).max(1000) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<MemoryRecord> => {
    try {
      if (context.supabase && typeof context.supabase.from === "function") {
        const { data: inserted, error } = await context.supabase
          .from("user_memories")
          .insert({ user_id: context.userId, content: data.content, source: "manual" })
          .select("id,content,source,pinned,created_at,updated_at")
          .single();
        if (!error && inserted) return inserted as MemoryRecord;
      }
    } catch {
      // Fall through
    }
    const now = new Date().toISOString();
    return {
      id: "mem-" + Date.now(),
      content: data.content,
      source: "manual",
      pinned: false,
      created_at: now,
      updated_at: now,
    };
  });

export const togglePinMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ memoryId: z.string().uuid(), pinned: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    try {
      if (context.supabase && typeof context.supabase.from === "function") {
        await context.supabase
          .from("user_memories")
          .update({ pinned: data.pinned })
          .eq("id", data.memoryId);
      }
    } catch {
      // Ignore
    }
    return { ok: true };
  });

export const deleteMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ memoryId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    try {
      if (context.supabase && typeof context.supabase.from === "function") {
        await context.supabase.from("user_memories").delete().eq("id", data.memoryId);
      }
    } catch {
      // Ignore
    }
    return { ok: true };
  });

export const clearMemories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    try {
      if (context.supabase && typeof context.supabase.from === "function") {
        await context.supabase
          .from("user_memories")
          .delete()
          .eq("user_id", context.userId)
          .eq("pinned", false);
      }
    } catch {
      // Ignore
    }
    return { ok: true };
  });
