"""Tests that the four architectures are genuinely different control flows.

The evaluation compares sequential / parallel / react / hierarchical. When no
model key is configured the crew falls back to the native MCP evidence path, so
that path must itself implement four different flows. Otherwise the
"architecture comparison" would measure one code path four times.

These tests replace the MCP search tool with a deterministic double: the control
flow under test is the real code, only the network call is stubbed.
"""

from __future__ import annotations

import json
import unittest
from unittest import mock

from mas.agents.crewai_crew.crew import (
    ResearchUnavailableError,
    _native_market_research,
    _search_terms,
)


def _result(url: str, backend: str = "stub") -> dict:
    return {
        "url": url,
        "title": f"Title for {url}",
        "source": "Example Publisher",
        "published": "2026-01-01T00:00:00+00:00",
        "snippet": "snippet",
        "backend": backend,
    }


class FakeSearchTool:
    """Returns a fixed number of distinct results per query, and records calls."""

    def __init__(self, results_per_query: int = 2, error: str | None = None) -> None:
        self.results_per_query = results_per_query
        self.error = error
        self.calls: list[str] = []

    def run(self, query: str, max_results: int = 5) -> dict:
        self.calls.append(query)
        if self.error:
            return {"query": query, "results": [], "error": self.error, "backend": None}
        base = len(self.calls)
        rows = [
            _result(f"https://example.com/{base}/{i}")
            for i in range(self.results_per_query)
        ]
        return {
            "query": query,
            "results": rows[:max_results],
            "error": None,
            "backend": "stub",
            "backends_tried": ["stub"],
            "attempts": [],
        }


def _run(pattern: str, tool: FakeSearchTool, query: str = "wireless headphones market") -> dict:
    with mock.patch(
        "mas.tools.mcp_tools.WebSearchMCPTool", return_value=tool
    ):
        payload = _native_market_research(query, "market_analyst", pattern)
    return json.loads(payload)


class ArchitectureFlowTests(unittest.TestCase):
    QUERY = "wireless headphones market"

    def test_sequential_stops_after_first_query_when_evidence_is_rich(self) -> None:
        tool = FakeSearchTool(results_per_query=5)
        data = _run("sequential", tool)
        self.assertEqual(data["strategy"], "sequential")
        # >= 5 distinct sources after the first query -> second query skipped.
        self.assertEqual(len(tool.calls), 1)
        self.assertEqual(len(data["results"]), 5)

    def test_sequential_widens_when_evidence_is_thin(self) -> None:
        tool = FakeSearchTool(results_per_query=2)
        data = _run("sequential", tool)
        self.assertEqual(data["strategy"], "sequential")
        self.assertEqual(len(tool.calls), 2)
        self.assertEqual(data["queries_issued"], [tool.calls[0], tool.calls[1]])
        self.assertIn("price", tool.calls[1])

    def test_parallel_issues_both_queries_regardless_of_evidence(self) -> None:
        rich = FakeSearchTool(results_per_query=5)
        data = _run("parallel", rich)
        self.assertEqual(data["strategy"], "parallel")
        self.assertEqual(len(rich.calls), 2, "parallel must not early-exit")
        self.assertEqual(data["concurrency"], 2)
        # Distinct URLs merged from both queries.
        self.assertEqual(len(data["results"]), 10)

    def test_react_refines_until_enough_evidence(self) -> None:
        thin = FakeSearchTool(results_per_query=1)
        data = _run("react", thin)
        self.assertEqual(data["strategy"], "react")
        # 1 source per query cannot reach the 3-source target, so it uses all
        # three refinements and reports its observations.
        self.assertEqual(len(thin.calls), 3)
        self.assertEqual(data["iterations"], 3)
        self.assertEqual(data["observations"], [1, 2, 3])

    def test_react_stops_early_once_evidence_suffices(self) -> None:
        rich = FakeSearchTool(results_per_query=3)
        data = _run("react", rich)
        self.assertEqual(len(rich.calls), 1, "3 sources meet the target immediately")
        self.assertEqual(data["iterations"], 1)

    def test_hierarchical_plans_one_query_without_delegation(self) -> None:
        rich = FakeSearchTool(results_per_query=5)
        data = _run("hierarchical", rich)
        self.assertEqual(data["strategy"], "hierarchical")
        self.assertEqual(data["delegations"], 0)
        self.assertEqual(len(data["plan"]), 1)
        self.assertEqual(len(rich.calls), 1)

    def test_hierarchical_delegates_when_evidence_is_thin(self) -> None:
        thin = FakeSearchTool(results_per_query=1)
        data = _run("hierarchical", thin)
        self.assertEqual(data["delegations"], 1)
        self.assertEqual(len(data["plan"]), 2)
        self.assertEqual(len(thin.calls), 2)

    def test_hierarchical_plans_price_query_first_when_price_is_the_question(self) -> None:
        tool = FakeSearchTool(results_per_query=5)
        data = _run(
            "hierarchical", tool, query="what price should we set to undercut rivals"
        )
        self.assertIn("price", data["plan"][0])
        self.assertEqual(tool.calls[0], data["plan"][0])

    def test_all_four_patterns_are_structurally_distinct(self) -> None:
        """The headline guarantee: four labels, four different flows."""
        thin = {
            name: _run(name, FakeSearchTool(results_per_query=1))
            for name in ("sequential", "parallel", "react", "hierarchical")
        }
        # sequential: 2 serial queries; parallel: 2 concurrent; react: 3 refine
        # steps; hierarchical: planner + 1 delegation.
        self.assertEqual(thin["sequential"]["queries_issued"].__len__(), 2)
        self.assertEqual(thin["parallel"]["concurrency"], 2)
        self.assertEqual(thin["react"]["iterations"], 3)
        self.assertEqual(thin["hierarchical"]["delegations"], 1)
        strategies = {data["strategy"] for data in thin.values()}
        self.assertEqual(
            strategies, {"sequential", "parallel", "react", "hierarchical"}
        )

    def test_every_pattern_raises_when_search_yields_nothing(self) -> None:
        for pattern in ("sequential", "parallel", "react", "hierarchical"):
            with self.subTest(pattern=pattern):
                tool = FakeSearchTool(error="all backends failed")
                with self.assertRaises(ResearchUnavailableError):
                    _run(pattern, tool)

    def test_failed_query_in_parallel_still_uses_the_other(self) -> None:
        class HalfBroken(FakeSearchTool):
            def run(self, query: str, max_results: int = 5) -> dict:
                self.calls.append(query)
                if "price" in query:
                    return {
                        "query": query,
                        "results": [],
                        "error": "price backend down",
                        "backend": None,
                    }
                return {
                    "query": query,
                    "results": [_result("https://example.com/a")],
                    "error": None,
                    "backend": "stub",
                }

        tool = HalfBroken()
        data = _run("parallel", tool)
        self.assertEqual(len(data["results"]), 1)
        self.assertEqual(data["strategy"], "parallel")

    def test_parallel_does_not_emit_duplicate_urls(self) -> None:
        """Both concurrent queries may return the same article; keep it once."""

        class DuplicatingTool(FakeSearchTool):
            def run(self, query: str, max_results: int = 5) -> dict:
                self.calls.append(query)
                return {
                    "query": query,
                    "results": [_result("https://example.com/same-article")],
                    "error": None,
                    "backend": "stub",
                }

        tool = DuplicatingTool()
        data = _run("parallel", tool)
        urls = [row["url"] for row in data["results"]]
        self.assertEqual(urls, ["https://example.com/same-article"])

    def test_search_terms_collapse_evaluation_queries_to_product_phrases(self) -> None:
        """The 10 evaluation queries must reduce to something searchable.

        This is a regression guard on the query-construction heuristic, which is
        positional rather than semantic: it keeps the first few non-stopword
        tokens. That is a documented limitation, so the assertions below pin the
        behaviour for the queries actually used in the evaluation rather than
        claiming general linguistic quality.
        """
        cases = {
            "Analyze the wireless headphones market for Q4 opportunities": "wireless headphones",
            "What is the optimal pricing strategy for premium yoga mats?": "premium yoga mats",
            "Model the price elasticity of demand for mechanical keyboards at $50-$200 range": "mechanical keyboards",
            "Provide time-series decomposition of seasonal demand for winter jackets": "seasonal winter jackets",
            "what's a good price for selling phone cases I make at home?": "phone cases",
            "is it worth selling handmade candles online right now?": "handmade candles",
        }
        for query, expected in cases.items():
            with self.subTest(query=query):
                self.assertEqual(_search_terms(query), expected)

    def test_search_terms_drops_the_toxicity_filter_marker(self) -> None:
        """The [FILTERED] substitute must never become a search term."""
        terms = _search_terms("I need [FILTERED] bluetooth speakers margin")
        self.assertNotIn("filtered", terms)
        self.assertIn("bluetooth", terms)


if __name__ == "__main__":
    unittest.main()
