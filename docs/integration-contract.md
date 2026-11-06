# Integration Contract

Status: **the core boundary is implemented; the wider API sketch below is partly target
design.** Defines the boundary between the Chrome extension, the TanStack web app, and the
Python MAS.

## 0. Implementation status

| Surface                                                              | Status                             | Notes                                                                                      |
| -------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| Page-context payload (`v1`)                                          | **implemented**                    | `src/components/mindspace/page-context.ts`, `public/content-script.js`                     |
| `POST /v1/context` · `GET /v1/context/latest` · `DELETE /v1/context` | **implemented**                    | `apps/api/app/main.py`; the server is the hand-off between extension and app               |
| `POST /v1/assist`                                                    | **implemented**                    | 23 API tests; labelled `[SIMULATED]` when offline                                          |
| `GET /health` · `GET /ready`                                         | **implemented**                    | `/ready` reports real dependency state and mode                                            |
| A2A card + JSON-RPC (`/a2a`, `/.well-known/agent-card.json`)         | **implemented**                    | `a2a-sdk`; legacy `/.well-known/agent.json` + `POST /tasks` kept                           |
| MCP server (`web_search`, `fetch_page`, `extract_facts`)             | **implemented**                    | `mas/mcp_service/`                                                                         |
| `POST /v1/analyze`, `GET /v1/runs*`, `/v1/tools*`, `/v1/approvals*`  | **target design, not implemented** | documented below as the intended contract; `/v1/assist` currently covers the analysis path |
| Browser→app→MAS with a live model                                    | **unverified**                     | B-2                                                                                        |
| Loaded-extension capture flow                                        | **unverified**                     | B-5                                                                                        |

Sections 2–8 below keep the full intended contract so the target stays reviewable. Where a
surface is not implemented, the status table above is authoritative.

## 1. Versions

| Surface              | Version | Notes                    |
| -------------------- | ------- | ------------------------ |
| Page context payload | `v1`    | Extension → app          |
| MAS HTTP API         | `/v1`   | App → MAS                |
| A2A envelope         | `v1`    | ADK agent ⇄ CrewAI agent |

Breaking changes require a new version prefix; `/v1` stays backwards compatible.

## 2. Page context payload (`v1`)

```ts
type PageContextV1 = {
  schema: "mindspace.page-context/1";
  title: string; // <= 300 chars, may be ""
  url: string; // absolute http(s) only
  domain: string; // derived from url, lowercase
  text: string; // <= 120_000 chars, truncated at word boundary
  wordCount: number; // computed from text, never estimated
  selection?: string; // user-selected passage, <= 20_000 chars
  capturedAt: string; // ISO-8601 UTC
  truncated: boolean; // true when text hit the limit
};
```

Rules:

- Capture is **user-initiated only** (side-panel button). No ambient tab reading.
- Restricted pages (`chrome://`, `chrome-extension://`, Web Store, `about:`) return a
  `restricted_page` error and never a partial/fabricated payload.
- Empty or unreadable pages return `no_readable_content`; the UI must show that state.
- The payload is **data**, never instructions (see guardrails).

## 3. Extension ↔ app bridge

Two channels, both additive:

1. `chrome.storage.local` key `mindspace.page-context.v1` — durable handoff.
2. `chrome.runtime.sendMessage({ type: "mindspace.page-context", payload })` — live update.

The app

- listens only when running inside the extension surface,
- validates with the same schema,
- ignores payloads older than 30 minutes,
- falls back to the existing paste flow when no bridge exists.

Required manifest additions (Stage 12, not now): `"scripting"` and
`host_permissions: ["<all_urls>"]` **or** `activeTab` + user gesture. Preference:
`activeTab` + `scripting`, which avoids broad host permissions.

## 4. MAS HTTP API (`/v1`)

### Health

```
GET /health   → 200 {"status":"ok","version":"…","uptime_s":12.3}
GET /ready    → 200 {"status":"ready","checks":{"db":"ok","llm":"ok","tools":"ok"}}
               503 with "status":"degraded" + failing check names
```

Health must reflect real dependencies. `ok` must never be hardcoded when the LLM
or database is unreachable.

### Analyse

> **Target design.** The implemented analysis endpoint is `POST /v1/assist` (§0). The shape
> below is the intended richer contract and is not served today.

```
POST /v1/analyze
Authorization: Bearer <token>
Content-Type: application/json

{
  "query": "Summarise this page",
  "persona": "researcher" | "editor" | "student" | "skeptic",
  "architecture": "sequential" | "hierarchical" | "parallel",
  "prompt_strategy": "standard" | "react",
  "page_context": PageContextV1 | null,
  "run_id": "uuid4"            // client-supplied for idempotency
}

→ 200 {
  "run_id": "…",
  "status": "success" | "partial" | "blocked" | "error",
  "answer": "…",
  "citations": [{ "title": "…", "url": "…", "quote": "…" }],
  "agents": [{ "name": "…", "role": "…", "latency_ms": 0, "tokens": 0, "status": "…" }],
  "guardrails": { "blocked": false, "flags": [] },
  "usage": { "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0 },
  "timing": { "total_ms": 0 }
}

→ 422 validation_error | 429 rate_limited | 503 dependency_unavailable
```

### Runs / traces

```
GET /v1/runs/{run_id}      → execution trace, intermediate outputs, tool calls
GET /v1/runs?limit=20      → recent runs (own user only)
```

### Tools

```
GET  /v1/tools             → [{ "name":"web_search", "server":"mcp:…", "schema":{…} }]
POST /v1/tools/{name}/invoke  → requires confirmation token for write-class tools
```

### Confirmation gate

Any tool in the `consequential` class (send email, create event, write file) returns:

```
202 { "status":"pending_approval", "approval_id":"…", "preview": {…} }
```

Execution resumes only via `POST /v1/approvals/{approval_id}` from the same user.

## 5. Error model

`application/problem+json` (RFC 7807):

```json
{
  "type": "https://mindspace.local/errors/validation_error",
  "title": "Invalid page context",
  "status": 422,
  "detail": "page_context.text exceeds 120000 characters",
  "instance": "/v1/analyze",
  "code": "validation_error"
}
```

Codes: `validation_error`, `unauthenticated`, `forbidden`, `not_found`,
`rate_limited`, `dependency_unavailable`, `timeout`, `guardrail_blocked`,
`restricted_page`, `no_readable_content`, `internal_error`.

## 6. Timeouts, retries, limits

| Operation                | Timeout       | Retry                            |
| ------------------------ | ------------- | -------------------------------- |
| Extension → app message  | 5 s           | no                               |
| App → MAS connect        | 3 s           | 1 retry, jitter                  |
| App → MAS total          | 120 s         | no (idempotent by `run_id`)      |
| MAS → MCP tool           | 15 s          | 2 retries on network errors only |
| MAS → LLM                | 60 s          | 1 retry on 429/5xx               |
| Concurrent runs per user | 3             | queue beyond that                |
| Page text                | 120 000 chars | truncated, flagged               |

## 7. Auth

- **Browser → app**: Supabase session JWT in `Authorization: Bearer`.
- **App → MAS**: server-side only; `MAS_SHARED_SECRET` (HMAC-signed, 60 s TTL) plus
  the end-user id claim. The MAS is never exposed to the public internet without this.
- **MAS → external tools**: per-tool credentials from env/secret manager; never sent
  to the browser.
- **CORS**: explicit allow-list from `ALLOWED_ORIGINS`; no `*` with credentials.

Secrets required (names only, values never committed): `MAS_SHARED_SECRET`,
`GROQ_API_KEY` (or chosen provider), `A2A_SERVICE_TOKEN`, plus existing
`SUPABASE_*`, `GOOGLE_*`.

## 8. Provenance

Every run records: `run_id`, `user_id`, `persona`, `architecture`, `prompt_strategy`,
model id, tool calls with args hash, source URLs, start/end timestamps, and the
dataset version. Provenance is required for the evaluation chapter and for audit.

## 9. Compatibility with existing code

- The existing `POST /api/chat` streaming route stays untouched.
- `src/lib/agents/*` remains the product path; MAS is an additional, explicit
  capability, selected per request — not a silent replacement.
- Existing Supabase tables (`agent_runs`, `chat_turns`, …) are reused; no migration
  is required for this contract.
