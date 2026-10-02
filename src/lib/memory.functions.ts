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
    const { data, error } = await context.supabase
      .from("user_memories")
      .select("id,content,source,pinned,created_at,updated_at")
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as MemoryRecord[];
  });

export const addMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ content: z.string().trim().min(1).max(1000) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<MemoryRecord> => {
    const { data: inserted, error } = await context.supabase
      .from("user_memories")
      .insert({ user_id: context.userId, content: data.content, source: "manual" })
      .select("id,content,source,pinned,created_at,updated_at")
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "Could not save that.");
    return inserted as MemoryRecord;
  });

export const togglePinMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ memoryId: z.string().uuid(), pinned: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("user_memories")
      .update({ pinned: data.pinned })
      .eq("id", data.memoryId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ memoryId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.from("user_memories").delete().eq("id", data.memoryId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const clearMemories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("user_memories")
      .delete()
      .eq("user_id", context.userId)
      .eq("pinned", false);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
