import {
  Bookmark,
  ExternalLink,
  FileSearch,
  FileText,
  Image,
  Layers,
  LoaderCircle,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { SavedPageRecord } from "@/components/mindspace/page-context";
import { ViewHeader } from "@/components/mindspace/ui";
import { Button } from "@/components/ui/button";

export type ContentCategory = "all" | "webpage" | "screenshot" | "pdf" | "note" | "research";

export interface CustomItem {
  id: string;
  type: "screenshot" | "pdf" | "note" | "research";
  title: string;
  source: string;
  snippet: string;
  date: string;
}

const DEFAULT_SAMPLE_ITEMS: CustomItem[] = [
  {
    id: "sample-note-1",
    type: "note",
    title: "Key Insights on Multi-Agent Orchestration",
    source: "Personal Note",
    snippet:
      "Blackboard architecture centralizes intermediate findings and provides high context consistency across specialized agents.",
    date: new Date(Date.now() - 3600000 * 2).toISOString(),
  },
  {
    id: "sample-pdf-1",
    type: "pdf",
    title: "Model Context Protocol Specification v1.0",
    source: "mcp-spec.pdf",
    snippet:
      "A standardized client-server protocol enabling LLMs to safely discover and call local tools with structured arguments.",
    date: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: "sample-shot-1",
    type: "screenshot",
    title: "Agent Verification Heatmap Capture",
    source: "Browser Side Panel Capture",
    snippet:
      "Execution latency and tool calls across Sequential, Parallel, and Hierarchical agent runs.",
    date: new Date(Date.now() - 86400000 * 2).toISOString(),
  },
];

export function CollectionsView({
  items,
  hydrated,
  onRemove,
  onUseAsContext,
}: {
  items: SavedPageRecord[];
  hydrated: boolean;
  onRemove: (id: string) => void;
  onUseAsContext?: (text: string, title: string, url: string) => void;
}) {
  const [filter, setFilter] = useState<ContentCategory>("all");
  const [query, setQuery] = useState("");
  const [customItems, setCustomItems] = useState<CustomItem[]>(DEFAULT_SAMPLE_ITEMS);
  const [showAddNote, setShowAddNote] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [newNoteBody, setNewNoteBody] = useState("");

  const allItems = useMemo(() => {
    const pageItems = items.map((p) => ({
      id: p.id,
      type: "webpage" as const,
      title: p.title,
      source: p.domain || "Webpage",
      url: p.url,
      snippet: `${p.wordCount.toLocaleString()} words saved from ${p.domain || "active browser tab"}`,
      date: p.savedAt,
      wordCount: p.wordCount,
    }));

    return [...pageItems, ...customItems];
  }, [items, customItems]);

  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      const matchesFilter = filter === "all" || item.type === filter;
      const q = query.toLowerCase().trim();
      const matchesQuery =
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.source.toLowerCase().includes(q) ||
        item.snippet.toLowerCase().includes(q);
      return matchesFilter && matchesQuery;
    });
  }, [allItems, filter, query]);

  function handleCreateNote(e: React.FormEvent) {
    e.preventDefault();
    if (!newNoteTitle.trim() || !newNoteBody.trim()) return;

    const note: CustomItem = {
      id: `note-${Date.now()}`,
      type: "note",
      title: newNoteTitle.trim(),
      source: "Manual Note",
      snippet: newNoteBody.trim(),
      date: new Date().toISOString(),
    };

    setCustomItems((prev) => [note, ...prev]);
    setNewNoteTitle("");
    setNewNoteBody("");
    setShowAddNote(false);
  }

  function handleRemoveItem(id: string, type: string) {
    if (type === "webpage") {
      onRemove(id);
    } else {
      setCustomItems((prev) => prev.filter((item) => item.id !== id));
    }
  }

  const badgeConfig = {
    webpage: { label: "Webpage", icon: Bookmark, className: "bg-primary/10 text-primary" },
    screenshot: {
      label: "Screenshot",
      icon: Image,
      className: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    },
    pdf: {
      label: "PDF Document",
      icon: FileSearch,
      className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    },
    note: {
      label: "Note",
      icon: FileText,
      className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    },
    research: {
      label: "Research",
      icon: Layers,
      className: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
    },
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ViewHeader
          eyebrow="Collections"
          title="Personal Knowledge & Captures"
          description="Browse and search your saved webpages, research notes, screenshots, and PDFs."
        />
        <Button size="sm" onClick={() => setShowAddNote((prev) => !prev)}>
          <Plus className="size-4 mr-1" />
          Add Note
        </Button>
      </div>

      {showAddNote && (
        <form
          onSubmit={handleCreateNote}
          className="rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-sm space-y-3"
        >
          <h3 className="text-sm font-semibold text-foreground">Create a Quick Note</h3>
          <input
            type="text"
            required
            value={newNoteTitle}
            onChange={(e) => setNewNoteTitle(e.target.value)}
            placeholder="Note title (e.g., Ideas for Research Paper)"
            className="w-full h-9 rounded-lg border border-input bg-background px-3 text-[13px] outline-none focus:border-primary"
          />
          <textarea
            required
            rows={3}
            value={newNoteBody}
            onChange={(e) => setNewNoteBody(e.target.value)}
            placeholder="Write key facts, ideas, or observations..."
            className="w-full rounded-lg border border-input bg-background p-3 text-[13px] outline-none focus:border-primary resize-y"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowAddNote(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Save Note
            </Button>
          </div>
        </form>
      )}

      {/* OnePlus Mind Space Filter Tabs & Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: "all", label: "All Items" },
              { id: "webpage", label: "Webpages" },
              { id: "note", label: "Notes" },
              { id: "pdf", label: "PDFs" },
              { id: "screenshot", label: "Screenshots" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`rounded-full px-3.5 py-1 text-[12px] font-medium transition-colors ${
                filter === tab.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search collections..."
            className="h-8 w-full rounded-full border border-border bg-background pl-8 pr-3 text-[12px] outline-none focus:border-primary"
          />
        </div>
      </div>

      {!hydrated ? (
        <p className="flex items-center gap-2 text-[12px] text-muted-foreground py-8">
          <LoaderCircle className="size-4 animate-spin text-primary" />
          Loading collections...
        </p>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
          <Bookmark className="mx-auto size-8 text-muted-foreground/60" />
          <p className="mt-3 text-sm font-medium text-foreground">No items in this collection</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {query
              ? "Try adjusting your search query."
              : "Save pages or add notes to see them here."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filteredItems.map((item) => {
            const badge = badgeConfig[item.type as keyof typeof badgeConfig] || badgeConfig.webpage;
            const Icon = badge.icon;
            return (
              <div
                key={item.id}
                className="group relative flex flex-col justify-between rounded-2xl border border-border bg-card p-4 transition-all duration-200 hover:border-primary/40 hover:shadow-md"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold tracking-wide ${badge.className}`}
                    >
                      <Icon className="size-3" />
                      {badge.label}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {new Date(item.date).toLocaleDateString()}
                    </span>
                  </div>

                  <h4 className="mt-2 text-[13.5px] font-semibold leading-snug text-foreground line-clamp-1">
                    {item.title}
                  </h4>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground line-clamp-2">
                    {item.snippet}
                  </p>
                </div>

                <div className="mt-3 flex items-center justify-between pt-2 border-t border-border/60">
                  <span className="truncate font-mono text-[10.5px] text-muted-foreground max-w-[180px]">
                    {item.source}
                  </span>
                  <div className="flex items-center gap-1">
                    {"url" in item && item.url ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Open ${item.title}`}
                        onClick={() => window.open(item.url, "_blank", "noopener,noreferrer")}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="size-3.5" />
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${item.title}`}
                      onClick={() => handleRemoveItem(item.id, item.type)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
