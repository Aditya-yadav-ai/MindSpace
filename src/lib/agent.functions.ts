/**
 * Server functions that proxy the browser app to the local Python agent
 * service. The base URL comes from `MINDSPACE_API_URL` (server-side only), so
 * the browser never talks to the service directly and no credentials reach the
 * client.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const DEFAULT_API_BASE =
  process.env["MINDSPACE_API_URL"] || process.env["FASTAPI_URL"] || "http://127.0.0.1:8010";
const DEFAULT_CLIENT_ID = "local";
const REQUEST_TIMEOUT_MS = 45_000;

export type AgentMode = "live" | "offline";

export type AgentSource = {
  index: number;
  title: string;
  url: string;
  snippet: string;
  similarity: number | null;
};

export type AgentAssistResult = {
  requestId: string;
  action: "summarize" | "explain" | "extract" | "ask";
  result: string;
  mode: AgentMode;
  mock: boolean;
  model: string;
  sources: AgentSource[];
  guardrails: {
    truncated: boolean;
    injectionFlags: string[];
    blocked: boolean;
    blockReason: string;
  };
  provenance: {
    mode: AgentMode;
    mock: boolean;
    model: string;
    promptVersion: string;
    contextSource: string;
    contextDomain: string;
  };
  latencyMs: number;
};

export type AgentStatus = {
  reachable: boolean;
  mode: AgentMode;
  mock: boolean;
  llmConfigured: boolean;
  reason: string;
};

export type LatestCapture = {
  title: string;
  url: string;
  domain: string;
  text: string;
  wordCount: number;
  source: string;
  ageSeconds: number | null;
};

function apiBase() {
  return (process.env["MINDSPACE_API_URL"] || DEFAULT_API_BASE).replace(/\/+$/, "");
}

function clientId() {
  return process.env["MINDSPACE_CLIENT_ID"] || DEFAULT_CLIENT_ID;
}

async function callService(path: string, init?: RequestInit) {
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-MindSpace-Client": clientId(),
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = null;
    }
  }
  return { ok: response.ok, status: response.status, payload };
}

function errorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const envelope = (payload as { error?: { message?: unknown; retryable?: unknown } }).error;
    if (envelope && typeof envelope.message === "string") {
      return envelope.message + (envelope.retryable ? " This looks temporary; try again." : "");
    }
  }
  return fallback;
}

const AssistInput = z.object({
  action: z.enum(["summarize", "explain", "extract", "ask"]),
  question: z.string().max(2000).default(""),
  maxWords: z.number().int().min(40).max(800).default(220),
  context: z.object({
    url: z.string().max(4096).default(""),
    title: z.string().max(512).default(""),
    domain: z.string().max(255).default(""),
    text: z.string().min(1).max(60_000),
    source: z.enum(["extension", "manual", "api"]).default("api"),
  }),
});

type RawAssist = {
  request_id: string;
  action: AgentAssistResult["action"];
  result: string;
  mode: AgentMode;
  mock: boolean;
  model: string;
  sources: Array<{
    index: number;
    title: string;
    url: string;
    snippet: string;
    similarity: number | null;
  }>;
  guardrails: {
    truncated: boolean;
    injection_flags: string[];
    blocked: boolean;
    block_reason: string;
  };
  provenance: {
    mode: AgentMode;
    mock: boolean;
    model: string;
    prompt_version: string;
    context_source: string;
    context_domain: string;
  };
  latency_ms: number;
};

/** Run one page action against the local agent service. */
export const assistPage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => AssistInput.parse(input))
  .handler(async ({ data }): Promise<AgentAssistResult> => {
    let response: Awaited<ReturnType<typeof callService>>;
    try {
      response = await callService("/v1/assist", {
        method: "POST",
        body: JSON.stringify({
          action: data.action,
          question: data.question,
          max_words: data.maxWords,
          context: data.context,
        }),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `The local MindSpace service is unreachable (${reason}). Start it with "python -m app.main" in apps/api.`,
      );
    }

    if (!response.ok) {
      throw new Error(
        errorMessage(response.payload, `The agent service returned HTTP ${response.status}.`),
      );
    }

    const raw = response.payload as RawAssist;
    return {
      requestId: raw.request_id,
      action: raw.action,
      result: raw.result,
      mode: raw.mode,
      mock: raw.mock,
      model: raw.model,
      sources: raw.sources ?? [],
      guardrails: {
        truncated: raw.guardrails.truncated,
        injectionFlags: raw.guardrails.injection_flags ?? [],
        blocked: raw.guardrails.blocked,
        blockReason: raw.guardrails.block_reason,
      },
      provenance: {
        mode: raw.provenance.mode,
        mock: raw.provenance.mock,
        model: raw.provenance.model,
        promptVersion: raw.provenance.prompt_version,
        contextSource: raw.provenance.context_source,
        contextDomain: raw.provenance.context_domain,
      },
      latencyMs: raw.latency_ms,
    };
  });

/** Health/mode of the local service, so the UI can label simulated output. */
export const getAgentStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<AgentStatus> => {
    try {
      const response = await callService("/ready");
      if (!response.ok || !response.payload) {
        return {
          reachable: false,
          mode: "offline",
          mock: true,
          llmConfigured: false,
          reason: `Service returned HTTP ${response.status}.`,
        };
      }
      const payload = response.payload as {
        mode?: AgentMode;
        mock?: boolean;
        llm_configured?: boolean;
        reason?: string;
      };
      return {
        reachable: true,
        mode: payload.mode === "live" ? "live" : "offline",
        mock: Boolean(payload.mock),
        llmConfigured: Boolean(payload.llm_configured),
        reason: payload.reason ?? "",
      };
    } catch {
      return {
        reachable: false,
        mode: "offline",
        mock: true,
        llmConfigured: false,
        reason: "The local agent service is not running.",
      };
    }
  },
);

/** The most recent capture the extension shared with the service. */
export const getLatestCapture = createServerFn({ method: "GET" }).handler(
  async (): Promise<LatestCapture | null> => {
    try {
      const response = await callService("/v1/context/latest");
      if (!response.ok || !response.payload) return null;
      const payload = response.payload as {
        context: {
          title?: string;
          url?: string;
          domain?: string;
          text?: string;
          word_count?: number;
          source?: string;
        } | null;
        age_seconds: number | null;
      };
      const context = payload.context;
      if (!context || !context.text) return null;
      return {
        title: context.title ?? "",
        url: context.url ?? "",
        domain: context.domain ?? "",
        text: context.text,
        wordCount: context.word_count ?? 0,
        source: context.source ?? "extension",
        ageSeconds: payload.age_seconds ?? null,
      };
    } catch {
      return null;
    }
  },
);
