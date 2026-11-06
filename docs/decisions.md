# Decisions (ADR log)

Lightweight Architecture Decision Records. `Open` items needed an owner decision before the
dependent stage could be implemented.

> **Status as of 2026-10-28:** the open items below were resolved during implementation.
> OD-1 (Python runtime) → `.venv312` on 3.12.13, matching the image; OD-2 (dependency
> installation) → installed into that venv with `uv`; OD-3 (LLM provider) → no key available,
> so option (c) was taken: every run is labelled `offline-deterministic` with `null`
> token/cost, and no offline output is presented as measured model behaviour; OD-4 (MAS
> exposure) → both parts: `/v1` served by `app/main.py`, A2A served separately on `:8001`;
> OD-5 (evaluation domain) → market-research tasks executed through the browser path, as the
> brief requires; OD-6 (Google integration) → unchanged, server-side OAuth only, no tokens in
> the extension. The records themselves are kept as written.

---

## ADR-001 — Operate directly in the target repository

**Status:** Accepted (2026-10-25)
**Context:** The session started in a linked Git worktree
(`…/worktree/22c5e5/kind-nebula`) that contained the UI redesign, while the required
project folder held different uncommitted work (Python MAS, extension, deploy files).
**Decision:** Move the session to
`C:\Users\aadin\Downloads\Telegram Desktop\mindspace-stage8\mindspace-stage8` and work
only there. The worktree remains untouched as the only other copy of the redesign.
**Consequences:** No work is written to another checkout; the worktree must not be
deleted until its content is fully integrated.

---

## ADR-002 — Integrate the redesign as a patch, not a copy

**Status:** Accepted (2026-10-25)
**Context:** 21 redesigned files existed only in the worktree (14 modified, 7 new).
The target had unrelated uncommitted work.
**Decision:** Verify that none of the 21 paths were modified in the target, prove the
target-side Supabase changes were type-only, then apply a `git diff` patch for the 14
modified files and copy the 7 new files, confirming SHA-256 equality afterwards.
**Consequences:** Clean, reviewable application; no overwrite of user work. Side effect:
`git apply` wrote CRLF, so the 21 files were re-normalised with Prettier and re-verified
byte-identical to the source.

---

## ADR-003 — Stage 2 is documentation-only

**Status:** Accepted (2026-10-25)
**Context:** Reliability findings must be separated from fixes, and dependencies cannot
be installed without approval.
**Decision:** Stage 2 produces four documents and no functional code, no schema change,
no install.
**Consequences:** Stage 3 owns all startup/config fixes.

---

## ADR-004 — Reject naming-only implementations

**Status:** Accepted (2026-10-25)
**Context:** `adk_agents/`, `mcp_tools.py`, and `a2a/` exist but do not use Google ADK,
the MCP protocol, or the A2A protocol. The brief forbids claiming a capability because a
file has the corresponding name.
**Decision:** Treat these as unimplemented. Existing evaluation output that depends on
them is marked invalid rather than reused.
**Consequences:** Stages 5–7 are rebuilds, not adjustments. Prior metrics are
non-citable.

---

## ADR-005 — Page content is untrusted data

**Status:** Accepted (2026-10-25)
**Context:** The product reads arbitrary webpages, a prompt-injection vector.
**Decision:** Captured page text is always transported and rendered as data, fenced and
labelled as untrusted. System instructions are never merged with page text. Tools are
least-privilege, and consequential actions require explicit user confirmation.
**Consequences:** Guardrails (Stage 8) must run on every MAS entry point, including the
extension bridge.

---

## ADR-006 — Keep the existing TypeScript agent path

**Status:** Accepted (2026-10-25)
**Context:** `src/lib/agents/*` already implements a working product agent stack
(manager, planner, workers, verifier, tracer) with Supabase persistence.
**Decision:** Keep it. The Python MAS becomes an explicitly selected capability behind
`/v1/analyze`, not a silent replacement.
**Consequences:** Two stacks coexist until they share the contract in
`docs/integration-contract.md`; no functionality is removed to simplify integration.

---

## Open decisions (blocking)

### OD-1 — Python runtime for the MAS

`crewai` requires `<3.14`; the current venv is 3.14.3.
**Options:** (a) create `apps/api/.venv312` on Python 3.12 (matches the Dockerfile);
(b) 3.13.
**Recommendation:** 3.12, to match the deployment image exactly.
**Blocks:** Stages 3, 5, 6, 10.

### OD-2 — Dependency installation

Install `crewai`, `google-adk`, `mcp`, `litellm`, `duckduckgo-search`, `groq`, `pandas`
into the new venv (pinned in one manifest).
**Recommendation:** approve, pinned, in a new venv only; the existing 3.14 venv is left
in place.
**Blocks:** Stages 3–11.

### OD-3 — LLM provider and key

Real evaluation requires a live provider. `GROQ_API_KEY` currently defaults to a
placeholder.
**Options:** (a) supply a Groq key; (b) another provider; (c) explicit offline mode with
runs labelled `mode=offline` and excluded from statistics.
**Recommendation:** (a) if available, otherwise (c) — never present offline output as
measured results.
**Blocks:** Stages 6, 9, 10, 11.

### OD-4 — MAS exposure model

**Options:** (a) mount MAS routers inside `apps/api/app/main.py` (one service, one port);
(b) run the A2A server separately on `:8001` and have the app call it.
**Recommendation:** (a) for the product path, with the A2A endpoint mounted as a second
router — one deployable, one health check, fewer moving parts.
**Blocks:** Stages 3, 6, 12.

### OD-5 — Evaluation domain

The current dataset is e-commerce pricing.
**Options:** (a) re-base tasks on browser research/summarisation/extraction;
(b) keep both and report them as separate domains.
**Recommendation:** (a) — the brief requires browser-assistant tasks.
**Blocks:** Stages 7, 8, 10, 11.

### OD-6 — Google integration in the browser

The app currently has Google OAuth scaffolding in `src/lib/google*`.
**Options:** (a) server-side OAuth with tokens stored in Supabase, never in the extension;
(b) defer until Stage 12.
**Recommendation:** (a), already the safer default; no client-side tokens.
**Blocks:** Stage 12.

---

## Decision log conventions

- One ADR per irreversible or cross-cutting choice.
- `Open` decisions list a recommendation and the stages they block.
- Accepted decisions record consequences, including defects accepted knowingly.
