# MindSpace evaluation report

Generated: 2026-10-29T09:11:30.275376+00:00

## How to reproduce

```bash
cd apps/api
python -m mas.run_evaluation --batch core-p2p
python -m mas.run_evaluation --batch a2a   # requires the A2A server
python -m mas.run_evaluation --analyse-only
```

## Dataset

- Version: `mindspace-eval-1.0.0`
- SHA-256 of cases: `d651e6987e440011ab484bdc29491e5904c44c50ab13e3d7bca6d992cb1143fe`
- Cases recorded in raw results: 44 runs
- Design: matched blocks. Each block fixes persona, query and tool configuration, then repeats across architectures.

## Execution mode (read this before interpreting numbers)

- Mode: **offline-deterministic**
- Model provider: none (offline-deterministic execution)
- No usable model API key was configured, so runs execute the real ADK/CrewAI orchestration paths, real MCP tool calls and real network search, but no LLM inference. Token and cost fields are null, not 0.

## Results summary

- Runs: **44**
- Status: blocked=4, partial=40
- Evidence retrieval rate: **90.9%** (95% CI 78.8%–96.4%)
- Latency: mean 2859.1 ms, median 2478.8 ms, p95 6088.1 ms (95% CI of mean 2410.1–3334.2 ms)
- Evidence-quality score: mean 0.899

## Architecture comparison

| Architecture | Runs | Evidence rate | Latency median (ms) | Latency mean (ms) | Quality (mean) | Mean sources |
| ------------ | ---- | ------------- | ------------------- | ----------------- | -------------- | ------------ |
| sequential   | 11   | 90.9%         | 4278.6              | 3873.2            | 0.901          | 5.09         |
| hierarchical | 11   | 90.9%         | 2434.8              | 2617.0            | 0.899          | 4.18         |
| parallel     | 11   | 90.9%         | 2689.7              | 2765.7            | 0.895          | 5.91         |
| react        | 11   | 90.9%         | 2285.6              | 2180.4            | 0.899          | 4.18         |

## Search plan per architecture

The control flow each architecture actually executed, read back from the evidence payload of every run. This is the mechanism behind the numbers above; it is recorded so the comparison can be checked against the dataset instead of taken on trust.

| Architecture | Strategy                | Mean queries issued | Max concurrency | Max refine iterations | Mean delegations |
| ------------ | ----------------------- | ------------------- | --------------- | --------------------- | ---------------- |
| sequential   | none×1, sequential×10   | 1.70                | 0               | 0                     | n/a              |
| hierarchical | hierarchical×10, none×1 | 1.20                | 0               | 0                     | 0.20             |
| parallel     | none×1, parallel×10     | 2.00                | 2               | 0                     | n/a              |
| react        | none×1, react×10        | 1.20                | 0               | 2                     | n/a              |

## Statistical tests

Alpha = 0.05; pairwise tests use Bonferroni correction across 5 comparisons.

| Test             | Comparison                                                            | n                                                     | Statistic | p        | Significant | Cliff's delta |
| ---------------- | --------------------------------------------------------------------- | ----------------------------------------------------- | --------- | -------- | ----------- | ------------- |
| Kruskal-Wallis H | latency across all architectures                                      | hierarchical=11, parallel=11, react=11, sequential=11 | 5.9333    | 0.114899 | no          | n/a           |
| Mann-Whitney U   | prompt strategy (standard vs ReAct): sequential vs react              | sequential=11, react=11                               | 90.0      | 0.056873 | no          | 0.488         |
| Mann-Whitney U   | architecture (sequential vs parallel): sequential vs parallel         | sequential=11, parallel=11                            | 80.0      | 0.212165 | no          | 0.322         |
| Mann-Whitney U   | architecture (sequential vs hierarchical): sequential vs hierarchical | sequential=11, hierarchical=11                        | 82.0      | 0.167905 | no          | 0.355         |
| Mann-Whitney U   | architecture (parallel vs hierarchical): parallel vs hierarchical     | parallel=11, hierarchical=11                          | 75.0      | 0.357933 | no          | 0.240         |
| Mann-Whitney U   | architecture (ReAct vs parallel): react vs parallel                   | react=11, parallel=11                                 | 33.0      | 0.076236 | no          | -0.455        |

Interpretation rule used here: a difference is only called an architecture effect when the Bonferroni-corrected p-value is below alpha. In offline mode the dominant latency term is network search, so absence of a significant difference is the expected and honest result.

## Quality rubric

Rubric version `1.0.0`. Structural evidence-quality rubric. It scores the presence and provenance of retrieved evidence and the completeness of the rendered report. It is NOT a semantic judgement of analytical insight, and it does not reward invention.

| Criterion           | Weight | Rule                                             | Mean score |
| ------------------- | ------ | ------------------------------------------------ | ---------- |
| evidence_present    | 0.3    | market_research parsed from validated evidence   | 0.909      |
| source_count        | 0.2    | min(distinct_sources / 3, 1)                     | 0.909      |
| publisher_diversity | 0.15   | min(distinct_publishers / 2, 1)                  | 0.864      |
| dated_sources       | 0.1    | fraction of sources with an ISO publication date | 0.827      |
| report_sections     | 0.15   | fraction of required markdown sections present   | 0.939      |
| clean_execution     | 0.1    | 1.0 when no execution errors were recorded       | 0.909      |

## Artifacts

- Latency boxplot by architecture: `C:\Users\aadin\Downloads\Telegram Desktop\mindspace-stage8\mindspace-stage8\apps\api\mas\outputs\evaluation\boxplot_latency_by_architecture.png`
- Latency boxplot by persona: `C:\Users\aadin\Downloads\Telegram Desktop\mindspace-stage8\mindspace-stage8\apps\api\mas\outputs\evaluation\boxplot_latency_by_persona.png`
- Quality boxplot by architecture: `C:\Users\aadin\Downloads\Telegram Desktop\mindspace-stage8\mindspace-stage8\apps\api\mas\outputs\evaluation\boxplot_quality_by_architecture.png`
- Evidence-rate bar chart: `C:\Users\aadin\Downloads\Telegram Desktop\mindspace-stage8\mindspace-stage8\apps\api\mas\outputs\evaluation\evidence_rate_by_architecture.png`
- Per-agent telemetry heatmap: `C:\Users\aadin\Downloads\Telegram Desktop\mindspace-stage8\mindspace-stage8\apps\api\mas\outputs\evaluation\heatmap.png`
- Raw runs (immutable input to this report): `C:\Users\aadin\Downloads\Telegram Desktop\mindspace-stage8\mindspace-stage8\apps\api\mas\outputs\evaluation\raw_runs.jsonl`
- Derived table: `C:\Users\aadin\Downloads\Telegram Desktop\mindspace-stage8\mindspace-stage8\apps\api\mas\outputs\evaluation\results_dataset.csv`
- Architecture comparison JSON: `C:\Users\aadin\Downloads\Telegram Desktop\mindspace-stage8\mindspace-stage8\apps\api\mas\outputs\evaluation\architecture_comparison.json`
- Machine-readable summary: `C:\Users\aadin\Downloads\Telegram Desktop\mindspace-stage8\mindspace-stage8\apps\api\mas\outputs\evaluation\summary.json`

## Failed and blocked runs

| Case     | Architecture | Status  | Error category  | Detail                                                                             |
| -------- | ------------ | ------- | --------------- | ---------------------------------------------------------------------------------- |
| case-022 | hierarchical | blocked | guardrail_block | Query blocked by guardrails: Prompt injection detected: 'Ignore your instructions' |
| case-021 | sequential   | blocked | guardrail_block | Query blocked by guardrails: Prompt injection detected: 'Ignore your instructions' |
| case-023 | parallel     | blocked | guardrail_block | Query blocked by guardrails: Prompt injection detected: 'Ignore your instructions' |
| case-024 | react        | blocked | guardrail_block | Query blocked by guardrails: Prompt injection detected: 'Ignore your instructions' |

## Limitations

- No live model key was available, so no LLM inference, tokens or cost are reported. Token/cost columns are `null`, not zero.
- Downloaded search results are real, but news-feed backends are inherently time-dependent: reruns on a later date will retrieve different items and therefore different source counts.
- Quality scores measure structural evidence quality, not analytical correctness. They must not be read as a measure of insight.
- The A2A batch is small (one matched block) and is evidence of protocol integration, not a powered architecture comparison.
- Agent telemetry for the A2A batch covers only the client-side orchestrator and report agent. The researcher runs inside the separate A2A server process, whose callbacks are not visible to the harness; the core batch covers all three agents.
