# MindSpace Architecture

Status: **current implementation**, verified 2026-10-28. This document describes what runs
today. Where a subsystem is unverified, it says so and names the blocker (see
`docs/final-report.md` §13).

## 1. Components

| Component        | Location                                                                                                           | Runtime                          | Role                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------- | ---------------------------------------------------------------------------- |
| Chrome extension | `public/manifest.json`, `public/sidepanel.{html,js}`, `public/extension-background.js`, `public/content-script.js` | Chrome MV3                       | Side panel, page extraction, and a direct HTTP client of the MAS API         |
| Web app          | `src/` (TanStack Start + React 19 + Vite)                                                                          | Node/edge SSR + browser          | Auth, workspace UI, chat, agents, Google integration                         |
| Product API (TS) | `src/routes/api/*`, `src/lib/*.functions.ts`                                                                       | TanStack server functions        | Chat streaming, agents, Google OAuth, cron, MAD proxy                        |
| MAS HTTP API     | `apps/api/app/main.py`                                                                                             | FastAPI                          | `/health`, `/ready`, `/v1/context`, `/v1/context/latest`, `/v1/assist`       |
| MAS core         | `apps/api/mas/`                                                                                                    | Python 3.12.13                   | Blackboard, P2P, ADK/CrewAI orchestration, guardrails, MCP tools, evaluation |
| MCP server       | `apps/api/mas/mcp_service/server.py`                                                                               | Python (stdio + streamable HTTP) | `web_search`, `fetch_page`, `extract_facts`                                  |
| A2A server       | `apps/api/mas/a2a/server.py`                                                                                       | Python, port 8001                | Agent card + JSON-RPC `message/send`; legacy `/tasks` kept                   |
| Database         | `supabase/migrations/*`                                                                                            | Postgres (Supabase)              | Users, runs, chat turns, memories, tasks, automations, Google connections    |

## 2. Subsystem boundaries

```
┌──────────────────────────────────────────┐
│ Chrome extension (MV3)                   │
│  sidepanel.html / .js                    │
│  content-script.js  (chrome.scripting)   │
│  extension-background.js  → /v1/*, /ready│
└───────────────┬──────────────────────────┘
                │  POST /v1/context          (capture hand-off)
                │  POST /v1/assist           (analysis)
                │  GET  /ready               (mode + mock badge)
┌───────────────▼──────────────────────────┐        ┌──────────────────────────────┐
│ Web app  (src/)                          │        │ Supabase (Postgres + Auth)   │
│  routes/index.tsx                        │───────▶│  agent_runs, chat_turns,     │
│  lib/agent.functions.ts → /v1/assist     │        │  user_memories, tasks,       │
│  lib/agent.functions.ts → /v1/context/…  │        │  automations, google_*       │
└───────────────┬──────────────────────────┘        └──────────────────────────────┘
                │  server-side HTTP to the MAS
┌───────────────▼──────────────────────────┐
│ FastAPI  (apps/api/app/main.py)          │
│  /health   /ready                        │
│  /v1/context   /v1/context/latest        │
│  /v1/assist                              │
└───────────────┬──────────────────────────┘
                │  in-process
┌───────────────▼──────────────────────────┐
│ mas/                                     │
│  ADK orchestrator ── A2A or P2P ──▶ crew │
│  blackboard (SQLite)   p2p mailbox (SQLite) │
│  guardrails            MCP client ──▶ MCP server │
└──────────────────────────────────────────┘
```

**Verified facts**

- `apps/api/app/main.py` serves six routes: `GET /health`, `GET /ready`,
  `POST /v1/context`, `GET /v1/context/latest`, `DELETE /v1/context`, `POST /v1/assist`.
  The MAS is therefore reachable from the product, unlike the 2026-10-25 baseline.
- The extension declares `sidePanel`, `storage`, `activeTab`, `scripting`, and host
  permissions limited to `http://127.0.0.1:8000/*` and `http://localhost:8000/*`.
- `public/content-script.js` extracts readable text (article → main → body, junk-node removal,
  60k cap) and reports `restricted` / `empty` / `extraction_failed` explicitly.
- `src/lib/agent.functions.ts` calls `/v1/assist` and `/v1/context/latest`; the extension calls
  `/v1/context` and `/v1/assist` directly. The **server** is the hand-off between the two
  clients, so they do not share a browser storage area.
- The MCP and A2A servers are separate processes, not mounted on the FastAPI app.

Not verified: loading the unpacked extension and capturing a real page (blocker B-5), and any
live-model path (blocker B-2).

## 3. Trust boundaries

| Boundary             | Trust rule                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| Webpage → extension  | **Untrusted data.** Page text may contain prompt injection. Never executed as instructions.           |
| Extension → app      | Accepted only after schema validation and size/type limits.                                           |
| Browser → app API    | Supabase JWT (`Authorization: Bearer`). No secrets in client code.                                    |
| App → MAS            | Server-side only; the MAS is not exposed to the browser in production.                                |
| MAS → external tools | Least privilege; `fetch_page` blocks loopback/private/link-local/reserved hosts and non-HTTP schemes. |
| MAS → LLM            | Page content is fenced as data, never concatenated into system instructions.                          |

## 4. Actual data flow (offline-deterministic mode)

1. User clicks **Capture page** in the side panel (explicit action, per tab).
2. The content script extracts and normalises the page to a `PageContext` (title, url, domain,
   text, wordCount, capturedAt, optional selection).
3. `extension-background.js` `POST`s it to `/v1/context`, which stores it under a client id with
   a TTL.
4. The user chooses an action; the client sends `POST /v1/assist` with the question, persona and
   architecture.
5. The MAS validates input, runs the ADK orchestrator, hands the task to the crew over **either**
   A2A **or** P2P (never both), calls MCP tools, writes blackboard and audit records, and returns
   a Pydantic response with `sources[]` and `provenance{}`.
6. The response is labelled: `[SIMULATED]`, `mock=true`, `mode=offline`, model
   `offline-heuristic`. The UI renders a badge so a simulated answer cannot be read as a
   generated one.
7. If a model key is configured, the same path runs with a real completion and the label is
   dropped.

## 5. Defects from the 2026-10-25 baseline, and their status

| #   | Baseline defect                                   | Status now                                                                                                                 |
| --- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| A1  | MAS is not served                                 | **Fixed** — six routes served by `app/main.py`; tested in `tests/test_api_v1.py`                                           |
| A2  | Extension does not capture content                | **Fixed in code** — `scripting` + host permissions + content script; unverified on a live page (B-5)                       |
| A3  | Two agent stacks with no shared contract          | **Narrowed** — the product path goes through `/v1/assist`; the TS agent stack still exists but is no longer the only route |
| A4  | `adk_agents`, `mcp_tools`, `a2a` were naming-only | **Fixed** — real `google.adk` `LlmAgent`/`InMemoryRunner`, real `mcp` SDK client/server, real `a2a-sdk` JSON-RPC           |
| A5  | Evaluation dataset predates the code              | **Fixed** — 44 runs regenerated from the current build; `raw_runs.jsonl` is the immutable input to every figure            |

## 6. Out of scope for this stage

- No commits, pushes or deployments.
- No dependency installs or lockfile changes (blocker B-8).
- No edits to user-owned files: `body.txt`, `headers.txt`, `app.yaml`, `.kiro/`,
  `src/integrations/`, `public/sidepanel.*` beyond the reviewed capture work.
