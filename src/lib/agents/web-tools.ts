/**
 * Stage 7 — tools backing the web-aware Research Agent and the Product Agent.
 *
 * `web.fetch_page` is real and needs no API key: it fetches a URL server-side
 * and strips HTML down to readable text, the same "real adapter, clearly
 * marked when unavailable" pattern as the Stage 5/6 Google tools — it simply
 * fails with a clear network/HTTP error instead of ever inventing a page.
 *
 * `web.search` is real *when* a search API key is configured
 * (`SEARCH_API_KEY`, e.g. from Brave Search or Serper). Per the master
 * prompt's rule for unavailable APIs, this tool never fabricates results: if
 * no key is configured it throws a clear, typed "not configured" error
 * instead of returning fake search hits.
 *
 * `product.extract` is a pure text/HTML heuristic (like `text.extract_dates`
 * in tools.ts) — no external API, so it is never mocked.
 */
import { z } from "zod";

import { defineTool, ToolError } from "./tools";
import { clip, normaliseWhitespace } from "./text-utils";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_FETCH_BYTES = 2_000_000;

export class WebFetchError extends Error {}

/** Strip scripts/styles/tags and collapse whitespace. Deliberately simple: this is text extraction, not a browser. */
function htmlToText(html: string): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const withBreaks = withoutNoise.replace(/<(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>(?!\s*$)/gi, "\n");
  const text = withBreaks
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  return text
    .split("\n")
    .map((line) => normaliseWhitespace(line))
    .filter(Boolean)
    .join("\n");
}

function extractMeta(html: string, name: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["']`,
    "i",
  );
  const match = pattern.exec(html);
  return match?.[1] ? normaliseWhitespace(match[1]) : null;
}

function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return match?.[1] ? normaliseWhitespace(match[1]) : null;
}

export type FetchedPage = {
  url: string;
  finalUrl: string;
  title: string;
  ogSiteName: string | null;
  text: string;
  truncated: boolean;
};

/** Fetch a URL and reduce it to readable text. Real network call — never mocked. */
export async function fetchPage(rawUrl: string): Promise<FetchedPage> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new WebFetchError(`"${rawUrl}" is not a valid URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WebFetchError("Only http(s) URLs can be fetched.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "MindSpaceBot/1.0 (+research agent; fetches only what the user asked for)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
  } catch (error) {
    throw new WebFetchError(
      error instanceof Error && error.name === "AbortError"
        ? `Fetching ${parsed.hostname} timed out.`
        : `Could not reach ${parsed.hostname}: ${error instanceof Error ? error.message : "network error"}.`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new WebFetchError(`${parsed.hostname} responded with ${response.status}.`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("xml") && contentType) {
    throw new WebFetchError(
      `${parsed.hostname} did not return a readable HTML page (${contentType}).`,
    );
  }

  const buffer = await response.arrayBuffer();
  const truncated = buffer.byteLength > MAX_FETCH_BYTES;
  const bytes = truncated ? buffer.slice(0, MAX_FETCH_BYTES) : buffer;
  const html = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

  return {
    url: parsed.toString(),
    finalUrl: response.url || parsed.toString(),
    title: extractTitle(html) ?? extractMeta(html, "og:title") ?? parsed.hostname,
    ogSiteName: extractMeta(html, "og:site_name"),
    text: clip(htmlToText(html), 20_000),
    truncated,
  };
}

/* ------------------------------------------------------------------ */
/* Search (real, needs a configured provider)                          */
/* ------------------------------------------------------------------ */

export type WebSearchHit = { title: string; url: string; snippet: string };

/**
 * Real web search via Brave Search's API when `SEARCH_API_KEY` is set.
 * Never falls back to fabricated results — per the master prompt, an
 * unavailable API must fail clearly rather than pretend to succeed.
 */
export async function webSearch(query: string, limit: number): Promise<WebSearchHit[]> {
  // Guarded: this module has no server-only imports (it's part of the plain
  // agent framework), so `process` may not exist in a non-Node context.
  const key = typeof process !== "undefined" ? process.env["SEARCH_API_KEY"] : undefined;
  if (!key) {
    throw new ToolError(
      "tool_failed",
      "Web search is not configured for this workspace (missing SEARCH_API_KEY). Ask an admin to add a Brave Search (or compatible) API key, or fetch a specific URL instead with web.fetch_page.",
    );
  }
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(limit));

  const response = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
  });
  if (!response.ok) {
    throw new ToolError("tool_failed", `Web search failed (${response.status}).`);
  }
  const payload = (await response.json()) as {
    web?: { results?: { title: string; url: string; description?: string }[] };
  };
  return (payload.web?.results ?? []).slice(0, limit).map((item) => ({
    title: normaliseWhitespace(item.title),
    url: item.url,
    snippet: clip(normaliseWhitespace(item.description ?? ""), 300),
  }));
}

/* ------------------------------------------------------------------ */
/* Product identification (pure heuristic — never mocked)              */
/* ------------------------------------------------------------------ */

const PRICE_PATTERN = /(?:USD|US\$|\$|€|£|₹)\s?\d[\d,]*(?:\.\d{1,2})?/g;

export type ProductCandidate = {
  name: string;
  price: string | null;
  siteName: string | null;
  url: string;
  links: string[];
};

export function extractProduct(page: FetchedPage): ProductCandidate {
  const prices = page.text.match(PRICE_PATTERN) ?? [];
  const links = new Set<string>();
  for (const match of page.text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    links.add(match[0].replace(/[.,;:!?]+$/, ""));
  }
  return {
    name: page.title,
    price: prices[0] ?? null,
    siteName: page.ogSiteName,
    url: page.finalUrl,
    links: [...links].slice(0, 8),
  };
}

/* ------------------------------------------------------------------ */
/* Tool definitions                                                     */
/* ------------------------------------------------------------------ */

export function createWebTools() {
  const fetchPageTool = defineTool({
    name: "web.fetch_page",
    description: "Fetch a URL and return its readable text (real network call; read-only).",
    inputSchema: z.object({ url: z.string().trim().url() }),
    mock: false,
    requiresConfirmation: false,
    execute: async ({ url }) => {
      try {
        return await fetchPage(url);
      } catch (error) {
        if (error instanceof WebFetchError) throw new ToolError("tool_failed", error.message);
        throw error;
      }
    },
  });

  const searchTool = defineTool({
    name: "web.search",
    description: "Search the web (real results; requires SEARCH_API_KEY to be configured).",
    inputSchema: z.object({
      query: z.string().trim().min(2).max(300),
      limit: z.number().int().min(1).max(10).default(5),
    }),
    mock: false,
    requiresConfirmation: false,
    execute: ({ query, limit }) => webSearch(query, limit),
  });

  const productExtractTool = defineTool({
    name: "product.extract",
    description: "Identify a candidate product (name, price, links) from a fetched page.",
    inputSchema: z.object({ url: z.string().trim().url() }),
    mock: false,
    requiresConfirmation: false,
    execute: async ({ url }) => {
      try {
        const page = await fetchPage(url);
        return extractProduct(page);
      } catch (error) {
        if (error instanceof WebFetchError) throw new ToolError("tool_failed", error.message);
        throw error;
      }
    },
  });

  return [fetchPageTool, searchTool, productExtractTool];
}
