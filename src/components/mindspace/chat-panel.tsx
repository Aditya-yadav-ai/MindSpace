import { useChat } from "@ai-sdk/react";
import { useServerFn } from "@tanstack/react-start";
import { DefaultChatTransport, type UIMessage } from "ai";
import { FileText, HelpCircle, ListTree, Search, Square, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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

const QUICK_ACTIONS = [
  {
    id: "summarize",
    label: "Summarize",
    icon: FileText,
    prompt: "Summarize this page in a short brief with the key points.",
  },
  {
    id: "explain",
    label: "Explain",
    icon: HelpCircle,
    prompt: "Explain this page simply, as if I am new to the topic.",
  },
  {
    id: "extract",
    label: "Extract information",
    icon: ListTree,
    prompt:
      "Extract the key facts, names, numbers and sources from this page as a list. Only use what is in the text.",
  },
];

function messageText(message: UIMessage) {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

export function ChatPanel({ context }: { context: PageContext }) {
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

  if (!initial) return <div className="min-h-64" />;
  return <Chat initialMessages={initial} contextRef={contextRef} />;
}

function Chat({
  initialMessages,
  contextRef,
}: {
  initialMessages: UIMessage[];
  contextRef: { current: PageContext };
}) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const logTurn = useServerFn(recordChatTurn);

  // Stage 8 — best-effort durable log for the History view. Never blocks or
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

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: { ...body, messages, pageContext: pageContextPayload(contextRef.current) },
        }),
      }),
    [contextRef],
  );

  const { messages, sendMessage, status, stop, setMessages } = useChat({
    id: "mindspace-main",
    messages: initialMessages,
    transport,
    onError: (chatError) =>
      setError(
        chatError.message.includes("402")
          ? "AI credits are used up for this workspace. Top them up to keep chatting."
          : "The assistant could not answer just now. Please try again.",
      ),
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

  function send(text: string) {
    const value = text.trim();
    if (!value || busy) return;
    setError(null);
    void sendMessage({ text: value });
    setInput("");
  }

  const searchQuery =
    contextRef.current.title.trim() || contextRef.current.selection.trim().slice(0, 120);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 pb-3">
        {QUICK_ACTIONS.map(({ id, label, icon: Icon, prompt }) => (
          <Button
            key={id}
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => send(prompt)}
          >
            <Icon />
            {label}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={!searchQuery}
          onClick={() => window.open(googleSearchUrl(searchQuery), "_blank", "noopener,noreferrer")}
          title={
            searchQuery
              ? `Search Google for “${searchQuery}”`
              : "Add a page title or selection first"
          }
        >
          <Search />
          Search Google
        </Button>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-foreground/50"
            onClick={() => {
              setMessages([]);
              setError(null);
            }}
          >
            <Trash2 />
            Clear
          </Button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-lg bg-panel/70 ring-1 ring-foreground/5 backdrop-blur-md">
        <Conversation className="min-h-64 flex-1">
          <ConversationContent>
            {messages.length === 0 ? (
              <ConversationEmptyState
                title="Ask about what you are reading"
                description="Paste or connect the page, then ask for a summary, an explanation or the key facts."
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
            className="mx-3 mb-2 rounded-md bg-secondary px-3 py-2 text-xs text-secondary-foreground"
          >
            {error}
          </p>
        )}

        <div className="border-t border-foreground/5 p-3">
          <PromptInput
            onSubmit={(_message, event) => {
              event.preventDefault();
              send(input);
            }}
          >
            <PromptInputTextarea
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
    </div>
  );
}
