import { createOpenAI } from "@ai-sdk/openai";
import { createServerFn } from "@tanstack/react-start";
import { streamText } from "ai";
import { z } from "zod";

import { createLovableAiGatewayRunIdFetch } from "./ai-gateway.server";

const WritingInput = z.object({
  instruction: z.string().min(1).max(4000),
  draft: z.string().max(12000).default(""),
  tone: z.enum(["neutral", "friendly", "formal", "concise"]).default("neutral"),
  kind: z.enum(["draft", "rewrite", "shorten", "expand"]).default("draft"),
});

export type WritingRequest = z.infer<typeof WritingInput>;

export const generateWriting = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => WritingInput.parse(input))
  .handler(async ({ data }) => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI writing is unavailable: the AI key is not configured.");

    const runIdFetch = createLovableAiGatewayRunIdFetch();
    const lovable = createOpenAI({
      baseURL: "https://ai.gateway.lovable.dev/v1",
      apiKey: key,
      headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
      fetch: runIdFetch.fetch,
    });

    const task = {
      draft: "Write a new piece of text from the instruction.",
      rewrite: "Rewrite the existing text so it reads better, keeping its meaning and facts.",
      shorten: "Make the existing text noticeably shorter while keeping every important point.",
      expand: "Develop the existing text with more detail, without inventing facts.",
    }[data.kind];

    const result = streamText({
      model: lovable.responses("openai/gpt-6-astra"),
      system: `You are MindSpace's writing assistant. ${task}
Match a ${data.tone} tone. Return only the finished text in markdown, with no preamble, no commentary and no explanation of your choices.
Never invent facts, names, numbers, quotes or links that are not in the material you were given.`,
      prompt: [
        `Instruction: ${data.instruction}`,
        data.draft.trim() ? `Existing text:\n${data.draft}` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
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

    const text = await result.text;
    return { text: text.trim() };
  });
