/**
 * Stage 7 — Product Agent. Given a URL (explicit, or the first link found in
 * the captured page/selection), fetches it for real and extracts a candidate
 * product name, price and related links. No step here is a mock: a page
 * that cannot be reached fails with a clear error instead of an invented
 * product.
 */
import { z } from "zod";

import { BaseAgent, type AgentContext, type AgentOutput, type AgentTools } from "./agent";
import { clip } from "./text-utils";
import { extractLinks } from "./tools";
import type { ProductCandidate } from "./web-tools";
import type { TaskPayload } from "./types";

const ProductInput = z.object({
  url: z.string().trim().url().optional(),
});

export class ProductAgent extends BaseAgent {
  readonly name = "product";
  readonly description =
    "Identifies a product (name, price, related links) from a URL or the current page.";
  readonly capabilities = ["identify a product", "discover related links"] as const;
  readonly allowedTools = ["product.extract", "text.extract_links"] as const;

  protected async execute(
    task: TaskPayload,
    ctx: AgentContext,
    tools: AgentTools,
  ): Promise<AgentOutput> {
    const input = ProductInput.parse(task.input);

    let url = input.url;
    if (!url) {
      const pageText = `${ctx.page.selection} ${ctx.page.text} ${ctx.page.url}`.trim();
      const found = extractLinks(pageText).urls[0];
      if (!found) {
        throw new Error(
          "Finding a product needs a URL — none was given and none was found on the captured page.",
        );
      }
      url = found;
    }

    const product = (await tools.call("product.extract", { url })) as ProductCandidate;
    return {
      summary: product.price
        ? `Found "${clip(product.name, 60)}" at ${product.price}, with ${product.links.length} related link(s).`
        : `Found "${clip(product.name, 60)}" — no price was detected on the page.`,
      output: { product },
    };
  }
}
