"""
ADK Report Agent (Requirement #7).

Reads all intermediate results from the Blackboard and assembles
the final Pydantic-structured FinalIntelligenceReport.

This is the ADK-side agent that produces the structured output
required by Requirement #3.
"""
from __future__ import annotations

import logging
import json
from typing import Any, Optional

from pydantic import ValidationError

from mas.models.schemas import (
    FinalIntelligenceReport,
    MarketResearchOutput,
    PricingOutput,
    ExecutionMetadata,
    GuardrailFlags,
    WebSearchResult,
)

logger = logging.getLogger(__name__)


class ADKReportAgent:
    """
    ADK-style report generation agent.

    Reads from the Blackboard:
      - market_research  (written by CrewAI MarketResearcher)
      - product_analysis (written by CrewAI ProductAnalyst)
      - adk_pricing      (written by ADK PricingAgent)

    Assembles a FinalIntelligenceReport with full Pydantic validation
    and a Markdown rendering.
    """

    def __init__(self, blackboard: Any, callback_manager: Any):
        self.blackboard = blackboard
        self.cb = callback_manager

    def generate(
        self,
        query: str,
        persona: str,
        architecture: str,
        run_id: str,
        pricing_output: Optional[PricingOutput],
        guardrail_flags: GuardrailFlags,
        elapsed_ms: float,
        a2a_calls: int = 0,
        tokens_used: int = 0,
        p2p_messages_sent: int = 0,
        p2p_messages_received: int = 0,
        dispatch_transport: str = "none",
        execution_errors: Optional[list[str]] = None,
    ) -> FinalIntelligenceReport:
        """
        Read all blackboard entries and build the final report.
        """
        self.cb.on_agent_start("adk_report_agent", query)

        # Read raw crew outputs from the blackboard
        mr_raw = self.blackboard.read("market_research", run_id)
        self.cb.on_blackboard_read("market_research", "adk_report_agent")

        execution_errors = list(execution_errors or [])
        try:
            market_research = self._parse_market_research(
                "" if mr_raw is None else mr_raw, query
            )
        except (json.JSONDecodeError, ValidationError, ValueError, TypeError) as error:
            message = f"Invalid market research evidence: {error}"
            execution_errors.append(message)
            logger.warning("[ADKReportAgent] %s", message)
            market_research = None

        product_analysis = None
        bb_stats = self.blackboard.get_stats()

        # Determine overall status
        has_mr = market_research is not None
        has_pa = product_analysis is not None
        has_pr = pricing_output is not None

        if execution_errors:
            status = "error"
            confidence = 0.0
        elif has_mr and has_pa and has_pr:
            status = "success"
            confidence = 0.85
        elif has_mr or has_pa or has_pr:
            status = "partial"
            confidence = 0.5
        else:
            status = "error"
            confidence = 0.1

        # Build executive summary
        summary_parts = []
        if execution_errors:
            summary_parts.append(f"Market research unavailable: {execution_errors[0]}")
        elif market_research:
            summary_parts.append(
                f"Live search returned {len(market_research.sources)} sources. "
                "Product and pricing findings were not generated."
            )
        executive_summary = " ".join(summary_parts) if summary_parts else \
            "Analysis incomplete - some agents failed to produce output."

        # Risk assessment based on guardrails and data quality
        if guardrail_flags.risk_level == "high":
            risk_assessment = "high"
        elif not has_mr or not has_pa:
            risk_assessment = "high"
        elif not has_pr:
            risk_assessment = "medium"
        else:
            risk_assessment = "low"

        # Build execution metadata
        meta = ExecutionMetadata(
            run_id=run_id,
            persona=persona,
            architecture=architecture,
            total_latency_ms=elapsed_ms,
            llm_tokens_used=tokens_used,
            estimated_cost_usd=PerformanceCollector.estimate_cost(tokens_used)
            if tokens_used else 0.0,
            tool_calls=3 if (has_mr and has_pa and has_pr) else 1,
            agent_steps=sum([has_mr, has_pa, has_pr, True]),  # +1 for report agent
            blackboard_reads=bb_stats.get("reads", 0),
            blackboard_writes=bb_stats.get("writes", 0),
            a2a_calls=a2a_calls,
            p2p_messages_sent=p2p_messages_sent,
            p2p_messages_received=p2p_messages_received,
            dispatch_transport=dispatch_transport,
            errors=execution_errors,
        )

        report = FinalIntelligenceReport(
            query=query,
            persona=persona,
            market_research=market_research,
            product_analysis=product_analysis,
            pricing_recommendation=pricing_output,
            guardrail_flags=guardrail_flags,
            execution_metadata=meta,
            executive_summary=executive_summary,
            risk_assessment=risk_assessment,
            overall_confidence=confidence,
            status=status,
        )

        self.cb.on_agent_end("adk_report_agent", executive_summary, tokens=0)
        logger.info(f"[ADKReportAgent] Report generated: status={status} "
                     f"confidence={confidence:.0%}")
        return report

    def _parse_market_research(
        self, raw: str, query: str
    ) -> Optional[MarketResearchOutput]:
        """Parse structured live search evidence without inferring market claims."""
        if not isinstance(raw, str):
            raise ValueError("Market research evidence must be JSON text.")
        if not raw:
            return None

        evidence = json.loads(raw)
        validated_evidence = WebSearchResult.model_validate(evidence)
        if validated_evidence.error:
            raise ValueError(validated_evidence.error)
        if not validated_evidence.results:
            raise ValueError("Live search completed with no results.")

        return MarketResearchOutput(
            query=validated_evidence.query or query,
            market_size_estimate="Not established from returned sources.",
            top_competitors=[],
            trends=[],
            sentiment=None,
            sources=[result["url"] for result in validated_evidence.results],
            raw_search_data=raw,
        )

# Avoid circular import at module level
from mas.monitoring.performance import PerformanceCollector
