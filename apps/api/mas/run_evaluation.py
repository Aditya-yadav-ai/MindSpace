"""Evaluation CLI (Requirement #10).

Usage:
    python -m mas.run_evaluation                    # run every batch, then analyse
    python -m mas.run_evaluation --batch core-p2p   # run only the P2P batch
    python -m mas.run_evaluation --batch a2a        # run only the A2A batch
    python -m mas.run_evaluation --analyse-only     # re-derive reports from raw runs
    python -m mas.run_evaluation --rebuild-dataset  # regenerate the versioned cases
    python -m mas.run_evaluation --reset            # archive raw runs before a new session

Raw records are append-only in ``mas/outputs/evaluation/raw_runs.jsonl``; derived
files are regenerated from them on demand.
"""
from __future__ import annotations

import argparse
import json
import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)


def _archive_raw_runs(raw_path: Path) -> Path | None:
    if not raw_path.exists():
        return None
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = raw_path.with_name(f"raw_runs.superseded-{stamp}.jsonl")
    shutil.move(str(raw_path), str(target))
    logger.info("Archived previous raw runs to %s", target)
    return target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the MindSpace evaluation suite")
    parser.add_argument("--batch", choices=["core-p2p", "a2a", "all"], default="all")
    parser.add_argument("--analyse-only", action="store_true")
    parser.add_argument("--rebuild-dataset", action="store_true")
    parser.add_argument("--reset", action="store_true", help="Archive existing raw runs first")
    parser.add_argument(
        "--keep-dataset",
        action="store_true",
        help="Reuse the on-disk dataset instead of rebuilding it",
    )
    parser.add_argument(
        "--runs", type=int, default=0, help="Optional limit applied to the core batch"
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s"
    )

    from mas.evaluation import dataset as dataset_module
    from mas.evaluation import analysis, harness

    if args.rebuild_dataset or not dataset_module.CASES_PATH.exists():
        cases = dataset_module.build_cases()
        meta = dataset_module.write_dataset(cases)
        logger.info("Wrote %s cases (sha256=%s)", meta["case_count"], meta["sha256"][:12])
    cases = dataset_module.load_cases()
    logger.info("Loaded %s cases from %s", len(cases), dataset_module.CASES_PATH)

    if args.reset:
        _archive_raw_runs(harness.RAW_RUNS_PATH)

    if not args.analyse_only:
        batches: list[str]
        if args.batch == "all":
            batches = ["core-p2p", "a2a"]
        else:
            batches = [args.batch]
        for batch in batches:
            selected = [case for case in cases if case["batch"] == batch]
            if args.runs and batch == "core-p2p":
                selected = selected[: args.runs]
            if not selected:
                logger.warning("No cases for batch %s", batch)
                continue
            logger.info("Running batch %s (%s cases)", batch, len(selected))
            records = harness.run_batch(
                selected,
                batch=batch,
                output_path=harness.RAW_RUNS_PATH,
                session_label=f"evaluation_{batch}",
            )
            logger.info("Batch %s finished: %s records", batch, len(records))

    records = analysis.load_records()
    summary = analysis.analyse(records)
    print(json.dumps({key: summary[key] for key in ("n_runs", "status_counts", "evidence_rate")}, indent=2))
    print(f"Report: {analysis.REPORT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
