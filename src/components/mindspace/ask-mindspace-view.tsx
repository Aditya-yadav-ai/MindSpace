import { FileText, Globe2, HelpCircle, ListTree, Sparkles } from "lucide-react";
import { type RefObject } from "react";

import { ChatPanel, type ChatCommand } from "@/components/mindspace/chat-panel";
import type { PageContext } from "@/components/mindspace/page-context";
import { ViewHeader } from "@/components/mindspace/ui";

const QUICK_PROMPTS = [
  {
    label: "Summarize core findings",
    icon: Sparkles,
    text: "Provide a concise summary of this page, focusing on key takeaways and conclusions.",
  },
  {
    label: "Extract verified facts & stats",
    icon: ListTree,
    text: "Extract all specific facts, statistics, numbers, and dates mentioned in the text.",
  },
  {
    label: "Explain complex concepts",
    icon: HelpCircle,
    text: "Explain the main technical or dense concepts in plain language.",
  },
  {
    label: "Synthesize with my knowledge",
    icon: FileText,
    text: "How does the information on this page relate to broader research in this domain?",
  },
];

export function AskMindSpaceView({
  context,
  command,
  onBusyChange,
}: {
  context: PageContext;
  command?: RefObject<ChatCommand | null>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const hasPageContext = Boolean(context.text.trim() || context.selection.trim());

  function handlePromptClick(promptText: string) {
    if (command?.current) {
      command.current.send(promptText);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 pb-6">
      <ViewHeader
        eyebrow="Ask MindSpace"
        title="Context-Grounded AI Research"
        description="Ask open-ended questions against the active page context, saved research, or general knowledge."
      />

      {hasPageContext ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-primary/20 bg-primary/5 px-3.5 py-2 text-[12px] text-foreground">
          <Globe2 className="size-4 shrink-0 text-primary" />
          <span className="truncate font-medium">{context.title || "Active Page"}</span>
          <span className="text-muted-foreground truncate">({context.url})</span>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card px-3.5 py-2 text-[12px] text-muted-foreground">
          No browser context loaded. You can still ask general research questions or paste text
          below.
        </div>
      )}

      {/* Quick Prompt Pills */}
      <div className="flex flex-wrap gap-2 pt-1">
        {QUICK_PROMPTS.map((qp, i) => {
          const Icon = qp.icon;
          return (
            <button
              key={i}
              type="button"
              onClick={() => handlePromptClick(qp.text)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-accent hover:text-accent-foreground shadow-sm"
            >
              <Icon className="size-3.5 text-primary" />
              {qp.label}
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm min-h-[500px]">
        <ChatPanel context={context} command={command} onBusyChange={onBusyChange} />
      </div>
    </div>
  );
}
