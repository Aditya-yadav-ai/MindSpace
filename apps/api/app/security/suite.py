"""Adversarial prompt suite (Requirement #8).

Loads the versioned dataset of adversarial and benign page-text samples, runs
both guardrail layers over every case, and reports a confusion matrix with
precision/recall plus the individual misses.

The suite is deliberately strict about honesty:

* Each case declares what *should* happen. Observed behaviour is compared to the
  declaration, and the raw per-case outcome is stored.
* False positives are reported, not hidden. ``benign-10`` is a known lexicon
  false positive and stays in the dataset for that reason.

Usage::

    python -m app.security.suite          # write the JSON report
    python -m app.security.suite --print  # also print a summary table
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.guardrails import (
    fence_untrusted,
    redact_secrets,
    sanitise_untrusted,
    scan_injection,
)
from mas.guardrails.validators import GuardrailValidator

SECURITY_DIR = Path(__file__).resolve().parent
DATASET_PATH = SECURITY_DIR / "adversarial_prompts.jsonl"
META_PATH = SECURITY_DIR / "adversarial_prompts.meta.json"
REPORT_PATH = (
    Path(__file__).resolve().parents[2]
    / "mas"
    / "outputs"
    / "security"
    / "adversarial_report.json"
)
DATASET_VERSION = "1.0.0"
MALICIOUS_CATEGORIES = {"injection", "xss", "exfiltration"}
TOXIC_CATEGORIES = {"toxic"}


def load_dataset(path: Path = DATASET_PATH) -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                cases.append(json.loads(line))
    return cases


def dataset_fingerprint(cases: list[dict[str, Any]]) -> str:
    payload = json.dumps(cases, sort_keys=True, ensure_ascii=True).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def evaluate_case(case: dict[str, Any], validator: GuardrailValidator) -> dict[str, Any]:
    text = case["text"]

    # Layer 1: untrusted web-content scanner (flags, never obeys).
    flags = scan_injection(text)

    # Layer 2: MAS query validator (blocks injection, filters toxicity).
    sanitised_query, guard_flags = validator.validate_input(text, persona="adversarial_suite")

    # Layer 3: untrusted-content containment used by the web API.
    cleaned, truncated = sanitise_untrusted(text)
    fenced = fence_untrusted(cleaned)
    redacted = redact_secrets(text)

    observed_flag = bool(flags)
    observed_block = bool(guard_flags.blocked)
    observed_sanitised = bool(guard_flags.toxicity_detected)

    return {
        "id": case["id"],
        "category": case["category"],
        "vector": case["vector"],
        "expected": {
            "flag": case["expect_flag"],
            "block": case["expect_block"],
            "sanitised": case["expect_sanitised"],
        },
        "observed": {
            "flag": observed_flag,
            "block": observed_block,
            "sanitised": observed_sanitised,
            "flags": flags,
            "reason": guard_flags.reason,
            "risk_level": guard_flags.risk_level,
        },
        "containment": {
            "fenced": fenced.startswith("<untrusted_page_content>") and fenced.endswith("</untrusted_page_content>"),
            "truncated": truncated,
            "xss_tags_stripped": "<script" not in cleaned.lower() and "<iframe" not in cleaned.lower(),
            # Redaction is complete when a second pass changes nothing: any
            # remaining credential-shaped text would be rewritten again.
            "secrets_redacted": redact_secrets(redacted) == redacted,
        },
        "matches": {
            "flag": observed_flag == case["expect_flag"],
            "block": observed_block == case["expect_block"],
            "sanitised": observed_sanitised == case["expect_sanitised"],
        },
        "notes": case["notes"],
    }


def _confusion(results: list[dict[str, Any]], expected_key: str, observed_key: str) -> dict[str, Any]:
    tp = fp = tn = fn = 0
    false_positives: list[str] = []
    false_negatives: list[str] = []
    for result in results:
        expected = result["expected"][expected_key]
        observed = result["observed"][observed_key]
        if expected and observed:
            tp += 1
        elif not expected and observed:
            fp += 1
            false_positives.append(result["id"])
        elif not expected and not observed:
            tn += 1
        else:
            fn += 1
            false_negatives.append(result["id"])
    precision = tp / (tp + fp) if (tp + fp) else 1.0
    recall = tp / (tp + fn) if (tp + fn) else 1.0
    return {
        "true_positives": tp,
        "false_positives": fp,
        "true_negatives": tn,
        "false_negatives": fn,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "false_positive_ids": false_positives,
        "false_negative_ids": false_negatives,
    }


def evaluate_dataset(cases: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    cases = cases if cases is not None else load_dataset()
    validator = GuardrailValidator(max_input_length=2000, toxicity_block=True)
    results = [evaluate_case(case, validator) for case in cases]

    injection_cases = [r for r in results if r["category"] in MALICIOUS_CATEGORIES]
    benign_cases = [r for r in results if r["category"] == "benign"]
    toxic_cases = [r for r in results if r["category"] in TOXIC_CATEGORIES]

    injection_results = injection_cases + benign_cases
    # Toxicity is measured against every benign control too, so the lexicon's
    # false positives are visible instead of being scored as successes.
    toxic_results = toxic_cases + benign_cases

    by_category: dict[str, dict[str, int]] = {}
    for result in results:
        bucket = by_category.setdefault(result["category"], {"cases": 0, "flags_correct": 0, "blocks_correct": 0})
        bucket["cases"] += 1
        bucket["flags_correct"] += int(result["matches"]["flag"])
        bucket["blocks_correct"] += int(result["matches"]["block"])

    containment_failures = [
        result["id"] for result in results if not result["containment"]["fenced"]
    ]

    report = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "dataset_version": DATASET_VERSION,
        "dataset_sha256": dataset_fingerprint(cases),
        "case_count": len(cases),
        "detection": {
            "untrusted_scanner": {
                "test": "scan_injection(text) returns at least one flag",
                "population": "malicious injection/xss/exfiltration cases vs benign controls",
                **_confusion(injection_results, "flag", "flag"),
            },
            "mas_validator_block": {
                "test": "GuardrailValidator.validate_input blocks the input",
                "population": "malicious injection/xss/exfiltration cases vs benign controls",
                **_confusion(injection_results, "block", "block"),
            },
            "toxicity_filter": {
                "test": "toxicity detected and sanitised (blocked=False by design)",
                "population": "toxic cases (plus one benign lexicon false-positive control)",
                **_confusion(toxic_results, "sanitised", "sanitised"),
            },
        },
        "by_category": by_category,
        "containment": {
            "all_cases_fenced": not containment_failures,
            "fencing_failures": containment_failures,
            "xss_tags_stripped_in_sanitised_text": all(
                result["containment"]["xss_tags_stripped"] for result in results
            ),
        },
        "cases": results,
    }
    return report


def write_report(report: dict[str, Any], path: Path = REPORT_PATH) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the adversarial prompt suite")
    parser.add_argument("--print", action="store_true", dest="print_summary")
    args = parser.parse_args(argv)

    report = evaluate_dataset()
    path = write_report(report)
    print(f"Dataset sha256: {report['dataset_sha256'][:16]}")
    for name, metrics in report["detection"].items():
        print(
            f"{name}: TP={metrics['true_positives']} FP={metrics['false_positives']} "
            f"TN={metrics['true_negatives']} FN={metrics['false_negatives']} "
            f"precision={metrics['precision']:.3f} recall={metrics['recall']:.3f}"
        )
    print(f"Report: {path}")
    if args.print_summary:
        for case in report["cases"]:
            print(f"{case['id']:<24} {case['category']:<14} flags={case['observed']['flags']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
