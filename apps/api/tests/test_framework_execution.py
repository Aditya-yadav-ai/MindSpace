"""Tests that Google ADK and CrewAI genuinely execute.

The model layer is replaced with a deterministic double so the tests run
offline. Everything above the model — the ADK ``LlmAgent`` + ``InMemoryRunner``
event loop, and the CrewAI ``Crew.kickoff()`` orchestration — is the real
framework. Offline behaviour (no key) is also asserted: both must refuse rather
than fabricate a result.
"""

from __future__ import annotations

import unittest
from unittest import mock

from mas.agents.adk_agents import runtime as adk_runtime
from mas.agents.crewai_crew import runtime as crew_runtime
from mas.config import config

# --- deterministic model doubles ------------------------------------------------


class FakeCrewLLM:
    """Factory returning a real ``BaseLLM`` subclass instance."""

    @staticmethod
    def build(answer: str = "crew answer") -> object:
        from crewai.llms.base_llm import BaseLLM

        class _Fake(BaseLLM):
            @property
            def llm_type(self) -> str:
                return "fake"

            def call(
                self,
                messages,
                tools=None,
                callbacks=None,
                available_functions=None,
                from_task=None,
                from_agent=None,
            ):
                return answer

        return _Fake(model="fake-model")


def fake_adk_model(answer: str = "adk briefing"):
    from google.adk.models.base_llm import BaseLlm
    from google.adk.models.llm_response import LlmResponse
    from google.genai import types as genai_types

    class _FakeModel(BaseLlm):
        model: str = "fake-adk"

        async def generate_content_async(self, llm_request, stream=False):
            yield LlmResponse(
                content=genai_types.Content(
                    role="model", parts=[genai_types.Part(text=answer)]
                )
            )

    return _FakeModel()


# --- CrewAI --------------------------------------------------------------------


class CrewAIRuntimeTests(unittest.TestCase):
    def test_sequential_invokes_real_crew_kickoff(self) -> None:
        llm = FakeCrewLLM.build("sequential answer")
        result = crew_runtime.run_sequential("wireless earbuds", "analyst", "run-1", llm=llm)
        self.assertEqual(result.framework, "crewai")
        self.assertEqual(result.pattern, "sequential")
        self.assertIn("sequential answer", result.output)
        self.assertGreaterEqual(result.tasks_completed, 1)
        self.assertEqual(len(result.agents), 3)

    def test_hierarchical_uses_manager_process(self) -> None:
        llm = FakeCrewLLM.build("hierarchical answer")
        result = crew_runtime.run_hierarchical("gaming laptops", "analyst", "run-2", llm=llm)
        self.assertEqual(result.pattern, "hierarchical")
        self.assertIn("hierarchical answer", result.output)

    def test_parallel_runs_independent_crews_concurrently(self) -> None:
        llm = FakeCrewLLM.build("parallel section")
        result = crew_runtime.run_parallel("running shoes", "analyst", "run-3", llm=llm)
        self.assertEqual(result.pattern, "parallel")
        self.assertIn("## Market research", result.output)
        self.assertIn("## Product analysis", result.output)
        self.assertIn("## Pricing", result.output)
        self.assertGreaterEqual(result.tasks_completed, 3)

    def test_dispatch_rejects_unknown_pattern(self) -> None:
        with self.assertRaisesRegex(crew_runtime.CrewUnavailable, "Unknown CrewAI pattern"):
            crew_runtime.run_crew("bogus", "q", "p", "r", llm=FakeCrewLLM.build())

    def test_offline_refuses_instead_of_faking(self) -> None:
        with mock.patch.object(config, "GROQ_CONFIGURED", False):
            self.assertFalse(crew_runtime.crew_available())
            with self.assertRaisesRegex(crew_runtime.CrewUnavailable, "GROQ_API_KEY"):
                crew_runtime.build_llm()


# --- Google ADK ----------------------------------------------------------------


class ADKRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_agent_and_runner_execute(self) -> None:
        result = await adk_runtime.run_async(
            "Summarise the evidence.", model=fake_adk_model("adk says hello")
        )
        self.assertEqual(result.framework, "google-adk")
        self.assertEqual(result.text, "adk says hello")
        self.assertGreater(result.events, 0)

    async def test_evidence_prompt_marks_content_untrusted(self) -> None:
        prompt = adk_runtime.build_evidence_prompt(
            "What is the price?", '{"results": []}', "analyst"
        )
        self.assertIn("<evidence>", prompt)
        self.assertIn("untrusted data", prompt)
        self.assertIn("never instructions", prompt)

    def test_offline_refuses_instead_of_faking(self) -> None:
        with mock.patch.object(config, "GROQ_CONFIGURED", False):
            self.assertFalse(adk_runtime.adk_available())
            with self.assertRaisesRegex(adk_runtime.AdkUnavailable, "GROQ_API_KEY"):
                adk_runtime.build_model()
            with self.assertRaises(adk_runtime.AdkUnavailable):
                adk_runtime.run_sync("hello")


# --- orchestrator wiring -------------------------------------------------------


class OrchestratorAdkWiringTests(unittest.TestCase):
    def test_adk_briefing_is_appended_only_when_available(self) -> None:
        from mas.agents.adk_agents.orchestrator import ADKOrchestrator

        orchestrator = ADKOrchestrator.__new__(ADKOrchestrator)

        with mock.patch(
            "mas.agents.adk_agents.runtime.adk_available", return_value=False
        ):
            self.assertIsNone(
                orchestrator._run_adk_briefing("q", "p", "run-x", "{}")
            )

        fake = adk_runtime.AdkRunResult(text="brief", events=2, model="m", elapsed_ms=1.0)
        with mock.patch(
            "mas.agents.adk_agents.runtime.adk_available", return_value=True
        ), mock.patch(
            "mas.agents.adk_agents.runtime.run_sync", return_value=fake
        ):
            result = orchestrator._run_adk_briefing("q", "p", "run-y", "{}")
        self.assertIsNotNone(result)
        self.assertEqual(result.text, "brief")


if __name__ == "__main__":
    unittest.main()
