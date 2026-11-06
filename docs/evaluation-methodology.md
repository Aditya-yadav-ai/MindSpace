# Evaluation methodology

Requirement 7 asks for a measured comparison of the architectures; Requirement 10 asks for
statistics, boxplots, an agent-level heatmap and reproducible evaluation data. This document
states exactly what is measured, how, and — importantly — what the numbers do **not** mean.

## What is compared

Four execution patterns, all producing the same market-research report. Each has a real
implementation on **both** execution paths — the live-model path (CrewAI crews) and the
offline native-MCP path:

| Architecture   | Live-model path (CrewAI)                                                    | Offline path (native MCP evidence)                                                                                                                         |
| -------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sequential`   | one crew, `Process.sequential`, dependent tasks                             | serial queries; widen with a price query only if the first result set is thin                                                                              |
| `hierarchical` | one crew, `Process.hierarchical`, manager delegating to specialists         | planner picks the most specific single query, worker executes it; planner delegates a second query only if evidence is thin (records `plan`/`delegations`) |
| `parallel`     | two independent crews in worker threads, then a pricing crew consuming both | both queries issued concurrently in a `ThreadPoolExecutor`, results merged (records `concurrency=2`)                                                       |
| `react`        | sequential CrewAI crew (CrewAI has no separate ReAct process)               | observe→refine loop: search, count distinct sources, refine up to three times until evidence suffices (records `iterations`/`observations`)                |

**Why this matters.** Earlier revisions collapsed all four labels onto one code path when no
model key was configured: `_run_crewai` returned `None` and every architecture executed the same
sequential native research. The 40-run "architecture comparison" then measured one path four
times and reported network noise as architecture differences. That was a genuine measurement
flaw. The offline flows above were implemented so that the comparison is real without a model,
and `tests/test_architecture_flows.py` (14 tests) asserts the four flows differ in query count,
concurrency, iterations and delegations. What the offline comparison still **cannot** show is
language-model behaviour: no tokens are generated, so prompt-level differences are invisible.

## Design: matched blocks, shuffled execution

- **10 distinct research questions** across 5 personas. One of them (the headphones question) is
  repeated in an extra block with a different dispatch transport, giving **11 blocks**.
- **10 core blocks × 4 architectures = 40 runs** on `p2p` dispatch.
- **1 further block × 4 architectures = 4 runs** with `a2a` dispatch, so both hand-off
  transports are exercised on matched input. Total: **44 runs**.
- Execution order is **shuffled with a fixed seed** (`SHUFFLE_SEED = 20261025`) and the order is
  recorded per run. Without this, network drift over half an hour would silently attach itself to
  whichever architecture happened to run last.

Dataset: `mas/evaluation/data/cases_v1.jsonl`, version `mindspace-eval-1.0.0`, SHA-256 recorded in
`cases_v1.meta.json`. One question is deliberately adversarial in two different ways: a prompt
injection, which the injection detector **blocks** (4 runs, `error_category=guardrail_block`),
and an abusive persona, whose offensive tokens are **filtered** with `[FILTERED]` and dropped
from the search terms, so those 4 runs still retrieve evidence. Both are kept in the dataset;
neither is deleted or back-filled.

## What is measured

Per run, recorded to `mas/outputs/evaluation/raw_runs.jsonl` (flushed after every run):

- `status` — `success` / `partial` / `error` / `blocked`
- `latency_ms` — wall clock for the whole orchestration
- evidence provenance — distinct sources, distinct publishers, dated fraction, backends used
- `quality_score` — the structural rubric below
- `tool_calls`, `agent_steps`, `blackboard_reads/writes`, `a2a_calls`, `p2p_messages_sent/received`
- `dispatch_transport` — must be exactly one of `a2a` / `p2p` / `local` / `none`
- `execution_mode` — `live-model` or `offline-deterministic`; `llm_available`
- `llm_tokens_used` / `estimated_cost_usd` — `null` (not `0`) when no model ran

### Evidence-quality rubric

Quality is a **structural** score, deliberately not a semantic "insight" score, because judging
insight requires a model and there is no model key in this environment:

| Criterion           | Weight | Rule                                             |
| ------------------- | ------ | ------------------------------------------------ |
| evidence present    | 0.30   | `market_research` parsed from validated evidence |
| source count        | 0.20   | `min(distinct_sources / 3, 1)`                   |
| publisher diversity | 0.15   | `min(distinct_publishers / 2, 1)`                |
| dated sources       | 0.10   | fraction of sources with an ISO publication date |
| report sections     | 0.15   | fraction of required markdown sections present   |
| clean execution     | 0.10   | 1.0 when no execution errors were recorded       |

A report that cites five dated sources from five publishers but says nothing insightful scores
high. That is a limitation of the metric, not a claim about report quality.

## Statistics

- Bootstrap 95 % confidence intervals (10 000 resamples, fixed seed) for mean latency and quality.
- Wilson score interval for the evidence-retrieval rate (a proportion, so Wilson rather than
  normal approximation).
- Kruskal–Wallis across the four architectures (non-parametric: latency is skewed and n is small).
- Five pairwise Mann–Whitney U comparisons with Bonferroni correction.
- Cliff's delta as an effect size, because a p-value alone does not say whether a difference matters.

## Outputs

```
mas/outputs/evaluation/
  raw_runs.jsonl                      # every run, appended and flushed per run
  results_dataset.csv                 # flat table incl. the per-run search plan
  summary.json                        # CIs, effect sizes, tests, status counts
  architecture_comparison.json        # incl. queries issued / concurrency / iterations / delegations
  agent_metrics_core-p2p.json         # per-agent steps/tool calls/latency, summed over every run in the batch
  tool_level_metrics_core-p2p.csv
  boxplot_latency_by_architecture.png
  boxplot_latency_by_persona.png
  boxplot_quality_by_architecture.png
  evidence_rate_by_architecture.png
  heatmap.png                         # agent × metric telemetry, summed across runs
  performance_report.md
```

Each record carries the architecture's actual search plan (`research_strategy`,
`queries_issued`, `search_concurrency`, `search_iterations`, `search_delegations`), parsed from
the evidence payload the run produced. That is what lets a reader check _why_ one pattern
retrieved more sources instead of taking the comparison on trust.

## What these numbers do not show

This matters more than the numbers themselves:

1. **No live model ran.** There is no `GROQ_API_KEY` in this environment. Every run is
   `execution_mode=offline-deterministic`, the ADK/CrewAI model calls are replaced by the
   deterministic evidence path, and token/cost fields are `null` rather than invented. The
   architecture _wiring_ is real (the ADK and CrewAI runtimes were separately verified to execute
   with a model double), but the model's contribution to latency and quality is absent.
2. **Latency is dominated by live web search**, not by orchestration logic. A single news-search
   call took anywhere from **~1.5 s to ~22 s** on this network during the project, depending on
   the moment. Because the offline flows issue different numbers of searches and use different
   concurrency, part of the architecture latency gap is now a real consequence of the pattern
   (e.g. `parallel` issues two searches concurrently and can finish sooner than `sequential`
   issuing one), but the absolute numbers still move with the network. The shuffled order and
   confidence intervals exist to keep that honest, not to make it disappear.
3. **Quality saturates.** The rubric rewards evidence and structure; once a run has three sources,
   two publishers and all report sections, it scores 1.0. It cannot distinguish a good analysis
   from a merely complete one.
4. **`success` is structurally unreachable offline.** The report agent requires market research
   _and_ product analysis _and_ pricing to claim `success`. Product analysis and pricing need real
   price evidence and/or a model, so the orchestrator leaves them empty. The best attainable status
   is `partial`, and that is what the runs report.
5. **Evidence coverage is environmental.** Backend availability changes between sessions. In this
   final batch Google News RSS was the primary backend for **all 40 runs that retrieved
   evidence**, with DuckDuckGo HTML appearing as an additional backend in 4 of them and
   DuckDuckGo in 1, giving a 90.9 % evidence rate. Earlier sessions saw DuckDuckGo return a 202
   challenge, Bing serve cloaked junk, and several engines rate-limit. A query that returns no
   relevant evidence is recorded as `error`/`search_unavailable` and stays in the dataset; nothing
   is back-filled.

6. **Architecture differences are structural, not semantic.** The offline flows differ in how many
   searches they issue, whether those searches run concurrently, how many observe→refine steps
   they take, and whether a planner delegates. They do not differ in what a language model would
   say, because no model runs. The comparison is therefore a fair comparison of _control flow and
   its cost_, not of reasoning quality.
