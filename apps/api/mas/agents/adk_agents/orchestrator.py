"""
Google ADK Orchestrator Agent (Requirement #7).

The ADK orchestrator:
1. Receives user queries
2. Validates with guardrails
3. Calls CrewAI crew via A2A protocol
4. Reads results from Blackboard
5. Generates final Pydantic-structured report
6. Uses LiteLLM to connect to Groq
"""
from __future__ import annotations
import json
import logging
import re
import time
import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from mas.config import config
from mas.models.schemas import (
    FinalIntelligenceReport, MarketResearchOutput, ProductAnalysisOutput,
    PricingOutput, ExecutionMetadata, GuardrailFlags,
)
from mas.blackboard.shared_state import Blackboard
from mas.guardrails.validators import get_validator
from mas.monitoring.callbacks import MASCallbackManager
from mas.monitoring.observability import get_tracer, get_audit_trail
from mas.monitoring.performance import PerformanceCollector

logger = logging.getLogger(__name__)


class ADKOrchestrator:
    """
    Google ADK-inspired Orchestrator Agent.
    
    Architecture: Hierarchical — this agent sits at the top of the agent hierarchy,
    coordinating the CrewAI Research Crew (via A2A) and the ADK Pricing + Report agents.
    
    Communication flow:
    User Query
      -> ADKOrchestrator (validates, dispatches)
        -> CrewAI Crew via A2A (market research, product analysis, pricing)
          -> Blackboard (shared state)
        <- ADKOrchestrator reads Blackboard
          -> ADK Pricing Agent (refines pricing with ML forecast)
          -> ADK Report Agent (generates final Pydantic report)
    """

    def __init__(self, blackboard: Blackboard, callback_manager: MASCallbackManager,
                 perf_collector: PerformanceCollector):
        self.blackboard = blackboard
        self.cb = callback_manager
        self.perf = perf_collector
        self.tracer = get_tracer()
        self._run_count = 0

    def run(self, query: str, persona: str = "professional_analyst",
            architecture: str = "sequential",
            use_a2a: bool = True) -> FinalIntelligenceReport:
        """
        Main entry point. Orchestrates the full MAS pipeline.
        
        Args:
            query: The e-commerce intelligence query
            persona: Persona name (affects prompt style + guardrails)
            architecture: Execution pattern (sequential/parallel/react/hierarchical)
            use_a2a: If True, calls CrewAI via A2A protocol; else calls directly
        """
        run_id = str(uuid.uuid4())
        self._run_count += 1
        start_time = time.time()
        audit = get_audit_trail(run_id)

        logger.info(f"[Orchestrator] Starting run #{self._run_count} "
                    f"persona={persona} arch={architecture} run_id={run_id[:8]}")

        self.cb.on_agent_start("adk_orchestrator", query)
        audit.record("adk_orchestrator", "run_start",
                     {"query": query, "persona": persona, "architecture": architecture},
                     output_key="run_metadata")

        # ── Step 1: Guardrail validation ─────────────────────────────────────
        validator = get_validator()
        with self.tracer.span("guardrail_validation", {"persona": persona, "run_id": run_id}):
            sanitized_query, guardrail_flags = validator.validate_input(query, persona)
            if guardrail_flags.blocked:
                self.cb.on_guardrail_trigger("adk_orchestrator",
                                              "injection" if guardrail_flags.injection_detected
                                              else "toxicity",
                                              guardrail_flags.risk_level)
                logger.warning(f"[Orchestrator] Input BLOCKED: {guardrail_flags.reason}")
                elapsed_ms = (time.time() - start_time) * 1000
                report = FinalIntelligenceReport(
                    report_id=run_id,
                    query=query,
                    persona=persona,
                    guardrail_flags=guardrail_flags,
                    executive_summary=f"Query blocked by guardrails: {guardrail_flags.reason}",
                    status="blocked",
                    overall_confidence=0.0,
                    execution_metadata=ExecutionMetadata(
                        run_id=run_id, persona=persona, architecture=architecture,
                        total_latency_ms=elapsed_ms,
                        # Make the block reason part of the machine-readable
                        # record, not only the human-readable summary.
                        errors=[f"Query blocked by guardrails: {guardrail_flags.reason}"],
                    ),
                )
                report.markdown_report = report.to_markdown()
                self._record_perf(report, self._run_count, elapsed_ms)
                return report

        if guardrail_flags.sanitized_input:
            sanitized_query = guardrail_flags.sanitized_input
        effective_query = sanitized_query or query

        # Write initial state to blackboard
        self.blackboard.write("user_query", effective_query, "adk_orchestrator", run_id)
        self.blackboard.write("persona", persona, "adk_orchestrator", run_id)
        self.blackboard.write("architecture", architecture, "adk_orchestrator", run_id)
        self.cb.on_blackboard_write("user_query", "adk_orchestrator")

        # ── Step 1b: dispatch ownership ──────────────────────────────────────
        # A task is dispatched through exactly one mechanism per run:
        #   * use_a2a=True  -> A2A owns the hand-off (no P2P task_request)
        #   * use_a2a=False -> P2P owns the hand-off (in-process crew run)
        # This avoids delivering the same task twice.
        p2p_sent = 0
        p2p_received = 0
        crew_results = {}
        a2a_calls = 0
        dispatch_transport = "none"

        if use_a2a:
            audit.record(
                "adk_orchestrator",
                "dispatch_ownership",
                {"transport": "a2a", "p2p_handoff": False},
                rationale="A2A owns task dispatch for this run; no P2P task_request is sent",
            )
            with self.tracer.span("a2a_dispatch", {"caller": "orchestrator",
                                                    "callee": "crewai_crew"}):
                try:
                    from mas.a2a.client import A2AClient
                    client = A2AClient(config.A2A_SERVER_URL)
                    self.cb.on_a2a_call("adk_orchestrator", "crewai_crew",
                                        f"query={effective_query[:100]}")
                    audit.record("adk_orchestrator", "a2a_dispatch",
                                 {"target": "crewai_crew", "query": effective_query[:200]},
                                 rationale="Delegating to CrewAI crew via A2A protocol")
                    crew_results = client.run_task(
                        task_input={
                            "skill": "market_research",
                            "query": effective_query,
                            "persona": persona,
                            "architecture": architecture,
                            "run_id": run_id,
                        },
                        timeout=120,
                    )
                    a2a_calls = 1
                    dispatch_transport = "a2a"
                    audit.record(
                        "adk_orchestrator",
                        "a2a_complete",
                        {"transport": "a2a", "a2a_calls": 1},
                        output_key="market_research",
                        rationale="A2A JSON-RPC task completed and returned the crew result",
                    )
                    logger.info("[Orchestrator] A2A call succeeded")
                except Exception as e:
                    logger.warning(f"[Orchestrator] A2A call failed: {e} — falling back to direct")
                    audit.record(
                        "adk_orchestrator",
                        "a2a_dispatch_failed",
                        {"error": f"{type(e).__name__}: {e}"},
                        rationale="A2A dispatch failed; crew ran in-process instead",
                    )
                    crew_results = self._run_crew_direct(
                        effective_query, persona, architecture, run_id
                    )
                    dispatch_transport = "local"
        else:
            audit.record(
                "adk_orchestrator",
                "dispatch_ownership",
                {"transport": "p2p", "p2p_handoff": True},
                rationale="P2P owns task dispatch for this run; A2A is not called",
            )
            task_request = self._send_task_request(
                effective_query, persona, architecture, run_id
            )
            if task_request is not None:
                p2p_sent += 1
            crew_results = self._run_crew_direct(
                effective_query, persona, architecture, run_id
            )
            dispatch_transport = "p2p"

        execution_errors = crew_results.get("errors", [])
        if not isinstance(execution_errors, list):
            execution_errors = [str(execution_errors)]
        execution_errors = [str(error) for error in execution_errors]

        # ── Step 2b: collect the P2P hand-off reply (P2P dispatch only) ──────
        if dispatch_transport == "p2p":
            p2p_replies = self._collect_task_result(run_id)
            p2p_received += len(p2p_replies)

        # Pricing is omitted until the workflow can supply observed price evidence.
        pricing_output = None

        # ── Step 3: Report generation ────────────────────────────────────────
        elapsed_ms = (time.time() - start_time) * 1000
        with self.tracer.span("report_generation", {"agent": "adk_report", "run_id": run_id}):
            from mas.agents.adk_agents.report_agent import ADKReportAgent
            report_agent = ADKReportAgent(self.blackboard, self.cb)
            report = report_agent.generate(
                query=effective_query,
                persona=persona,
                architecture=architecture,
                run_id=run_id,
                pricing_output=pricing_output,
                guardrail_flags=guardrail_flags,
                elapsed_ms=elapsed_ms,
                a2a_calls=a2a_calls,
                tokens_used=crew_results.get("tokens_used", 0),
                p2p_messages_sent=p2p_sent,
                p2p_messages_received=p2p_received,
                dispatch_transport=dispatch_transport,
                execution_errors=execution_errors,
            )

        report.markdown_report = report.to_markdown()

        # ── Step 4: real Google ADK briefing (only when a model is available) ──
        adk_result = self._run_adk_briefing(
            effective_query, persona, run_id, crew_results.get("market_research")
        )
        if adk_result is not None:
            report.executive_summary = (
                f"{report.executive_summary}\n\n{adk_result.text}".strip()
            )
            report.markdown_report = report.to_markdown()

        self.cb.on_agent_end("adk_orchestrator", report.executive_summary, tokens=0)
        audit.record("adk_orchestrator", "run_complete",
                     {"report_id": report.report_id, "status": report.status,
                      "confidence": report.overall_confidence},
                     input_keys=["market_research", "product_analysis",
                                  "pricing_recommendation", "adk_pricing"],
                     output_key="final_report",
                     rationale="All agents completed, report assembled")

        # Record performance
        self._record_perf(report, self._run_count, elapsed_ms)

        logger.info(f"[Orchestrator] Run complete: {run_id[:8]} "
                    f"status={report.status} latency={elapsed_ms:.0f}ms")
        return report

    # ── P2P coordination ─────────────────────────────────────────────────────

    _PEERS = (
        "adk_orchestrator",
        "crewai_crew",
        "adk_report_agent",
        "market_researcher",
        "pricing_optimizer",
    )

    def _mailbox(self) -> Any:
        """Return the P2P mailbox, or None when the blackboard has no mailbox."""
        return getattr(self.blackboard, "mailbox", None)

    def _send_task_request(
        self, query: str, persona: str, architecture: str, run_id: str
    ) -> Optional[Any]:
        """Address a task_request to the CrewAI crew over P2P.

        Returns the delivered message, or None when delivery failed (the
        failure is recorded in the audit trail; the A2A/direct path still runs).
        """
        mailbox = self._mailbox()
        if mailbox is None:
            return None
        from mas.messaging.p2p import P2PError

        audit = get_audit_trail(run_id)
        try:
            for peer in self._PEERS:
                mailbox.register_peer(peer)
            message = mailbox.send(
                sender="adk_orchestrator",
                recipient="crewai_crew",
                content={
                    "run_id": run_id,
                    "query": query,
                    "persona": persona,
                    "architecture": architecture,
                },
                msg_type="task_request",
                correlation_id=run_id,
            )
        except P2PError as error:
            audit.record(
                "adk_orchestrator",
                "p2p_dispatch_failed",
                {"error": f"{type(error).__name__}: {error}"},
                rationale="task_request was not delivered over P2P",
            )
            return None

        audit.record(
            "adk_orchestrator",
            "p2p_task_dispatched",
            {
                "msg_id": message.msg_id,
                "to": message.recipient,
                "correlation_id": message.correlation_id,
            },
            output_key="p2p_task_request",
            rationale="Addressed task_request delivered to the CrewAI mailbox",
        )
        return message

    def _collect_task_result(self, run_id: str) -> list:
        """Claim task_result messages correlated to this run."""
        mailbox = self._mailbox()
        if mailbox is None:
            return []
        from mas.messaging.p2p import P2PError

        audit = get_audit_trail(run_id)
        try:
            replies = mailbox.receive(
                "adk_orchestrator", msg_type="task_result", correlation_id=run_id
            )
        except P2PError as error:
            audit.record(
                "adk_orchestrator",
                "p2p_result_failed",
                {"error": f"{type(error).__name__}: {error}"},
                rationale="task_result could not be claimed from the mailbox",
            )
            return []

        if not replies:
            audit.record(
                "adk_orchestrator",
                "p2p_result_missing",
                {"run_id": run_id},
                rationale="No correlated task_result was delivered by the crew",
            )
            return []

        for reply in replies:
            audit.record(
                "adk_orchestrator",
                "p2p_result_received",
                {
                    "msg_id": reply.msg_id,
                    "from": reply.sender,
                    "correlation_id": reply.correlation_id,
                    "status": reply.content.get("status")
                    if isinstance(reply.content, dict)
                    else None,
                },
                input_keys=["p2p_task_result"],
                rationale="Consumed correlated task_result from the P2P mailbox",
            )
        return replies

    def _run_adk_briefing(
        self, query: str, persona: str, run_id: str, market_research: Optional[str]
    ) -> Optional[Any]:
        """Run one real Google ADK agent turn, or return None when unavailable.

        No simulated briefing is produced: if ADK cannot run, the report keeps
        the evidence-based summary written by the report agent.
        """
        from mas.agents.adk_agents.runtime import (
            AdkUnavailable,
            adk_available,
            build_evidence_prompt,
            run_sync,
        )
        from mas.monitoring.observability import get_audit_trail

        if not adk_available():
            return None
        prompt = build_evidence_prompt(query, market_research, persona)
        try:
            result = run_sync(prompt, user_id=run_id)
        except AdkUnavailable as error:
            logger.warning("[Orchestrator] ADK unavailable: %s", error)
            return None
        except Exception as error:  # noqa: BLE001 - reported honestly
            logger.warning("[Orchestrator] ADK run failed: %s", error)
            get_audit_trail(run_id).record(
                "adk_agent", "adk_error",
                {"error": f"{type(error).__name__}: {error}"},
                rationale="Google ADK agent turn failed; report keeps evidence summary",
            )
            return None

        if not result.text:
            return None
        get_audit_trail(run_id).record(
            "adk_agent",
            "adk_complete",
            {"events": result.events, "model": result.model, "chars": len(result.text)},
            output_key="adk_briefing",
            rationale="Real Google ADK LlmAgent briefing via InMemoryRunner",
        )
        return result

    def _run_crew_direct(self, query: str, persona: str, architecture: str,
                          run_id: str) -> Dict:
        """Fall back: run CrewAI crew directly without A2A."""
        from mas.agents.crewai_crew.crew import EcommerceResearchCrew
        audit = get_audit_trail(run_id)
        crew = EcommerceResearchCrew(
            blackboard=self.blackboard,
            callback_manager=self.cb,
            audit_trail=audit,
            tracer=self.tracer,
        )
        if architecture == "parallel":
            return crew.run_parallel(query, persona, run_id)
        elif architecture == "hierarchical":
            return crew.run_hierarchical(query, persona, run_id)
        elif architecture == "react":
            # The react pattern runs an observe→refine loop in the native
            # evidence path, so it is a real control-flow difference offline.
            return crew.run_react(query, persona, run_id)
        else:
            return crew.run_sequential(query, persona, run_id)

    def _record_perf(self, report: FinalIntelligenceReport,
                     run_number: int, elapsed_ms: float) -> None:
        meta = report.execution_metadata
        flags_count = (int(report.guardrail_flags.toxicity_detected) +
                       int(report.guardrail_flags.injection_detected))
        self.perf.record_run({
            "run_id": report.report_id,
            "run_number": run_number,
            "persona": report.persona,
            "architecture": meta.architecture,
            "query": report.query,
            "latency_ms": elapsed_ms,
            "tokens_used": meta.llm_tokens_used,
            "estimated_cost_usd": meta.estimated_cost_usd,
            "tool_calls": meta.tool_calls,
            "guardrail_flags": flags_count,
            "confidence": report.overall_confidence,
            "status": report.status,
            "error": "",
        })
