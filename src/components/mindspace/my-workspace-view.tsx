import * as React from "react";
import { BookOpen, Bookmark, FileText, PenLine, Search, Sparkles } from "lucide-react";
import { AskMindSpaceView } from "@/components/mindspace/ask-mindspace-view";
import { CollectionsView } from "@/components/mindspace/collections-view";
import { KnowledgeBase } from "@/components/mindspace/knowledge-base";
import type { PageContext, SavedPageRecord } from "@/components/mindspace/page-context";
import { WritingStudio } from "@/components/mindspace/writing-studio";
import { Button3D } from "@/components/ui/button-3d";
import { Card3D } from "@/components/ui/card-3d";

export function MyWorkspaceView({
  context,
  signedIn,
  savedItems,
  savedHydrated,
  onRemoveSaved,
}: {
  context: PageContext;
  signedIn: boolean;
  savedItems: SavedPageRecord[];
  savedHydrated: boolean;
  onRemoveSaved: (url: string) => void;
}) {
  const [activeTab, setActiveTab] = React.useState<"knowledge" | "writing" | "ask" | "collections">(
    "knowledge",
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Workspace Hub Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <BookOpen className="size-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">My Workspace</h1>
            <p className="text-xs text-muted-foreground">
              Personal research hub, RAG semantic search, writing studio, and collections
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1 rounded-xl border border-border/80 bg-muted/30 p-1">
          <Button3D
            variant={activeTab === "knowledge" ? "primary" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("knowledge")}
            className="text-xs gap-1.5 h-8"
          >
            <Search className="size-3.5" />
            <span>Knowledge Base</span>
          </Button3D>

          <Button3D
            variant={activeTab === "writing" ? "primary" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("writing")}
            className="text-xs gap-1.5 h-8"
          >
            <PenLine className="size-3.5" />
            <span>Writing Studio</span>
          </Button3D>

          <Button3D
            variant={activeTab === "ask" ? "primary" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("ask")}
            className="text-xs gap-1.5 h-8"
          >
            <Sparkles className="size-3.5" />
            <span>Ask AI</span>
          </Button3D>

          <Button3D
            variant={activeTab === "collections" ? "primary" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("collections")}
            className="text-xs gap-1.5 h-8"
          >
            <Bookmark className="size-3.5" />
            <span>Collections</span>
          </Button3D>
        </div>
      </div>

      {/* Tab Panels */}
      <div>
        {activeTab === "knowledge" && <KnowledgeBase signedIn={signedIn} />}
        {activeTab === "writing" && (
          <WritingStudio seedText={context.selection || context.text || ""} />
        )}
        {activeTab === "ask" && <AskMindSpaceView context={context} />}
        {activeTab === "collections" && (
          <CollectionsView items={savedItems} hydrated={savedHydrated} onRemove={onRemoveSaved} />
        )}
      </div>
    </div>
  );
}
