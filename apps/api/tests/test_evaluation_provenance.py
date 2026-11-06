"""Tests for evaluation record provenance and categorisation.

Two properties matter for an honest comparison and are easy to regress:

* a blocked run must be categorised as ``guardrail_block``, not left blank;
* the architecture's search plan (queries issued, concurrency, refine steps,
  delegations) must be extracted from the real evidence payload so the
  comparison can be checked against the dataset rather than asserted.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from mas.evaluation.analysis import write_csv
from mas.evaluation.harness import _error_category, _research_provenance


def _evidence(**overrides) -> str:
    payload = {
        "query": "wireless headphones market",
        "queries_issued": ["wireless headphones", "wireless headphones price"],
        "backends": ["google_news_rss"],
        "results": [],
        "strategy": "parallel",
        "concurrency": 2,
    }
    payload.update(overrides)
    return json.dumps(payload)


class ResearchProvenanceTests(unittest.TestCase):
    def test_extracts_the_search_plan(self) -> None:
        research = SimpleNamespace(raw_search_data=_evidence())
        provenance = _research_provenance(research)
        self.assertEqual(provenance["research_strategy"], "parallel")
        self.assertEqual(provenance["queries_issued"], 2)
        self.assertEqual(provenance["search_concurrency"], 2)
        self.assertIsNone(provenance["search_iterations"])
        self.assertIsNone(provenance["search_delegations"])

    def test_extracts_react_iterations(self) -> None:
        research = SimpleNamespace(
            raw_search_data=_evidence(
                strategy="react",
                concurrency=None,
                iterations=3,
                observations=[1, 2, 3],
                queries_issued=["a", "b", "c"],
            )
        )
        provenance = _research_provenance(research)
        self.assertEqual(provenance["research_strategy"], "react")
        self.assertEqual(provenance["queries_issued"], 3)
        self.assertEqual(provenance["search_iterations"], 3)

    def test_extracts_hierarchical_delegations(self) -> None:
        research = SimpleNamespace(
            raw_search_data=_evidence(
                strategy="hierarchical",
                concurrency=None,
                delegations=1,
                plan=["a", "b"],
            )
        )
        provenance = _research_provenance(research)
        self.assertEqual(provenance["search_delegations"], 1)
        self.assertEqual(provenance["queries_issued"], 2)

    def test_missing_or_invalid_evidence_yields_nulls(self) -> None:
        for research in (
            None,
            SimpleNamespace(raw_search_data=None),
            SimpleNamespace(raw_search_data=""),
            SimpleNamespace(raw_search_data="not json"),
            SimpleNamespace(raw_search_data="[]"),
        ):
            with self.subTest(research=research):
                provenance = _research_provenance(research)
                self.assertTrue(all(value is None for value in provenance.values()))


class ErrorCategoryTests(unittest.TestCase):
    def test_blocked_runs_are_categorised_as_guardrail_blocks(self) -> None:
        self.assertEqual(_error_category("blocked", [], None), "guardrail_block")

    def test_blocked_never_masks_an_exception(self) -> None:
        self.assertEqual(
            _error_category("blocked", [], "RuntimeError: boom"), "exception"
        )

    def test_clean_runs_have_no_error_category(self) -> None:
        self.assertIsNone(_error_category("partial", [], None))
        self.assertIsNone(_error_category("success", [], None))

    def test_search_failures_are_categorised(self) -> None:
        self.assertEqual(
            _error_category("error", ["Live search completed with no results."], None),
            "search_unavailable",
        )


class DatasetCsvTests(unittest.TestCase):
    def test_csv_exposes_the_search_plan_columns(self) -> None:
        record = {
            "run_id": "r1",
            "case_id": "case-001",
            "architecture": "parallel",
            "status": "partial",
            "research_strategy": "parallel",
            "queries_issued": 2,
            "search_concurrency": 2,
            "search_iterations": None,
            "search_delegations": None,
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "results.csv"
            write_csv([record], path)
            header = path.read_text(encoding="utf-8").splitlines()[0]
            row = path.read_text(encoding="utf-8").splitlines()[1]
        for column in (
            "research_strategy",
            "queries_issued",
            "search_concurrency",
            "search_iterations",
            "search_delegations",
        ):
            self.assertIn(column, header)
        self.assertIn("parallel", row)


if __name__ == "__main__":
    unittest.main()
