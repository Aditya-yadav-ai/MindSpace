"""Evaluation harness: executes dataset cases and records raw evidence.

Every record is written to JSONL *immediately* after a run so a crash or a
Ctrl-C cannot silently drop failed runs. Nothing is imputed: unavailable
values (e.g. LLM tokens when no model key exists) are recorded as ``null``
with an explicit ``*_available: false`` flag, never as zero.
"""
from __future__ import annotations

import json
import logging
import platform
import re
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

OUTPUT_DIR = Path(__file__).resolve().parents[1] / "outputs" / "evaluation"
RAW_RUNS_PATH = OUTPUT_DIR / "raw_runs.jsonl"
AGENT_METRICS_PATH = OUTPUT_DIR / "agent_metrics.json"
RUBRIC_PATH = OUTPUT_DIR / "quality_rubric.json"
SHUFFLE_SEED = 20261025

QUALITY_RUBRIC = {
    "version": "1.0.0",
    "description": (
        "Structural evidence-quality rubric. It scores the presence and "
        "provenance of retrieved evidence and the completeness of the rendered "
        "report. It is NOT a semantic judgement of analytical insight, and it "
        "does not reward invention."
    ),
    "criteria": {
        "evidence_present": {"weight": 0.30, "rule": "market_research parsed from validated evidence"},
        "source_count": {"weight": 0.20, "rule": "min(distinct_sources / 3, 1)"},
        "publisher_diversity": {"weight": 0.15, "rule": "min(distinct_publishers / 2, 1)"},
        "dated_sources": {"weight": 0.10, "rule": "fraction of sources with an ISO publication date"},
        "report_sections": {"weight": 0.15, "rule": "fraction of required markdown sections present"},
        "clean_execution": {"weight": 0.10, "rule": "1.0 when no execution errors were recorded"},
    },
}

REQUIRED_SECTIONS = ("Executive Summary", "Market Research", "Sources")


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _git_head() -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=15,
            cwd=str(Path(__file__).resolve().parents[3]),
        )
        return result.stdout.strip() if result.returncode == 0 else "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def _parse_sources(market_research: Any) -> dict[str, Any]:
    """Extract source provenance from the validated market research evidence."""
    sources: list[str] = []
    publishers: set[str] = set()
    dated = 0
    raw_rows: list[dict[str, Any]] = []
    if market_research is None:
        return {
            "source_count": 0,
            "publisher_count": 0,
            "dated_source_count": 0,
            "dated_fraction": 0.0,
            "backends": [],
            "raw_rows": raw_rows,
        }

    sources = list(getattr(market_research, "sources", []) or [])
    raw_search_data = getattr(market_research, "raw_search_data", None)
    if raw_search_data:
        try:
            payload = json.loads(raw_search_data)
        except (json.JSONDecodeError, TypeError):
            payload = {}
        if isinstance(payload, dict):
            raw_rows = [row for row in payload.get("results", []) or [] if isinstance(row, dict)]
    for row in raw_rows:
        publisher = str(row.get("source") or "").strip()
        if publisher:
            publishers.add(publisher.lower())
        if str(row.get("published") or "").strip():
            dated += 1
    if not sources and raw_rows:
        sources = [str(row.get("url", "")) for row in raw_rows if row.get("url")]
    backends: list[str] = []
    if raw_search_data:
        try:
            payload = json.loads(raw_search_data)
            backends = [str(b) for b in (payload.get("backends") or [])]
        except (json.JSONDecodeError, TypeError):
            backends = []
    return {
        "source_count": len({source for source in sources if source}),
        "publisher_count": len(publishers),
        "dated_source_count": dated,
        "dated_fraction": round(dated / len(raw_rows), 4) if raw_rows else 0.0,
        "backends": backends,
        "raw_rows": raw_rows,
    }


def _sections_present(markdown: str) -> tuple[float, list[str]]:
    present = [name for name in REQUIRED_SECTIONS if name.lower() in markdown.lower()]
    return (len(present) / len(REQUIRED_SECTIONS) if REQUIRED_SECTIONS else 0.0), present


def score_quality(
    market_research: Any, markdown: str, execution_errors: list[str]
) -> dict[str, Any]:
    provenance = _parse_sources(market_research)
    section_fraction, sections_present = _sections_present(markdown)
    criteria = {
        "evidence_present": 1.0 if market_research is not None else 0.0,
        "source_count": min(provenance["source_count"] / 3.0, 1.0),
        "publisher_diversity": min(provenance["publisher_count"] / 2.0, 1.0),
        "dated_sources": provenance["dated_fraction"],
        "report_sections": section_fraction,
        "clean_execution": 0.0 if execution_errors else 1.0,
    }
    weights = {key: spec["weight"] for key, spec in QUALITY_RUBRIC["criteria"].items()}
    total = sum(criteria[key] * weights[key] for key in criteria)
    return {
        "quality_score": round(total, 4),
        "quality_criteria": {key: round(value, 4) for key, value in criteria.items()},
        "sections_present": sections_present,
        **{k: provenance[k] for k in ("source_count", "publisher_count", "dated_fraction", "backends")},
    }


def _error_category(status: str, errors: list[str], exception: str | None) -> str | None:
    if exception:
        return "exception"
    if status == "blocked":
        return "guardrail_block"
    if status in {"success", "partial"} and not errors:
        return None
    joined = " ".join(errors).lower()
    if "blocked by guardrails" in joined:
        return "guardrail_block"
    if "no results" in joined or "search" in joined:
        return "search_unavailable"
    if "invalid market research" in joined:
        return "evidence_invalid"
    if status == "error":
        return "pipeline_error"
    return None


def _research_provenance(market_research: Any) -> dict[str, Any]:
    """Extract the architecture's search plan from the evidence payload.

    The four architectures issue different numbers of queries, use different
    concurrency, and take different numbers of observe→refine steps. Recording
    that per run is what makes the architecture comparison checkable instead of
    a claim: ``results_dataset.csv`` then shows *why* one pattern retrieved more
    sources than another.
    """
    empty = {
        "research_strategy": None,
        "queries_issued": None,
        "search_concurrency": None,
        "search_iterations": None,
        "search_delegations": None,
    }
    raw = getattr(market_research, "raw_search_data", None)
    if not isinstance(raw, str) or not raw:
        return empty
    try:
        payload = json.loads(raw)
    except (ValueError, TypeError):
        return empty
    if not isinstance(payload, dict):
        return empty
    issued = payload.get("queries_issued")
    return {
        "research_strategy": payload.get("strategy"),
        "queries_issued": len(issued) if isinstance(issued, list) else None,
        "search_concurrency": payload.get("concurrency"),
        "search_iterations": payload.get("iterations"),
        "search_delegations": payload.get("delegations"),
    }


def run_case(
    case: dict[str, Any],
    orchestrator: Any,
    *,
    run_index: int,
    total: int,
    model_available: bool,
) -> dict[str, Any]:
    """Execute one case and return a complete, honest record."""
    started_iso = _iso_now()
    wall_start = time.perf_counter()
    status = "error"
    confidence = 0.0
    markdown = ""
    market_research = None
    metadata: dict[str, Any] = {}
    exception_text: str | None = None
    errors: list[str] = []

    logger.info(
        "[%s/%s] %s persona=%s arch=%s query=%r",
        run_index,
        total,
        case["case_id"],
        case["persona"],
        case["architecture"],
        case["query"][:60],
    )
    try:
        report = orchestrator.run(
            query=case["query"],
            persona=case["persona"],
            architecture=case["architecture"],
            use_a2a=case["messaging_transport"] == "a2a",
        )
        status = report.status
        confidence = float(report.overall_confidence or 0.0)
        markdown = report.markdown_report or ""
        market_research = report.market_research
        meta = report.execution_metadata
        errors = [str(error) for error in (meta.errors or [])]
        metadata = {
            "report_id": report.report_id,
            "metadata_latency_ms": round(float(meta.total_latency_ms or 0.0), 3),
            "llm_tokens_used": meta.llm_tokens_used if model_available else None,
            "estimated_cost_usd": meta.estimated_cost_usd if model_available else None,
            "tool_calls": meta.tool_calls,
            "agent_steps": meta.agent_steps,
            "blackboard_reads": meta.blackboard_reads,
            "blackboard_writes": meta.blackboard_writes,
            "a2a_calls": meta.a2a_calls,
            "p2p_messages_sent": meta.p2p_messages_sent,
            "p2p_messages_received": meta.p2p_messages_received,
            "dispatch_transport": meta.dispatch_transport,
        }
    except Exception as error:  # noqa: BLE001 - failures are recorded, not hidden
        exception_text = f"{type(error).__name__}: {error}"
        logger.exception("[%s] run failed", case["case_id"])

    wall_latency_ms = (time.perf_counter() - wall_start) * 1000.0
    quality = score_quality(market_research, markdown, errors)
    record = {
        "run_id": str(uuid.uuid4()),
        "case_id": case["case_id"],
        "batch": case["batch"],
        "block_id": case["block_id"],
        "persona": case["persona"],
        "query": case["query"],
        "architecture": case["architecture"],
        "prompt_strategy": case["prompt_strategy"],
        "messaging_transport": case["messaging_transport"],
        "tool_config": case["tool_config"],
        "status": status,
        "error_category": _error_category(status, errors, exception_text),
        "exception": exception_text,
        "execution_errors": errors,
        "overall_confidence": confidence,
        "started_utc": started_iso,
        "finished_utc": _iso_now(),
        "latency_ms": round(wall_latency_ms, 3),
        "model_provider": "groq" if model_available else None,
        "model_id": None,
        "execution_mode": "live-model" if model_available else "offline-deterministic",
        "llm_available": model_available,
        "llm_tokens_used": metadata.get("llm_tokens_used"),
        "estimated_cost_usd": metadata.get("estimated_cost_usd"),
        "tool_calls": metadata.get("tool_calls"),
        "agent_steps": metadata.get("agent_steps"),
        "blackboard_reads": metadata.get("blackboard_reads"),
        "blackboard_writes": metadata.get("blackboard_writes"),
        "a2a_calls": metadata.get("a2a_calls"),
        "p2p_messages_sent": metadata.get("p2p_messages_sent"),
        "p2p_messages_received": metadata.get("p2p_messages_received"),
        "dispatch_transport": metadata.get("dispatch_transport"),
        "report_id": metadata.get("report_id"),
        "markdown_chars": len(markdown),
        **_research_provenance(market_research),
        **quality,
    }
    return record


def snapshot_agent_metrics(callback_manager: Any) -> dict[str, Any]:
    snapshot: dict[str, Any] = {}
    for name, metrics in dict(callback_manager.metrics).items():
        snapshot[name] = {
            "steps": len(metrics.steps),
            "tool_calls": len(metrics.tool_calls),
            "errors": len(metrics.errors),
            "total_latency_ms": round(float(metrics.total_latency_ms), 3),
            "total_tokens": metrics.total_tokens or None,
        }
    return snapshot


def run_batch(
    cases: list[dict[str, Any]],
    *,
    batch: str,
    output_path: Path = RAW_RUNS_PATH,
    session_label: str = "evaluation",
) -> list[dict[str, Any]]:
    """Run every case in ``batch`` and append records to ``output_path``."""
    import random

    from mas.agents.adk_agents.orchestrator import ADKOrchestrator
    from mas.agents.adk_agents.runtime import adk_available
    from mas.blackboard.shared_state import get_blackboard
    from mas.config import config
    from mas.monitoring.callbacks import MASCallbackManager
    from mas.monitoring.performance import PerformanceCollector

    selected = [case for case in cases if case["batch"] == batch]
    if not selected:
        raise ValueError(f"No cases found for batch {batch!r}")
    # Fixed-seed shuffle: architecture order inside each block must not be
    # confounded with time-varying network conditions. The seed is recorded so
    # the order is reproducible.
    random.Random(SHUFFLE_SEED).shuffle(selected)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    model_available = bool(adk_available())
    blackboard = get_blackboard()
    callback_manager = MASCallbackManager(session_label, str(OUTPUT_DIR))
    performance = PerformanceCollector(
        results_csv=str(OUTPUT_DIR / f"tool_level_metrics_{batch}.csv"),
        boxplot_png=str(OUTPUT_DIR / f"unused_boxplot_{batch}.png"),
        report_md=str(OUTPUT_DIR / f"unused_report_{batch}.md"),
    )
    orchestrator = ADKOrchestrator(
        blackboard=blackboard,
        callback_manager=callback_manager,
        perf_collector=performance,
    )

    records: list[dict[str, Any]] = []
    # Per-agent telemetry accumulated across the whole batch. The callback
    # manager holds one AgentMetrics object per agent and replaces it on each
    # ``on_agent_start``, so the end-of-batch snapshot alone would describe only
    # the final run. Clearing per run and accumulating here makes
    # ``agent_metrics_*.json`` describe every run in the batch, which is what the
    # agent-level heatmap claims to show.
    agent_totals: dict[str, dict[str, Any]] = {}
    with output_path.open("a", encoding="utf-8", newline="\n") as handle:
        for index, case in enumerate(selected, start=1):
            callback_manager.metrics.clear()
            record = run_case(
                case,
                orchestrator,
                run_index=index,
                total=len(selected),
                model_available=model_available,
            )
            record["execution_order"] = index
            record["shuffle_seed"] = SHUFFLE_SEED
            handle.write(json.dumps(record, ensure_ascii=True) + "\n")
            handle.flush()
            records.append(record)

            for name, values in snapshot_agent_metrics(callback_manager).items():
                target = agent_totals.setdefault(
                    name,
                    {
                        "steps": 0,
                        "tool_calls": 0,
                        "errors": 0,
                        "total_latency_ms": 0.0,
                        "total_tokens": None,
                    },
                )
                for key in ("steps", "tool_calls", "errors"):
                    target[key] += int(values.get(key) or 0)
                target["total_latency_ms"] = round(
                    target["total_latency_ms"]
                    + float(values.get("total_latency_ms") or 0.0),
                    3,
                )
                if values.get("total_tokens"):
                    target["total_tokens"] = (target["total_tokens"] or 0) + int(
                        values["total_tokens"]
                    )
            time.sleep(0.4)

    (OUTPUT_DIR / f"agent_metrics_{batch}.json").write_text(
        json.dumps(
            {
                "session": session_label,
                "batch": batch,
                "captured_utc": _iso_now(),
                "runs_aggregated": len(records),
                "agents": agent_totals,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return records


def environment_metadata(model_available: bool) -> dict[str, Any]:
    return {
        "harness_version": "1.0.0",
        "git_head": _git_head(),
        "python_version": sys.version.split()[0],
        "platform": platform.platform(),
        "model_available": model_available,
        "execution_mode": "live-model" if model_available else "offline-deterministic",
        "note": (
            "No usable model API key was configured, so runs execute the real "
            "ADK/CrewAI orchestration paths, real MCP tool calls and real network "
            "search, but no LLM inference. Token and cost fields are null, not 0."
            if not model_available
            else "Model key present; runs use live inference."
        ),
    }
