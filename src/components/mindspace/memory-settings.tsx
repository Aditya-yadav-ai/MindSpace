/**
 * Stage 8 — user-controlled memory, surfaced in Settings alongside
 * connected-services controls (the master prompt groups "user controls for
 * memory and connected services" together). Every memory here was either
 * typed by the user or saved by an agent only after explicit action — this
 * panel is how they review or remove any of it.
 */
import { useServerFn } from "@tanstack/react-start";
import { LoaderCircle, Pin, Plus, Trash2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  addMemory,
  clearMemories,
  deleteMemory,
  listMemories,
  togglePinMemory,
  type MemoryRecord,
} from "@/lib/memory.functions";
import { cn } from "@/lib/utils";

export function MemorySettings({ signedIn }: { signedIn: boolean }) {
  const load = useServerFn(listMemories);
  const create = useServerFn(addMemory);
  const pin = useServerFn(togglePinMemory);
  const remove = useServerFn(deleteMemory);
  const clearAll = useServerFn(clearMemories);

  const [items, setItems] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(signedIn);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await load({}));
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    if (signedIn) void refresh();
  }, [signedIn, refresh]);

  if (!signedIn) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    setBusy("create");
    try {
      await create({ data: { content: text.trim() } });
      setText("");
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function togglePin(item: MemoryRecord) {
    setBusy(item.id);
    try {
      await pin({ data: { memoryId: item.id, pinned: !item.pinned } });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove_(item: MemoryRecord) {
    setBusy(item.id);
    try {
      await remove({ data: { memoryId: item.id } });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function clearUnpinned() {
    setBusy("clear");
    try {
      await clearAll({});
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-6 rounded-lg bg-panel/70 p-5 ring-1 ring-foreground/5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Memory</p>
          <p className="mt-1 text-xs text-foreground/45">
            Notes you've saved for MindSpace to draw on later.
          </p>
        </div>
        {items.some((item) => !item.pinned) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void clearUnpinned()}
            disabled={busy === "clear"}
          >
            {busy === "clear" ? <LoaderCircle className="animate-spin" /> : null}
            Clear unpinned
          </Button>
        )}
      </div>

      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Add something to remember…"
          className="h-9 flex-1 rounded-md border border-input bg-background/70 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
        <Button type="submit" size="sm" disabled={busy === "create" || !text.trim()}>
          {busy === "create" ? <LoaderCircle className="animate-spin" /> : <Plus />}
        </Button>
      </form>

      <div className="mt-3 space-y-1.5">
        {loading ? (
          <LoaderCircle className="size-3.5 animate-spin text-foreground/40" />
        ) : items.length === 0 ? (
          <p className="text-xs text-foreground/40">Nothing saved yet.</p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-2 rounded-md bg-background/50 p-2.5 text-xs ring-1 ring-foreground/5"
            >
              <p className="min-w-0 flex-1 leading-5 text-foreground/75">{item.content}</p>
              <button
                onClick={() => void togglePin(item)}
                disabled={busy === item.id}
                aria-label={item.pinned ? "Unpin" : "Pin"}
                className={cn(
                  "shrink-0",
                  item.pinned ? "text-primary" : "text-foreground/25 hover:text-foreground/60",
                )}
              >
                <Pin className="size-3.5" fill={item.pinned ? "currentColor" : "none"} />
              </button>
              <button
                onClick={() => void remove_(item)}
                disabled={busy === item.id}
                aria-label="Delete memory"
                className="shrink-0 text-foreground/25 hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
