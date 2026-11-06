"""Reproducible evaluation package (dataset, harness, derived analysis)."""

from mas.evaluation.dataset import (  # noqa: F401
    ARCHITECTURES,
    CASES_PATH,
    DATASET_VERSION,
    build_cases,
    cases_fingerprint,
    load_cases,
    load_meta,
    write_dataset,
)
