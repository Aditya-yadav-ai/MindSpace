import json
import unittest
from contextlib import contextmanager
from unittest.mock import patch

from mas.agents.adk_agents.report_agent import ADKReportAgent
from mas.agents.crewai_crew.crew import EcommerceResearchCrew
from mas.monitoring.performance import PerformanceCollector
from mas.models.schemas import GuardrailFlags


class FakeBlackboard:
    def __init__(self):
        self.values = {}
        self.writes = []

    def write(self, key, value, _agent, run_id):
        self.values[(key, run_id)] = value
        self.writes.append(key)

    def read(self, key, run_id):
        return self.values.get((key, run_id))

    def get_stats(self):
        return {"reads": 0, "writes": len(self.writes)}


class FakeCallbacks:
    def __init__(self):
        self.agents = []
        self.errors = []
        self.agent_tokens = []

    def on_agent_start(self, agent, _task):
        self.agents.append(agent)

    def on_tool_start(self, _agent, _tool, _input):
        return 0.0

    def on_tool_end(self, *_args):
        pass

    def on_agent_end(self, _agent, _output, tokens=0):
        self.agent_tokens.append(tokens)

    def on_blackboard_write(self, *_args):
        pass

    def on_blackboard_read(self, *_args):
        pass

    def on_error(self, agent, error):
        self.errors.append((agent, error))


class FakeAudit:
    def record(self, *_args, **_kwargs):
        pass


class FakeTracer:
    @contextmanager
    def span(self, *_args, **_kwargs):
        yield None


class ResearchReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.blackboard = FakeBlackboard()
        self.callbacks = FakeCallbacks()
        self.crew = EcommerceResearchCrew(
            self.blackboard, self.callbacks, FakeAudit(), FakeTracer()
        )

    def run_crew_with_search(self, search_result):
        with patch(
            "mas.tools.mcp_tools.WebSearchMCPTool.run",
            return_value=search_result,
        ):
            return self.crew.run_sequential(
                "market query", "professional_analyst", "run-1"
            )

    def test_sequential_workflow_skips_dependents_when_search_is_unavailable(self):
        result = self.run_crew_with_search(
            {
                "query": "market query",
                "results": [],
                "total_results": 0,
                "error": "Search failed (TimeoutError): unavailable",
            }
        )

        self.assertEqual(result["status"], "error")
        self.assertIn("TimeoutError", result["errors"][0])
        self.assertIsNone(result["product_analysis"])
        self.assertIsNone(result["pricing_recommendation"])
        self.assertNotIn("product_analyst", self.callbacks.agents)
        self.assertNotIn("pricing_specialist", self.callbacks.agents)
        self.assertNotIn("adk_pricing_agent", self.callbacks.agents)
        self.assertNotIn("market_research", self.blackboard.writes)

    def test_empty_search_produces_error_and_report_metadata(self):
        result = self.run_crew_with_search(
            {
                "query": "market query",
                "results": [],
                "total_results": 0,
                "error": None,
            }
        )
        report = ADKReportAgent(self.blackboard, self.callbacks).generate(
            query="market query",
            persona="professional_analyst",
            architecture="sequential",
            run_id="run-1",
            pricing_output=None,
            guardrail_flags=GuardrailFlags(),
            elapsed_ms=result["elapsed_ms"],
            execution_errors=result["errors"],
        )

        self.assertEqual(report.status, "error")
        self.assertIn("no results", report.execution_metadata.errors[0])
        self.assertIn("no results", report.executive_summary)
        self.assertIsNone(report.market_research)
        self.assertIsNone(report.product_analysis)
        self.assertIsNone(report.pricing_recommendation)

    def test_malformed_search_payload_fails_closed_with_execution_error(self):
        for malformed_result in (
            None,
            {"query": "market query", "results": {}},
            {
                "query": "market query",
                "results": [{"title": "Missing fields"}],
            },
        ):
            with self.subTest(result=malformed_result):
                result = self.run_crew_with_search(malformed_result)

                self.assertEqual(result["status"], "error")
                self.assertIn("Malformed live search response", result["errors"][0])
                self.assertIsNone(result["market_research"])
                self.assertIsNone(result["product_analysis"])
                self.assertIsNone(result["pricing_recommendation"])
                self.assertNotIn("market_research", self.blackboard.writes)

    def test_invalid_search_url_fails_closed_with_execution_error(self):
        result = self.run_crew_with_search(
            {
                "query": "market query",
                "results": [
                    {
                        "title": "Invalid source",
                        "url": "javascript:alert(1)",
                        "snippet": "Untrusted source",
                    }
                ],
            }
        )

        self.assertEqual(result["status"], "error")
        self.assertIn("valid HTTP(S) URL", result["errors"][0])
        self.assertNotIn("market_research", self.blackboard.writes)

    def test_report_malformed_json_records_execution_error(self):
        invalid_payloads = (
            "{not json",
            json.dumps([]),
            json.dumps(None),
            json.dumps({"query": "market query", "results": "not a list"}),
            json.dumps(
                {
                    "query": "market query",
                    "results": [
                        {
                            "title": "Bad source",
                            "url": "file:///private/report",
                            "snippet": "Not an HTTP source",
                        }
                    ],
                }
            ),
        )
        for invalid_payload in invalid_payloads:
            with self.subTest(payload=invalid_payload):
                self.blackboard.write(
                    "market_research",
                    invalid_payload,
                    "market_researcher",
                    "run-1",
                )

                report = ADKReportAgent(
                    self.blackboard, self.callbacks
                ).generate(
                    query="market query",
                    persona="professional_analyst",
                    architecture="sequential",
                    run_id="run-1",
                    pricing_output=None,
                    guardrail_flags=GuardrailFlags(),
                    elapsed_ms=1.0,
                )

                self.assertEqual(report.status, "error")
                self.assertIn(
                    "Invalid market research evidence",
                    report.execution_metadata.errors[0],
                )
                self.assertIn(
                    "Invalid market research evidence",
                    report.executive_summary,
                )
                self.assertIsNone(report.market_research)

    def test_report_falsy_non_string_evidence_records_execution_error(self):
        for malformed_value in (0, False, []):
            with self.subTest(value=malformed_value):
                self.blackboard.values[("market_research", "run-1")] = malformed_value

                report = ADKReportAgent(
                    self.blackboard, self.callbacks
                ).generate(
                    query="market query",
                    persona="professional_analyst",
                    architecture="sequential",
                    run_id="run-1",
                    pricing_output=None,
                    guardrail_flags=GuardrailFlags(),
                    elapsed_ms=1.0,
                )

                self.assertEqual(report.status, "error")
                self.assertIn(
                    "Invalid market research evidence",
                    report.execution_metadata.errors[0],
                )
                self.assertIn("JSON text", report.execution_metadata.errors[0])
                self.assertIsNone(report.market_research)

    def test_report_preserves_live_sources_without_unverified_findings(self):
        source_url = "https://research.example.org/source"
        search_result = {
            "query": "market query",
            "results": [
                {
                    "title": "Source title",
                    "url": source_url,
                    "snippet": "Observed source evidence.",
                }
            ],
        }
        self.blackboard.write(
            "market_research",
            json.dumps(search_result),
            "market_researcher",
            "run-1",
        )

        report = ADKReportAgent(self.blackboard, self.callbacks).generate(
            query="market query",
            persona="professional_analyst",
            architecture="sequential",
            run_id="run-1",
            pricing_output=None,
            guardrail_flags=GuardrailFlags(),
            elapsed_ms=1.0,
        )
        markdown = report.to_markdown()

        self.assertEqual(report.status, "partial")
        assert report.market_research is not None
        self.assertEqual(report.market_research.sources, [source_url])
        assert report.market_research.raw_search_data is not None
        self.assertIn("Observed source evidence.", report.market_research.raw_search_data)
        self.assertIn(source_url, markdown)
        self.assertIn("Not established from returned sources.", markdown)
        self.assertIn("Not assessed", markdown)
        self.assertIsNone(report.market_research.sentiment)
        self.assertIsNone(report.product_analysis)
        self.assertIsNone(report.pricing_recommendation)
        self.assertNotIn("18% YoY", markdown)
        self.assertNotIn("$149", markdown)

    def test_report_defaults_unknown_tokens_to_zero_and_records_no_llm_tokens(self):
        report = ADKReportAgent(self.blackboard, self.callbacks).generate(
            query="market query",
            persona="professional_analyst",
            architecture="sequential",
            run_id="run-1",
            pricing_output=None,
            guardrail_flags=GuardrailFlags(),
            elapsed_ms=1.0,
        )

        self.assertEqual(report.execution_metadata.llm_tokens_used, 0)
        self.assertEqual(report.execution_metadata.estimated_cost_usd, 0)
        self.assertEqual(self.callbacks.agent_tokens[-1], 0)

    def test_report_preserves_known_token_usage_and_cost(self):
        tokens_used = 200
        report = ADKReportAgent(self.blackboard, self.callbacks).generate(
            query="market query",
            persona="professional_analyst",
            architecture="sequential",
            run_id="run-1",
            pricing_output=None,
            guardrail_flags=GuardrailFlags(),
            elapsed_ms=1.0,
            tokens_used=tokens_used,
        )

        self.assertEqual(report.execution_metadata.llm_tokens_used, tokens_used)
        self.assertEqual(
            report.execution_metadata.estimated_cost_usd,
            PerformanceCollector.estimate_cost(tokens_used),
        )
        self.assertEqual(self.callbacks.agent_tokens[-1], 0)


class SearchQueryConstructionTests(unittest.TestCase):
    """The research stage must search with the product phrase, not the request."""

    def test_question_framing_is_removed(self):
        from mas.agents.crewai_crew.crew import _search_terms

        self.assertEqual(
            _search_terms("what's a good price for selling phone cases I make at home?"),
            "phone cases",
        )

    def test_analysis_framing_is_removed_but_product_is_kept(self):
        from mas.agents.crewai_crew.crew import _search_terms

        terms = _search_terms(
            "Model the price elasticity of demand for mechanical keyboards at $50-$200 range"
        )
        self.assertIn("mechanical", terms)
        self.assertIn("keyboards", terms)
        for noise in ("price", "demand", "50", "200", "range"):
            self.assertNotIn(noise, terms.split())

    def test_short_keyword_query_is_unchanged(self):
        from mas.agents.crewai_crew.crew import _search_terms

        self.assertEqual(_search_terms("wireless earbuds market"), "wireless earbuds")

    def test_seasonal_and_ecommerce_queries_reduce_to_entities(self):
        from mas.agents.crewai_crew.crew import _search_terms

        self.assertEqual(
            _search_terms("Provide time-series decomposition of seasonal demand for winter jackets"),
            "seasonal winter jackets",
        )
        self.assertEqual(
            _search_terms("is it worth selling handmade candles online right now?"),
            "handmade candles",
        )

    def test_query_of_only_stopwords_falls_back_to_raw_text(self):
        from mas.agents.crewai_crew.crew import _search_terms

        self.assertEqual(_search_terms("what is this?"), "what is this?")

    def test_terms_are_capped_and_deduplicated(self):
        from mas.agents.crewai_crew.crew import _search_terms

        terms = _search_terms("desk desk desk monitor monitor keyboard mouse chair lamp")
        self.assertLessEqual(len(terms.split()), 4)
        self.assertEqual(len(set(terms.split())), len(terms.split()))

    def test_toxicity_marker_is_not_a_search_term(self):
        from mas.agents.crewai_crew.crew import _search_terms

        # The validator replaces abusive words with a literal marker; searching
        # for the marker itself returns nothing relevant.
        terms = _search_terms("[FILTERED] system is useless [FILTERED] competitors")
        self.assertNotIn("filtered", terms.split())
        self.assertTrue(terms)


class ObservabilityConfigurationTests(unittest.TestCase):
    def test_otlp_status_reports_configuration_without_secrets(self):
        from mas.monitoring.observability import otlp_status

        status = otlp_status()
        self.assertIn("otel_available", status)
        self.assertIn("otlp_exporter_available", status)
        self.assertIn("otlp_configured", status)
        self.assertIn("endpoint_set", status)
        # Never expose the endpoint value itself, only whether one is set.
        self.assertEqual(
            set(status),
            {"otel_available", "otlp_exporter_available", "otlp_configured",
             "endpoint_set", "headers_set"},
        )

    def test_tracer_instances_share_one_provider(self):
        from mas.monitoring import observability

        first = observability.get_tracer()
        second = observability.OTelTracer("another-service")
        with first.span("unit.test.one") as _span:
            pass
        with second.span("unit.test.two") as _span:
            pass
        names = {span["name"] for span in second.get_spans_summary()}
        # If each instance built its own provider, the second instance's
        # exporter would only ever see its own span.
        self.assertIn("unit.test.two", names)

    def test_otlp_export_activates_when_endpoint_is_configured(self):
        """Prove the export path is wired, not merely described."""
        import os
        import subprocess
        import sys
        from pathlib import Path

        api_root = Path(__file__).resolve().parents[1]
        env = dict(os.environ)
        env["OTEL_EXPORTER_OTLP_ENDPOINT"] = "http://127.0.0.1:9"  # never contacted
        env["PYTHONIOENCODING"] = "utf-8"
        script = (
            "from mas.monitoring.observability import otlp_status, get_tracer;"
            "get_tracer();"
            "print(otlp_status()['otlp_configured'])"
        )
        completed = subprocess.run(
            [sys.executable, "-c", script],
            cwd=str(api_root),
            capture_output=True,
            text=True,
            timeout=90,
            env=env,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr[-800:])
        # Last non-empty line is the printed boolean.
        lines = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
        self.assertEqual(lines[-1], "True", completed.stdout[-800:])

    def test_tool_invocation_records_a_span(self):
        from mas.monitoring.observability import get_tracer

        tracer = get_tracer()
        with tracer.span("tool.web_search", {"tool": "web_search"}) as span:
            if span is not None:
                span.set_attribute("result_count", 3)
        summary = tracer.get_spans_summary()
        tool_spans = [s for s in summary if s["name"] == "tool.web_search"]
        self.assertTrue(tool_spans)
        self.assertEqual(tool_spans[-1]["attributes"].get("tool"), "web_search")


if __name__ == "__main__":
    unittest.main()
