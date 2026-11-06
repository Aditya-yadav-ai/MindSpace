"""Derived analysis for evaluation runs: statistics, charts, and report.

Raw records (``raw_runs.jsonl``) are never modified here. Everything in this
module is derived and regenerable from the raw file, which keeps the
"raw results" and "derived reports" separation that Requirement #10 asks for.
"""
from __future__ import annotations

import csv
import json
import math
import statistics
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import numpy as np

from mas.evaluation.dataset import ARCHITECTURES, load_meta
from mas.evaluation.harness import OUTPUT_DIR, QUALITY_RUBRIC, environment_metadata

RAW_RUNS_PATH = OUTPUT_DIR / "raw_runs.jsonl"
SUMMARY_PATH = OUTPUT_DIR / "summary.json"
REPORT_PATH = OUTPUT_DIR / "performance_report.md"
ARCH_COMPARISON_PATH = OUTPUT_DIR / "architecture_comparison.json"
DATASET_CSV_PATH = OUTPUT_DIR / "results_dataset.csv"
BOXPLOT_LATENCY_PATH = OUTPUT_DIR / "boxplot_latency_by_architecture.png"
BOXPLOT_PERSONA_PATH = OUTPUT_DIR / "boxplot_latency_by_persona.png"
BOXPLOT_QUALITY_PATH = OUTPUT_DIR / "boxplot_quality_by_architecture.png"
EVIDENCE_CHART_PATH = OUTPUT_DIR / "evidence_rate_by_architecture.png"
HEATMAP_PATH = OUTPUT_DIR / "heatmap.png"

BOOTSTRAP_RESAMPLES = 10_000
BOOTSTRAP_SEED = 20261025
ALPHA = 0.05


def load_records(path: Path = RAW_RUNS_PATH) -> list[dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(f"No raw results at {path}. Run the harness first.")
    records = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def bootstrap_mean_ci(values: Iterable[float], resamples: int = BOOTSTRAP_RESAMPLES) -> tuple[float, float]:
    data = np.asarray(list(values), dtype=float)
    if data.size == 0:
        return (float("nan"), float("nan"))
    if data.size == 1:
        return (float(data[0]), float(data[0]))
    rng = np.random.default_rng(BOOTSTRAP_SEED)
    means = rng.choice(data, size=(resamples, data.size), replace=True).mean(axis=1)
    return (float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5)))


def wilson_interval(successes: int, total: int, z: float = 1.959963984540054) -> tuple[float, float]:
    if total == 0:
        return (float("nan"), float("nan"))
    p = successes / total
    denominator = 1 + z * z / total
    centre = p + z * z / (2 * total)
    margin = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total))
    return (
        max(0.0, (centre - margin) / denominator),
        min(1.0, (centre + margin) / denominator),
    )


def cliffs_delta(first: list[float], second: list[float]) -> float:
    """Non-parametric effect size in [-1, 1]."""
    if not first or not second:
        return float("nan")
    a = np.asarray(first, dtype=float)
    b = np.asarray(second, dtype=float)
    comparisons = a[:, None] - b[None, :]
    greater = float((comparisons > 0).sum())
    less = float((comparisons < 0).sum())
    return (greater - less) / (a.size * b.size)


def descriptive(values: list[float]) -> dict[str, Any]:
    if not values:
        return {
            "n": 0,
            "mean": None,
            "median": None,
            "stdev": None,
            "min": None,
            "max": None,
            "p95": None,
            "mean_ci95": [None, None],
        }
    ci_low, ci_high = bootstrap_mean_ci(values)
    return {
        "n": len(values),
        "mean": round(statistics.fmean(values), 3),
        "median": round(statistics.median(values), 3),
        "stdev": round(statistics.stdev(values), 3) if len(values) > 1 else 0.0,
        "min": round(min(values), 3),
        "max": round(max(values), 3),
        "p95": round(float(np.percentile(values, 95)), 3),
        "mean_ci95": [round(ci_low, 3), round(ci_high, 3)],
    }


def _group(records: list[dict[str, Any]], key: str) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        grouped.setdefault(str(record.get(key)), []).append(record)
    return grouped


def _latencies(records: list[dict[str, Any]]) -> list[float]:
    return [float(record["latency_ms"]) for record in records if record.get("latency_ms")]


def _quality(records: list[dict[str, Any]]) -> list[float]:
    return [float(record["quality_score"]) for record in records if record.get("quality_score") is not None]


def statistical_tests(records: list[dict[str, Any]]) -> dict[str, Any]:
    try:
        from scipy import stats
    except ImportError:  # pragma: no cover - scipy is a declared dependency
        return {"available": False, "reason": "scipy not installed"}

    by_arch = _group(records, "architecture")
    groups = {arch: _latencies(rows) for arch, rows in by_arch.items()}
    groups = {arch: values for arch, values in groups.items() if values}

    result: dict[str, Any] = {"available": True, "alpha": ALPHA, "tests": []}

    if len(groups) >= 3:
        statistic, p_value = stats.kruskal(*groups.values())
        result["tests"].append(
            {
                "test": "Kruskal-Wallis H",
                "comparison": "latency across all architectures",
                "groups": {arch: len(values) for arch, values in groups.items()},
                "statistic": round(float(statistic), 4),
                "p_value": round(float(p_value), 6),
                "significant": bool(p_value < ALPHA),
                "note": "Omnibus test; does not identify which architectures differ.",
            }
        )

    pairs = [
        ("sequential", "react", "prompt strategy (standard vs ReAct)"),
        ("sequential", "parallel", "architecture (sequential vs parallel)"),
        ("sequential", "hierarchical", "architecture (sequential vs hierarchical)"),
        ("parallel", "hierarchical", "architecture (parallel vs hierarchical)"),
        ("react", "parallel", "architecture (ReAct vs parallel)"),
    ]
    bonferroni = ALPHA / len(pairs)
    result["bonferroni_alpha"] = round(bonferroni, 6)
    for left, right, label in pairs:
        if left not in groups or right not in groups:
            continue
        statistic, p_value = stats.mannwhitneyu(groups[left], groups[right], alternative="two-sided")
        u_max = len(groups[left]) * len(groups[right])
        result["tests"].append(
            {
                "test": "Mann-Whitney U",
                "comparison": f"{label}: {left} vs {right}",
                "n": {left: len(groups[left]), right: len(groups[right])},
                "statistic": round(float(statistic), 4),
                "u_max": float(u_max),
                "p_value": round(float(p_value), 6),
                "p_value_bonferroni": round(min(1.0, float(p_value) * len(pairs)), 6),
                "significant_after_bonferroni": bool(p_value * len(pairs) < ALPHA),
                "cliffs_delta": round(cliffs_delta(groups[left], groups[right]), 4),
                "median_ms": {left: round(statistics.median(groups[left]), 3), right: round(statistics.median(groups[right]), 3)},
            }
        )
    return result


def architecture_comparison(records: list[dict[str, Any]]) -> dict[str, Any]:
    by_arch = _group(records, "architecture")
    comparison: dict[str, Any] = {}
    for arch in ARCHITECTURES:
        rows = by_arch.get(arch, [])
        if not rows:
            continue
        successes = sum(1 for row in rows if row.get("status") == "partial")
        evidence = sum(1 for row in rows if (row.get("source_count") or 0) > 0)
        comparison[arch] = {
            "n_runs": len(rows),
            "status_counts": _counts(row.get("status") for row in rows),
            "error_category_counts": _counts(row.get("error_category") for row in rows),
            "evidence_rate": round(evidence / len(rows), 4) if rows else None,
            "evidence_rate_ci95": [round(v, 4) for v in wilson_interval(evidence, len(rows))],
            "latency_ms": descriptive(_latencies(rows)),
            "quality_score": descriptive(_quality(rows)),
            "mean_source_count": round(statistics.fmean([row.get("source_count") or 0 for row in rows]), 3),
            "backends": sorted({b for row in rows for b in (row.get("backends") or [])}),
            "mean_tool_calls": round(
                statistics.fmean([row["tool_calls"] for row in rows if row.get("tool_calls") is not None]), 3
            )
            if any(row.get("tool_calls") is not None for row in rows)
            else None,
            # The search plan is what makes the architecture difference
            # checkable: how many queries the pattern issued, whether it used
            # concurrency, how many observe→refine steps, how many delegations.
            "research_strategy_counts": _counts(
                row.get("research_strategy") for row in rows
            ),
            "mean_queries_issued": round(
                statistics.fmean(
                    [row["queries_issued"] for row in rows if row.get("queries_issued") is not None]
                ),
                3,
            )
            if any(row.get("queries_issued") is not None for row in rows)
            else None,
            "max_concurrency": max(
                (row.get("search_concurrency") or 0 for row in rows), default=0
            ),
            "max_iterations": max(
                (row.get("search_iterations") or 0 for row in rows), default=0
            ),
            "mean_delegations": round(
                statistics.fmean(
                    [row["search_delegations"] for row in rows if row.get("search_delegations") is not None]
                ),
                3,
            )
            if any(row.get("search_delegations") is not None for row in rows)
            else None,
        }
    return comparison


def _counts(values: Iterable[Any]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        key = "none" if value is None else str(value)
        counts[key] = counts.get(key, 0) + 1
    return dict(sorted(counts.items()))


def write_csv(records: list[dict[str, Any]], path: Path = DATASET_CSV_PATH) -> None:
    flat_fields = [
        "run_id", "case_id", "batch", "block_id", "persona", "query", "architecture",
        "prompt_strategy", "messaging_transport", "tool_config", "status", "error_category",
        "overall_confidence", "started_utc", "finished_utc", "latency_ms", "execution_mode",
        "llm_available", "llm_tokens_used", "estimated_cost_usd", "tool_calls", "agent_steps",
        "blackboard_reads", "blackboard_writes", "a2a_calls", "p2p_messages_sent",
        "p2p_messages_received", "dispatch_transport", "quality_score", "source_count",
        "publisher_count", "dated_fraction", "markdown_chars", "research_strategy",
        "queries_issued", "search_concurrency", "search_iterations", "search_delegations",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=flat_fields, extrasaction="ignore")
        writer.writeheader()
        for record in records:
            writer.writerow({key: record.get(key) for key in flat_fields})


# ─── plots ──────────────────────────────────────────────────────────────────

def _plt():
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    return plt


def plot_latency_by_architecture(records: list[dict[str, Any]], path: Path = BOXPLOT_LATENCY_PATH) -> str:
    plt = _plt()
    by_arch = _group(records, "architecture")
    labels = [arch for arch in ARCHITECTURES if _latencies(by_arch.get(arch, []))]
    data = [_latencies(by_arch[arch]) for arch in labels]
    if not data:
        return ""
    fig, ax = plt.subplots(figsize=(9, 5.5))
    box = ax.boxplot(data, tick_labels=labels, patch_artist=True, showmeans=True)
    for patch in box["boxes"]:
        patch.set_facecolor("#cfe3f7")
        patch.set_edgecolor("#215b8a")
    ax.set_ylabel("End-to-end latency (ms)")
    ax.set_title("Latency by architecture (each point is one real run)")
    ax.grid(axis="y", alpha=0.3)
    for index, values in enumerate(data, start=1):
        jitter = np.random.default_rng(BOOTSTRAP_SEED + index).normal(0, 0.045, len(values))
        ax.scatter(np.full(len(values), index) + jitter, values, s=14, alpha=0.65, color="#215b8a", zorder=3)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return str(path)


def plot_latency_by_persona(records: list[dict[str, Any]], path: Path = BOXPLOT_PERSONA_PATH) -> str:
    plt = _plt()
    by_persona = _group(records, "persona")
    labels = [name for name in sorted(by_persona) if _latencies(by_persona[name])]
    data = [_latencies(by_persona[name]) for name in labels]
    if not data:
        return ""
    fig, ax = plt.subplots(figsize=(9, 5.5))
    box = ax.boxplot(data, tick_labels=labels, patch_artist=True, showmeans=True)
    for patch in box["boxes"]:
        patch.set_facecolor("#e6f0d9")
        patch.set_edgecolor("#4d6b2a")
    ax.set_ylabel("End-to-end latency (ms)")
    ax.set_title("Latency by persona")
    ax.grid(axis="y", alpha=0.3)
    plt.setp(ax.get_xticklabels(), rotation=15, ha="right")
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return str(path)


def plot_quality_by_architecture(records: list[dict[str, Any]], path: Path = BOXPLOT_QUALITY_PATH) -> str:
    plt = _plt()
    by_arch = _group(records, "architecture")
    labels = [arch for arch in ARCHITECTURES if _quality(by_arch.get(arch, []))]
    data = [_quality(by_arch[arch]) for arch in labels]
    if not data:
        return ""
    fig, ax = plt.subplots(figsize=(9, 5.5))
    box = ax.boxplot(data, tick_labels=labels, patch_artist=True, showmeans=True)
    for patch in box["boxes"]:
        patch.set_facecolor("#f7e2c3")
        patch.set_edgecolor("#8a5b21")
    ax.set_ylabel("Evidence-quality score (0-1)")
    ax.set_ylim(-0.02, 1.05)
    ax.set_title("Evidence-quality rubric score by architecture")
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return str(path)


def plot_evidence_rate(records: list[dict[str, Any]], path: Path = EVIDENCE_CHART_PATH) -> str:
    plt = _plt()
    by_arch = _group(records, "architecture")
    labels, rates, errors = [], [], []
    for arch in ARCHITECTURES:
        rows = by_arch.get(arch, [])
        if not rows:
            continue
        evidence = sum(1 for row in rows if (row.get("source_count") or 0) > 0)
        low, high = wilson_interval(evidence, len(rows))
        labels.append(arch)
        rates.append(evidence / len(rows))
        errors.append([max(0.0, rates[-1] - low), max(0.0, high - rates[-1])])
    if not labels:
        return ""
    fig, ax = plt.subplots(figsize=(9, 5))
    positions = np.arange(len(labels))
    ax.bar(positions, rates, color="#215b8a", alpha=0.85, yerr=np.array(errors).T, capsize=6)
    ax.set_xticks(positions)
    ax.set_xticklabels(labels)
    ax.set_ylim(0, 1.08)
    ax.set_ylabel("Fraction of runs with retrieved sources")
    ax.set_title("Evidence retrieval rate by architecture (95% Wilson interval)")
    ax.grid(axis="y", alpha=0.3)
    for index, rate in enumerate(rates):
        ax.text(index, min(1.02, rate + 0.04), f"{rate:.0%}", ha="center", fontsize=9)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return str(path)


def plot_agent_heatmap(path: Path = HEATMAP_PATH) -> str:
    """Agent-level heatmap from callback telemetry (real, per-batch aggregated)."""
    plt = _plt()
    metrics_files = sorted(OUTPUT_DIR.glob("agent_metrics_*.json"))
    if not metrics_files:
        return ""
    merged: dict[str, dict[str, Any]] = {}
    for file in metrics_files:
        payload = json.loads(file.read_text(encoding="utf-8"))
        for agent, values in (payload.get("agents") or {}).items():
            target = merged.setdefault(
                agent,
                {"steps": 0, "tool_calls": 0, "errors": 0, "total_latency_ms": 0.0},
            )
            for key in ("steps", "tool_calls", "errors"):
                target[key] += int(values.get(key) or 0)
            target["total_latency_ms"] += float(values.get("total_latency_ms") or 0.0)

    if not merged:
        return ""

    agents = sorted(merged)
    metric_labels = ["Steps", "Tool calls", "Errors", "Agent latency (s)"]
    matrix = np.array(
        [
            [
                merged[agent]["steps"],
                merged[agent]["tool_calls"],
                merged[agent]["errors"],
                merged[agent]["total_latency_ms"] / 1000.0,
            ]
            for agent in agents
        ],
        dtype=float,
    )
    normalised = matrix.copy()
    for column in range(normalised.shape[1]):
        maximum = normalised[:, column].max()
        normalised[:, column] = normalised[:, column] / maximum if maximum > 0 else 0.0

    fig, ax = plt.subplots(figsize=(10, 6))
    image = ax.imshow(normalised, cmap="YlOrRd", aspect="auto", vmin=0, vmax=1)
    ax.set_xticks(range(len(metric_labels)))
    ax.set_xticklabels(metric_labels)
    ax.set_yticks(range(len(agents)))
    ax.set_yticklabels(agents)
    for row in range(len(agents)):
        for column in range(len(metric_labels)):
            raw_value = matrix[row, column]
            ax.text(
                column,
                row,
                f"{raw_value:.0f}",
                ha="center",
                va="center",
                fontsize=8,
                color="white" if normalised[row, column] > 0.55 else "black",
            )
    ax.set_title("Per-agent telemetry heatmap (real callbacks, summed across runs; LLM tokens n/a offline)")
    fig.colorbar(image, ax=ax, label="Normalised intensity")
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return str(path)


# ─── report ─────────────────────────────────────────────────────────────────

def _fmt(value: Any, digits: int = 1) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, float):
        return f"{value:.{digits}f}"
    return str(value)


def write_report(
    records: list[dict[str, Any]],
    summary: dict[str, Any],
    tests: dict[str, Any],
    comparison: dict[str, Any],
    plots: dict[str, str],
    path: Path = REPORT_PATH,
) -> str:
    dataset_meta = load_meta()
    environment = environment_metadata(summary.get("model_available", False))
    status_counts = summary["status_counts"]
    lines: list[str] = []
    lines.append("# MindSpace evaluation report\n")
    lines.append(f"Generated: {datetime.now(timezone.utc).isoformat()}\n")
    lines.append("## How to reproduce\n")
    lines.append("```bash")
    lines.append("cd apps/api")
    lines.append("python -m mas.run_evaluation --batch core-p2p")
    lines.append("python -m mas.run_evaluation --batch a2a   # requires the A2A server")
    lines.append("python -m mas.run_evaluation --analyse-only")
    lines.append("```\n")
    lines.append("## Dataset\n")
    lines.append(f"- Version: `{dataset_meta.get('dataset_version')}`")
    lines.append(f"- SHA-256 of cases: `{dataset_meta.get('sha256')}`")
    lines.append(f"- Cases recorded in raw results: {summary['n_runs']} runs")
    lines.append("- Design: matched blocks. Each block fixes persona, query and tool configuration, then repeats across architectures.\n")
    lines.append("## Execution mode (read this before interpreting numbers)\n")
    lines.append(f"- Mode: **{environment['execution_mode']}**")
    lines.append(f"- Model provider: {record_model_provider(records)}")
    lines.append(f"- {environment['note']}\n")
    lines.append("## Results summary\n")
    lines.append(f"- Runs: **{summary['n_runs']}**")
    lines.append(f"- Status: {', '.join(f'{key}={value}' for key, value in status_counts.items())}")
    lines.append(f"- Evidence retrieval rate: **{summary['evidence_rate']:.1%}** (95% CI {summary['evidence_rate_ci95'][0]:.1%}–{summary['evidence_rate_ci95'][1]:.1%})")
    latency = summary["latency_ms"]
    lines.append(
        f"- Latency: mean {_fmt(latency['mean'])} ms, median {_fmt(latency['median'])} ms, "
        f"p95 {_fmt(latency['p95'])} ms (95% CI of mean {_fmt(latency['mean_ci95'][0])}–{_fmt(latency['mean_ci95'][1])} ms)"
    )
    lines.append(f"- Evidence-quality score: mean {_fmt(summary['quality_score']['mean'], 3)}\n")

    lines.append("## Architecture comparison\n")
    lines.append("| Architecture | Runs | Evidence rate | Latency median (ms) | Latency mean (ms) | Quality (mean) | Mean sources |")
    lines.append("|---|---|---|---|---|---|---|")
    for arch, data in comparison.items():
        lines.append(
            f"| {arch} | {data['n_runs']} | {data['evidence_rate']:.1%} | "
            f"{_fmt(data['latency_ms']['median'])} | {_fmt(data['latency_ms']['mean'])} | "
            f"{_fmt(data['quality_score']['mean'], 3)} | {_fmt(data['mean_source_count'], 2)} |"
        )
    lines.append("")

    lines.append("## Search plan per architecture\n")
    lines.append(
        "The control flow each architecture actually executed, read back from the evidence payload of "
        "every run. This is the mechanism behind the numbers above; it is recorded so the comparison can "
        "be checked against the dataset instead of taken on trust.\n"
    )
    lines.append("| Architecture | Strategy | Mean queries issued | Max concurrency | Max refine iterations | Mean delegations |")
    lines.append("|---|---|---|---|---|---|")
    for arch, data in comparison.items():
        strategies = ", ".join(
            f"{name}×{count}" for name, count in (data.get("research_strategy_counts") or {}).items()
        ) or "n/a"
        lines.append(
            f"| {arch} | {strategies} | {_fmt(data.get('mean_queries_issued'), 2)} | "
            f"{data.get('max_concurrency')} | {data.get('max_iterations')} | "
            f"{_fmt(data.get('mean_delegations'), 2)} |"
        )
    lines.append("")

    lines.append("## Statistical tests\n")
    if not tests.get("available"):
        lines.append(f"Not run: {tests.get('reason')}.\n")
    else:
        lines.append(f"Alpha = {ALPHA}; pairwise tests use Bonferroni correction across {len(tests['tests']) - 1} comparisons.")
        lines.append("")
        lines.append("| Test | Comparison | n | Statistic | p | Significant | Cliff's delta |")
        lines.append("|---|---|---|---|---|---|---|")
        for test in tests["tests"]:
            comparisons = test.get("n") or test.get("groups") or {}
            n_text = ", ".join(f"{key}={value}" for key, value in comparisons.items())
            significant = test.get("significant") or test.get("significant_after_bonferroni")
            lines.append(
                f"| {test['test']} | {test['comparison']} | {n_text} | {test['statistic']} | "
                f"{test['p_value']} | {'yes' if significant else 'no'} | {_fmt(test.get('cliffs_delta'), 3)} |"
            )
        lines.append("")
        lines.append(
            "Interpretation rule used here: a difference is only called an architecture effect when the "
            "Bonferroni-corrected p-value is below alpha. In offline mode the dominant latency term is "
            "network search, so absence of a significant difference is the expected and honest result.\n"
        )

    lines.append("## Quality rubric\n")
    lines.append(f"Rubric version `{QUALITY_RUBRIC['version']}`. {QUALITY_RUBRIC['description']}\n")
    lines.append("| Criterion | Weight | Rule | Mean score |")
    lines.append("|---|---|---|---|")
    for criterion, spec in QUALITY_RUBRIC["criteria"].items():
        mean_value = statistics.fmean(
            [float(record["quality_criteria"][criterion]) for record in records if record.get("quality_criteria")]
        ) if any(record.get("quality_criteria") for record in records) else 0.0
        lines.append(f"| {criterion} | {spec['weight']} | {spec['rule']} | {mean_value:.3f} |")
    lines.append("")

    lines.append("## Artifacts\n")
    for label, file_path in plots.items():
        if file_path:
            lines.append(f"- {label}: `{file_path}`")
    lines.append(f"- Raw runs (immutable input to this report): `{RAW_RUNS_PATH}`")
    lines.append(f"- Derived table: `{DATASET_CSV_PATH}`")
    lines.append(f"- Architecture comparison JSON: `{ARCH_COMPARISON_PATH}`")
    lines.append(f"- Machine-readable summary: `{SUMMARY_PATH}`\n")

    lines.append("## Failed and blocked runs\n")
    failed = [record for record in records if record.get("status") in {"error", "blocked"}]
    if not failed:
        lines.append("None. All recorded runs reached at least partial status.")
    else:
        lines.append("| Case | Architecture | Status | Error category | Detail |")
        lines.append("|---|---|---|---|---|")
        for record in failed:
            detail = (record.get("exception") or "; ".join(record.get("execution_errors") or []))[:160]
            lines.append(
                f"| {record['case_id']} | {record['architecture']} | {record['status']} | "
                f"{record.get('error_category')} | {detail.replace('|', '/')} |"
            )
    lines.append("")
    lines.append("## Limitations\n")
    lines.append("- No live model key was available, so no LLM inference, tokens or cost are reported. Token/cost columns are `null`, not zero.")
    lines.append("- Downloaded search results are real, but news-feed backends are inherently time-dependent: reruns on a later date will retrieve different items and therefore different source counts.")
    lines.append("- Quality scores measure structural evidence quality, not analytical correctness. They must not be read as a measure of insight.")
    lines.append("- The A2A batch is small (one matched block) and is evidence of protocol integration, not a powered architecture comparison.")
    lines.append(
        "- Agent telemetry for the A2A batch covers only the client-side orchestrator and report agent. "
        "The researcher runs inside the separate A2A server process, whose callbacks are not visible to "
        "the harness; the core batch covers all three agents."
    )
    lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")
    return str(path)


def record_model_provider(records: list[dict[str, Any]]) -> str:
    providers = sorted({str(record.get("model_provider")) for record in records if record.get("model_provider")})
    return ", ".join(providers) if providers else "none (offline-deterministic execution)"


def analyse(records: list[dict[str, Any]]) -> dict[str, Any]:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    latencies = _latencies(records)
    evidence = sum(1 for record in records if (record.get("source_count") or 0) > 0)
    tests = statistical_tests(records)
    comparison = architecture_comparison(records)
    plots = {
        "Latency boxplot by architecture": plot_latency_by_architecture(records),
        "Latency boxplot by persona": plot_latency_by_persona(records),
        "Quality boxplot by architecture": plot_quality_by_architecture(records),
        "Evidence-rate bar chart": plot_evidence_rate(records),
        "Per-agent telemetry heatmap": plot_agent_heatmap(),
    }
    summary = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "dataset_version": load_meta().get("dataset_version"),
        "n_runs": len(records),
        "model_available": any(bool(record.get("llm_available")) for record in records),
        "status_counts": _counts(record.get("status") for record in records),
        "error_category_counts": _counts(record.get("error_category") for record in records),
        "batch_counts": _counts(record.get("batch") for record in records),
        "architecture_counts": _counts(record.get("architecture") for record in records),
        "persona_counts": _counts(record.get("persona") for record in records),
        "prompt_strategy_counts": _counts(record.get("prompt_strategy") for record in records),
        "transport_counts": _counts(record.get("dispatch_transport") for record in records),
        "evidence_rate": round(evidence / len(records), 4) if records else 0.0,
        "evidence_rate_ci95": [round(value, 4) for value in wilson_interval(evidence, len(records))],
        "latency_ms": descriptive(latencies),
        "quality_score": descriptive(_quality(records)),
        "source_count": descriptive([float(record.get("source_count") or 0) for record in records]),
        "llm_tokens_used": None,
        "estimated_cost_usd": None,
        "architecture_comparison": comparison,
        "statistical_tests": tests,
        "plots": plots,
        "environment": environment_metadata(any(bool(record.get("llm_available")) for record in records)),
    }
    SUMMARY_PATH.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    ARCH_COMPARISON_PATH.write_text(json.dumps(comparison, indent=2), encoding="utf-8")
    write_csv(records)
    write_report(records, summary, tests, comparison, plots)
    return summary
