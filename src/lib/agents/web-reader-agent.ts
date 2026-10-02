/**
 * Stage 7 — Web Reader Agent. A single-purpose wrapper around
 * `web.fetch_page`, kept separate from the ReAct Research Agent so a
 * deterministic multi-step plan (see `planner.ts`'s "webflow" intent) can
 * reference `s1.page.title` / `s1.page.text` directly with a plain `$ref`,
 * instead of reaching into the Research Agent's free-form ReAct trace.
 */
import { z } from "zod";

import { BaseAgent, type AgentContext, type AgentOutput, type AgentTools } from "./agent";
import { clip } from "./text-utils";
import type { FetchedPage } from "./web-tools";
import type { TaskPayload } from "./types";

const WebReaderInput = z.object({ url: z.string().trim().url() });

export class WebReaderAgent extends BaseAgent {
  readonly name = "webreader";
  readonly description = "Fetches one real web page and returns its readable text.";
  readonly capabilities = ["read a web page"] as const;
  readonly allowedTools = ["web.fetch_page"] as const;

  protected async execute(
    task: TaskPayload,
    _ctx: AgentContext,
    tools: AgentTools,
  ): Promise<AgentOutput> {
    const input = WebReaderInput.parse(task.input);
    const page = (await tools.call("web.fetch_page", { url: input.url })) as FetchedPage;
    return {
      summary: `Read "${clip(page.title, 60)}" (${page.text.length} characters)${page.truncated ? ", truncated" : ""}.`,
      output: { page },
    };
  }
}
