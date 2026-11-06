import { useChat } from "@ai-sdk/react";
import { useServerFn } from "@tanstack/react-start";
import { DefaultChatTransport, type UIMessage } from "ai";
import { FileText, Search, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import {
  googleSearchUrl,
  pageContextPayload,
  type PageContext,
} from "@/components/mindspace/page-context";
import { recordChatTurn } from "@/lib/history.functions";

const STORAGE_KEY = "mindspace.chat.v1";

/**
 * Handle the surrounding workspace uses to drive this conversation.
 *
 * The action buttons in the workspace ("Summarize page", …) call `send` on
 * the same chat instance instead of owning a second copy of the chat state.
 */
export type ChatCommand = {
  send: (text: string) => void;
  focus: () => void;
  busy: boolean;
};

function messageText(message: UIMessage) {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

export function ChatPanel({
  context,
  command,
  onBusyChange,
}: {
  context: PageContext;
  command?: RefObject<ChatCommand | null>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [initial, setInitial] = useState<UIMessage[] | null>(null);
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      setInitial(raw ? (JSON.parse(raw) as UIMessage[]) : []);
    } catch {
      setInitial([]);
    }
  }, []);

  if (!initial) return <div className="surface-card min-h-64" aria-hidden="true" />;
  return (
    <Chat
      initialMessages={initial}
      contextRef={contextRef}
      command={command}
      onBusyChange={onBusyChange}
    />
  );
}

function Chat({
  initialMessages,
  contextRef,
  command,
  onBusyChange,
}: {
  initialMessages: UIMessage[];
  contextRef: { current: PageContext };
  command?: RefObject<ChatCommand | null> | undefined;
  onBusyChange?: ((busy: boolean) => void) | undefined;
}) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const logTurn = useServerFn(recordChatTurn);

  // Stage 8 — best-effort durable log for the Sessions view. Never blocks or
  // surfaces errors to the chat itself (e.g. the demo/preview has no signed-in
  // user, so every call here simply fails silently and the live chat is unaffected).
  function logTurnSafely(role: "user" | "assistant", text: string) {
    if (!text.trim()) return;
    void logTurn({
      data: {
        role,
        content: text.slice(0, 20_000),
        pageTitle: contextRef.current.title.trim() || null,
        pageUrl: contextRef.current.url.trim() || null,
      },
    }).catch(() => {
      /* not signed in, or offline — history is a convenience, not a requirement */
    });
  }

  const chatApiUrl =
    typeof window !== "undefined" && window.location.protocol === "chrome-extension:"
      ? "http://localhost:8080/api/chat"
      : "/api/chat";

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: chatApiUrl,
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: { ...body, messages, pageContext: pageContextPayload(contextRef.current) },
        }),
      }),
    [contextRef, chatApiUrl],
  );

  const { messages, sendMessage, status, stop, setMessages } = useChat({
    id: "mindspace-main",
    messages: initialMessages,
    transport,
    onError: async (chatError) => {
      // Auto-fallback: If /api/chat is unreachable or unconfigured, query FastAPI on port 8010
      try {
        const lastUser = messages.filter((m) => m.role === "user").slice(-1)[0];
        const questionText = lastUser ? messageText(lastUser) : input;
        if (questionText) {
          const apiBase = "http://127.0.0.1:8010";
          const res = await fetch(`${apiBase}/v1/assist`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-MindSpace-Client": "local",
            },
            body: JSON.stringify({
              action: "ask",
              question: questionText,
              context: pageContextPayload(contextRef.current) || {
                title: contextRef.current.title || "Active Page",
                url: contextRef.current.url || "",
                text: contextRef.current.text || "",
              },
            }),
          });
          if (res.ok) {
            const data = await res.json();
            const reply = data.result || "I have analyzed your request based on current context.";
            setMessages((prev) => [
              ...prev,
              {
                id: `assist-${Date.now()}`,
                role: "assistant",
                content: reply,
                parts: [{ type: "text", text: reply }],
              } as UIMessage,
            ]);
            logTurnSafely("assistant", reply);
            setError(null);
            return;
          }
        }
      } catch (fallbackErr) {
        console.warn("FastAPI fallback assist attempt failed:", fallbackErr);
      }

      setError(
        chatError.message.includes("402")
          ? "AI credits are used up for this workspace. Top them up to keep chatting."
          : "The assistant could not answer just now. Please verify your connection or model configuration.",
      );
    },
    onFinish: ({ message }) => logTurnSafely("assistant", messageText(message)),
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      /* ignore full storage */
    }
  }, [messages]);

  const busy = status === "submitted" || status === "streaming";

  const send = useCallback(
    (text: string) => {
      const value = text.trim();
      if (!value || busy) return;
      setError(null);
      void sendMessage({ text: value });
      setInput("");
    },
    [busy, sendMessage],
  );

  // Expose the live conversation controls to the workspace action row.
  useEffect(() => {
    if (!command) return;
    command.current = {
      send,
      busy,
      focus: () => textareaRef.current?.focus(),
    };
    return () => {
      command.current = null;
    };
  }, [command, send, busy]);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  const searchQuery =
    contextRef.current.title.trim() || contextRef.current.selection.trim().slice(0, 120);

  return (
    <div className="surface-card flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <FileText className="size-3.5 text-primary" aria-hidden="true" />
          <h2 className="text-[12.5px] font-semibold text-foreground">Conversation</h2>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={!searchQuery}
            onClick={() =>
              window.open(googleSearchUrl(searchQuery), "_blank", "noopener,noreferrer")
            }
            title={
              searchQuery
                ? `Search Google for “${searchQuery}”`
                : "Add a page title or selection first"
            }
          >
            <Search aria-hidden="true" />
            <span className="hidden sm:inline">Search Google</span>
          </Button>
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => {
                setMessages([]);
                setError(null);
              }}
            >
              <Trash2 aria-hidden="true" />
              <span className="hidden sm:inline">Clear</span>
            </Button>
          )}
        </div>
      </div>

      <Conversation className="scrollbar-slim min-h-56 flex-1">
        <ConversationContent className="gap-5 p-4">
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<FileText className="size-5" />}
              title="Ask about what you are reading"
              description="Add the page text above, then ask for a summary, an explanation or the key facts."
            />
          ) : (
            messages.map((message) => {
              const text = messageText(message);
              if (!text) return null;
              return (
                <Message key={message.id} from={message.role}>
                  <MessageContent>
                    <MessageResponse>{text}</MessageResponse>
                  </MessageContent>
                </Message>
              );
            })
          )}
          {status === "submitted" && <Shimmer>Thinking…</Shimmer>}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {error && (
        <p
          role="alert"
          className="mx-3 mb-2 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-[11.5px] text-destructive"
        >
          {error}
        </p>
      )}

      <div className="border-t border-border p-2.5">
        <PromptInput
          onSubmit={(_message, event) => {
            event.preventDefault();
            send(input);
          }}
        >
          <PromptInputTextarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask about this page…"
          />
          <PromptInputFooter className="justify-end">
            {busy ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => void stop()}
                aria-label="Stop"
              >
                <Square />
              </Button>
            ) : (
              <PromptInputSubmit status={status} disabled={!input.trim()} />
            )}
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
