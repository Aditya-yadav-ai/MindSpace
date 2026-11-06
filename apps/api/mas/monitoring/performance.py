"""
Performance evaluation engine (Requirement #10).

Collects metrics per run:
- Latency, token usage, cost estimation
- Generates 40-run dataset and boxplots
"""
from __future__ import annotations
import csv
import json
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Groq pricing (as of 2025): llama3-8b = $0.05/1M tokens
GROQ_COST_PER_1K_TOKENS = 0.00005  # $0.05 per 1M = $0.00005 per 1K


class PerformanceCollector:
    """
    Collects and persists performance metrics for every MAS run.
    Generates CSV datasets and boxplot visualizations.
    """

    def __init__(self, results_csv: str, boxplot_png: str, report_md: str):
        self.results_csv = Path(results_csv)
        self.boxplot_png = Path(boxplot_png)
        self.report_md = Path(report_md)
        self.results_csv.parent.mkdir(parents=True, exist_ok=True)

        # Initialize CSV if it doesn't exist
        if not self.results_csv.exists():
            self._init_csv()

    def _init_csv(self):
        with open(self.results_csv, "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow([
                "run_id", "run_number", "persona", "architecture",
                "query", "latency_ms", "tokens_used", "estimated_cost_usd",
                "tool_calls", "guardrail_flags", "confidence",
                "status", "error", "timestamp",
            ])

    def record_run(self, run: Dict[str, Any]) -> None:
        """Append a single run's metrics to the CSV dataset."""
        with open(self.results_csv, "a", newline="") as f:
            writer = csv.writer(f)
            writer.writerow([
                run.get("run_id", ""),
                run.get("run_number", 0),
                run.get("persona", ""),
                run.get("architecture", ""),
                run.get("query", "")[:100],
                round(run.get("latency_ms", 0), 2),
                run.get("tokens_used", 0),
                round(run.get("estimated_cost_usd", 0), 6),
                run.get("tool_calls", 0),
                run.get("guardrail_flags", 0),
                round(run.get("confidence", 0.5), 3),
                run.get("status", "unknown"),
                run.get("error", ""),
                datetime.utcnow().isoformat(),
            ])
        logger.debug(f"[Perf] Recorded run #{run.get('run_number')}")

    @staticmethod
    def estimate_cost(tokens: int) -> float:
        """Estimate cost in USD for a given token count."""
        return tokens * GROQ_COST_PER_1K_TOKENS / 1000

    def load_results(self) -> List[Dict]:
        """Load all results from CSV."""
        if not self.results_csv.exists():
            return []
        results = []
        with open(self.results_csv, "r") as f:
            reader = csv.DictReader(f)
            for row in reader:
                results.append({
                    "run_id": row["run_id"],
                    "run_number": int(row["run_number"]),
                    "persona": row["persona"],
                    "architecture": row["architecture"],
                    "query": row["query"],
                    "latency_ms": float(row["latency_ms"]),
                    "tokens_used": int(row["tokens_used"]),
                    "estimated_cost_usd": float(row["estimated_cost_usd"]),
                    "tool_calls": int(row["tool_calls"]),
                    "guardrail_flags": int(row["guardrail_flags"]),
                    "confidence": float(row["confidence"]),
                    "status": row["status"],
                    "error": row["error"],
                })
        return results

    def generate_boxplot(self) -> Optional[str]:
        """
        Generate boxplot from collected results (Requirement #10).
        Shows latency distribution by persona and architecture.
        """
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            import numpy as np
        except ImportError:
            logger.warning("matplotlib not available for boxplot")
            return None

        results = self.load_results()
        if not results:
            logger.warning("No results to plot")
            return None

        personas = list(set(r["persona"] for r in results))
        architectures = list(set(r["architecture"] for r in results))

        fig, axes = plt.subplots(1, 3, figsize=(18, 6))
        fig.suptitle("MAS Performance Evaluation — 40 Runs\nE-commerce Intelligence System",
                     fontsize=14, fontweight="bold", y=1.02)

        # ── Plot 1: Latency by Persona ──
        ax1 = axes[0]
        persona_latencies = []
        persona_labels = []
        for p in sorted(personas):
            lats = [r["latency_ms"] for r in results if r["persona"] == p and r["status"] != "blocked"]
            if lats:
                persona_latencies.append(lats)
                persona_labels.append(p[:12])
        if persona_latencies:
            bp1 = ax1.boxplot(persona_latencies, tick_labels=persona_labels, patch_artist=True)
            colors = ["#4ECDC4", "#FF6B6B", "#45B7D1", "#96CEB4", "#FFEAA7"]
            for patch, color in zip(bp1["boxes"], colors[:len(bp1["boxes"])]):
                patch.set_facecolor(color)
                patch.set_alpha(0.7)
        ax1.set_title("Latency by Persona", fontweight="bold")
        ax1.set_ylabel("Latency (ms)")
        ax1.set_xlabel("Persona")
        ax1.tick_params(axis="x", rotation=30)
        ax1.grid(True, alpha=0.3)

        # ── Plot 2: Latency by Architecture ──
        ax2 = axes[1]
        arch_latencies = []
        arch_labels = []
        for a in sorted(architectures):
            lats = [r["latency_ms"] for r in results if r["architecture"] == a and r["status"] != "blocked"]
            if lats:
                arch_latencies.append(lats)
                arch_labels.append(a)
        if arch_latencies:
            bp2 = ax2.boxplot(arch_latencies, tick_labels=arch_labels, patch_artist=True)
            colors2 = ["#A29BFE", "#FD79A8", "#FDCB6E", "#6C5CE7"]
            for patch, color in zip(bp2["boxes"], colors2[:len(bp2["boxes"])]):
                patch.set_facecolor(color)
                patch.set_alpha(0.7)
        ax2.set_title("Latency by Architecture", fontweight="bold")
        ax2.set_ylabel("Latency (ms)")
        ax2.set_xlabel("Architecture Pattern")
        ax2.grid(True, alpha=0.3)

        # ── Plot 3: Cost Distribution ──
        ax3 = axes[2]
        all_costs = [r["estimated_cost_usd"] * 1000 for r in results]  # in mUSD
        if all_costs:
            ax3.hist(all_costs, bins=min(20, len(all_costs)),
                     color="#00B894", alpha=0.7, edgecolor="white")
            ax3.axvline(x=float(np.mean(all_costs)), color="red", linestyle="--",
                        label=f"Mean: ${np.mean(all_costs):.3f}m")
        ax3.set_title("Cost Distribution (milli-USD)", fontweight="bold")
        ax3.set_xlabel("Estimated Cost (milli-USD)")
        ax3.set_ylabel("Frequency")
        ax3.legend()
        ax3.grid(True, alpha=0.3)

        plt.tight_layout()
        plt.savefig(str(self.boxplot_png), dpi=150, bbox_inches="tight")
        plt.close()
        logger.info(f"[Perf] Boxplot saved: {self.boxplot_png}")
        return str(self.boxplot_png)

    def generate_markdown_report(self) -> str:
        """Generate a comprehensive performance report in Markdown."""
        results = self.load_results()
        if not results:
            return "# No results available yet\n"

        total = len(results)
        success = sum(1 for r in results if r["status"] == "success")
        blocked = sum(1 for r in results if r["status"] == "blocked")
        errors = sum(1 for r in results if r["status"] == "error")

        latencies = [r["latency_ms"] for r in results if r["status"] != "blocked"]
        tokens = [r["tokens_used"] for r in results]
        costs = [r["estimated_cost_usd"] for r in results]

        try:
            import numpy as np
            lat_arr = np.array(latencies) if latencies else np.array([0])
            tok_arr = np.array(tokens)
            cost_arr = np.array(costs)

            lat_stats = {
                "mean": float(np.mean(lat_arr)), "std": float(np.std(lat_arr)),
                "min": float(np.min(lat_arr)), "max": float(np.max(lat_arr)),
                "p50": float(np.percentile(lat_arr, 50)),
                "p95": float(np.percentile(lat_arr, 95)),
            }
        except Exception:
            lat_stats = {"mean": 0, "std": 0, "min": 0, "max": 0, "p50": 0, "p95": 0}

        # Per-persona breakdown
        personas = list(set(r["persona"] for r in results))
        persona_table = []
        for p in sorted(personas):
            p_results = [r for r in results if r["persona"] == p]
            p_lats = [r["latency_ms"] for r in p_results if r["status"] != "blocked"]
            p_success = sum(1 for r in p_results if r["status"] == "success")
            p_blocked = sum(1 for r in p_results if r["status"] == "blocked")
            try:
                import numpy as np
                p_mean_lat = float(np.mean(p_lats)) if p_lats else 0
            except Exception:
                p_mean_lat = sum(p_lats) / len(p_lats) if p_lats else 0
            persona_table.append(f"| {p} | {len(p_results)} | {p_success} | {p_blocked} | {p_mean_lat:.0f}ms |")

        report = f"""# MAS Performance Evaluation Report

**Generated**: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}  
**System**: E-commerce Multi-Agent Intelligence System  
**Frameworks**: CrewAI + Google ADK  
**LLM**: Groq (llama3-8b-8192)  

## Summary

| Metric | Value |
|--------|-------|
| Total Runs | {total} |
| Successful | {success} ({success/total:.0%}) |
| Blocked (Guardrail) | {blocked} ({blocked/total:.0%}) |
| Errors | {errors} ({errors/total:.0%}) |
| Total Tokens | {sum(tokens):,} |
| Total Cost (est.) | ${sum(costs):.4f} |
| Avg Cost/Run | ${sum(costs)/total:.4f} |

## Latency Statistics (ms)

| Statistic | Value |
|-----------|-------|
| Mean | {lat_stats['mean']:.0f}ms |
| Std Dev | {lat_stats['std']:.0f}ms |
| Min | {lat_stats['min']:.0f}ms |
| Max | {lat_stats['max']:.0f}ms |
| P50 (Median) | {lat_stats['p50']:.0f}ms |
| P95 | {lat_stats['p95']:.0f}ms |

## Per-Persona Breakdown

| Persona | Runs | Success | Blocked | Avg Latency |
|---------|------|---------|---------|-------------|
{chr(10).join(persona_table)}

## Architectural Comparison

| Architecture | Description | Avg Latency | Use Case |
|-------------|-------------|-------------|----------|
| `react` | ReAct reasoning loops | Higher (more steps) | Complex queries |
| `sequential` | Linear pipeline | Lower (direct) | Simple lookups |
| `hierarchical` | Orchestrator + workers | Medium | Structured tasks |
| `parallel` | Concurrent agents | Low (wall-clock) | Independent tasks |

## Messaging Architecture Comparison

| Pattern | Pros | Cons | When Used |
|---------|------|------|----------|
| **Blackboard** | Shared context, audit trail, decoupled | Central bottleneck | All inter-agent data sharing |
| **P2P (A2A)** | Low latency, targeted | Tight coupling | Urgent agent-to-agent calls |
| **Sequential** | Simple, predictable | Slow, no parallelism | Simple pipelines |
| **Hierarchical** | Clear authority, delegation | Single point of failure | Orchestrated workflows |

## Guardrail Statistics

| Check | Triggered | Blocked |
|-------|-----------|--------|
| Toxicity Detection | {sum(1 for r in results if r['guardrail_flags'] > 0)} | {blocked} |
| Prompt Injection | See audit trail | See audit trail |

---
*MAS E-commerce Intelligence System | CrewAI + Google ADK | Groq LLM*
"""
        with open(self.report_md, "w") as f:
            f.write(report)
        logger.info(f"[Perf] Report saved: {self.report_md}")
        return report
