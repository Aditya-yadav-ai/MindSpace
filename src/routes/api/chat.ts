import { createOpenAI } from "@ai-sdk/openai";
import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

import {
  createLovableAiGatewayRunIdFetch,
  getLovableAiGatewayResponseHeaders,
  getLovableAiGatewayRunId,
  withLovableAiGatewayRunIdHeader,
} from "@/lib/ai-gateway.server";

type ChatRequestBody = {
  messages?: unknown;
  pageContext?: { title?: string; url?: string; selection?: string; text?: string } | null;
};

const SYSTEM_PROMPT = `You are MindSpace, a calm research assistant living in a browser side panel.
You help the reader understand what they are looking at: summarise, explain, extract key facts and sources, and help them write.
Be concise and concrete. Use short markdown sections or bullet lists when it helps.
Never invent page content, links, quotes or statistics. If you were not given page text, say what you can answer generally and ask the reader to paste or select the passage.
You have no ability to browse, click, open tabs or act on the user's behalf. If asked, say so plainly.`;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { messages, pageContext } = (await request.json()) as ChatRequestBody;
        if (!Array.isArray(messages)) {
          return new Response("Messages are required", { status: 400 });
        }

        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const initialRunId = getLovableAiGatewayRunId(request);
        const runIdFetch = createLovableAiGatewayRunIdFetch(initialRunId);
        const lovable = createOpenAI({
          baseURL: "https://ai.gateway.lovable.dev/v1",
          apiKey: key,
          headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
          fetch: runIdFetch.fetch,
        });

        const contextBlock = pageContext
          ? [
              "Context the reader shared from their browser:",
              pageContext.title ? `Title: ${pageContext.title}` : null,
              pageContext.url ? `URL: ${pageContext.url}` : null,
              pageContext.selection
                ? `Selected text:\n${pageContext.selection.slice(0, 6000)}`
                : null,
              pageContext.text ? `Page text:\n${pageContext.text.slice(0, 12000)}` : null,
            ]
              .filter(Boolean)
              .join("\n")
          : null;

        const result = streamText({
          model: lovable.responses("openai/gpt-6-astra"),
          system: contextBlock ? `${SYSTEM_PROMPT}\n\n${contextBlock}` : SYSTEM_PROMPT,
          messages: await convertToModelMessages(messages as UIMessage[]),
          providerOptions: {
            openai: {
              forceReasoning: true,
              reasoningEffort: "low",
              reasoningSummary: "auto",
              store: false,
              include: ["reasoning.encrypted_content"],
            },
          },
        });

        return withLovableAiGatewayRunIdHeader(
          result.toUIMessageStreamResponse({
            originalMessages: messages as UIMessage[],
            headers: getLovableAiGatewayResponseHeaders(undefined, {
              ...(initialRunId ? { "X-Lovable-AIG-Run-ID": initialRunId } : {}),
            }),
          }),
          runIdFetch,
        );
      },
    },
  },
});
