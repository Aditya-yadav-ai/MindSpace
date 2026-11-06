"""
Pydantic structured output schemas for the MAS.
Requirement #3: All final outputs use these models.
"""
from __future__ import annotations
import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional, Tuple
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator
import uuid


# ─── Tool output schemas ────────────────────────────────────────────────────

class WebSearchResult(BaseModel):
    query: str
    results: List[Dict[str, Any]] = Field(default_factory=list)
    total_results: int = 0
    search_time_ms: float = 0.0
    error: Optional[str] = None
    backend: Optional[str] = None
    backends_tried: List[str] = Field(default_factory=list)

    @field_validator("results", mode="before")
    @classmethod
    def validate_results(cls, results: Any) -> Any:
        if not isinstance(results, list):
            raise ValueError("Search results must be a list.")
        for index, result in enumerate(results):
            if not isinstance(result, dict):
                raise ValueError(f"Search result {index} must be an object.")
            for field in ("title", "url", "snippet"):
                if not isinstance(result.get(field), str):
                    raise ValueError(
                        f"Search result {index} must include a string {field}."
                    )
            try:
                source_url = result["url"]
                parsed_url = urlsplit(source_url)
                port = parsed_url.port
                if (
                    parsed_url.scheme.lower() not in ("http", "https")
                    or not parsed_url.hostname
                    or (port is not None and not 1 <= port <= 65535)
                    or any(character.isspace() for character in source_url)
                ):
                    raise ValueError
            except ValueError:
                raise ValueError(
                    f"Search result {index} must include a valid HTTP(S) URL."
                ) from None
        return results


class ForecastResult(BaseModel):
    product_name: str
    historical_prices: List[float]
    forecast_30d: List[float]
    trend: Literal["upward", "downward", "stable"]
    confidence: float = Field(ge=0.0, le=1.0)
    mae: float  # mean absolute error
    recommended_price: float


# ─── Agent output schemas ───────────────────────────────────────────────────

class MarketResearchOutput(BaseModel):
    query: str
    market_size_estimate: str
    top_competitors: List[str] = Field(default_factory=list)
    trends: List[str] = Field(default_factory=list)
    sentiment: Optional[Literal["positive", "neutral", "negative"]] = None
    sources: List[str] = Field(default_factory=list)
    raw_search_data: Optional[str] = None
    agent_name: str = "market_researcher"
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class ProductAnalysisOutput(BaseModel):
    product_name: str
    category: str
    avg_price: float
    price_range: Tuple[float, float]
    demand_score: float = Field(ge=0.0, le=10.0)
    competitor_count: int
    unique_selling_points: List[str] = Field(default_factory=list)
    weaknesses: List[str] = Field(default_factory=list)
    agent_name: str = "product_analyst"
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class PricingOutput(BaseModel):
    product_name: str
    current_market_price: float
    recommended_price: float
    price_floor: float
    price_ceiling: float
    margin_estimate_pct: float
    forecast_30d: List[float] = Field(default_factory=list)
    pricing_rationale: str
    agent_name: str = "pricing_optimizer"
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class GuardrailFlags(BaseModel):
    toxicity_detected: bool = False
    injection_detected: bool = False
    type_errors: List[str] = Field(default_factory=list)
    sanitized_input: Optional[str] = None
    risk_level: Literal["low", "medium", "high"] = "low"
    blocked: bool = False
    reason: Optional[str] = None


class ExecutionMetadata(BaseModel):
    run_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    persona: str
    architecture: Literal["react", "sequential", "hierarchical", "parallel"]
    total_latency_ms: float = 0.0
    llm_tokens_used: int = 0
    estimated_cost_usd: float = 0.0
    tool_calls: int = 0
    agent_steps: int = 0
    errors: List[str] = Field(default_factory=list)
    blackboard_reads: int = 0
    blackboard_writes: int = 0
    a2a_calls: int = 0
    p2p_messages_sent: int = 0
    p2p_messages_received: int = 0
    # Which mechanism owned task dispatch for this run. Exactly one of:
    # "a2a" (A2A JSON-RPC), "p2p" (in-process crew with P2P hand-off),
    # "local" (in-process fallback after an A2A failure), "none" (not run).
    dispatch_transport: Literal["a2a", "p2p", "local", "none"] = "none"


class FinalIntelligenceReport(BaseModel):
    """The final structured output of the entire MAS pipeline."""
    report_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    query: str
    persona: str
    market_research: Optional[MarketResearchOutput] = None
    product_analysis: Optional[ProductAnalysisOutput] = None
    pricing_recommendation: Optional[PricingOutput] = None
    guardrail_flags: GuardrailFlags = Field(default_factory=GuardrailFlags)
    execution_metadata: ExecutionMetadata = Field(default_factory=lambda: ExecutionMetadata(persona="unknown", architecture="sequential"))
    executive_summary: str = ""
    risk_assessment: Literal["low", "medium", "high"] = "medium"
    overall_confidence: float = Field(ge=0.0, le=1.0, default=0.5)
    markdown_report: str = ""
    status: Literal["success", "partial", "blocked", "error"] = "success"

    def to_markdown(self) -> str:
        """Render the report as a rich Markdown document."""
        lines = [
            f"# 🛒 E-commerce Intelligence Report",
            f"**Report ID**: `{self.report_id}`",
            f"**Generated**: {self.timestamp.strftime('%Y-%m-%d %H:%M:%S UTC')}",
            f"**Query**: {self.query}",
            f"**Persona**: {self.persona}",
            f"**Status**: {self.status.upper()}",
            f"**Overall Confidence**: {self.overall_confidence:.0%}",
            "",
            "---",
            "",
            f"## 📋 Executive Summary",
            self.executive_summary,
            "",
        ]
        if self.market_research:
            mr = self.market_research
            sentiment = mr.sentiment.capitalize() if mr.sentiment else "Not assessed"
            lines += [
                "## 🌐 Market Research",
                f"| Field | Value |",
                f"|-------|-------|",
                f"| Market Size | {mr.market_size_estimate} |",
                f"| Sentiment | {sentiment} |",
                f"| Top Competitors | {', '.join(mr.top_competitors[:3])} |",
                "",
                "**Key Trends:**",
            ] + [f"- {t}" for t in mr.trends] + [""]
            if mr.sources:
                lines += ["**Sources:**"] + [f"- {source}" for source in mr.sources] + [""]
        if self.product_analysis:
            pa = self.product_analysis
            lines += [
                "## 📦 Product Analysis",
                f"| Metric | Value |",
                f"|--------|-------|",
                f"| Product | {pa.product_name} |",
                f"| Category | {pa.category} |",
                f"| Avg Price | ${pa.avg_price:.2f} |",
                f"| Price Range | ${pa.price_range[0]:.2f} - ${pa.price_range[1]:.2f} |",
                f"| Demand Score | {pa.demand_score:.1f}/10 |",
                f"| Competitors | {pa.competitor_count} |",
                "",
            ]
        if self.pricing_recommendation:
            pr = self.pricing_recommendation
            lines += [
                "## 💰 Pricing Recommendation",
                f"| Field | Value |",
                f"|-------|-------|",
                f"| Recommended Price | **${pr.recommended_price:.2f}** |",
                f"| Price Floor | ${pr.price_floor:.2f} |",
                f"| Price Ceiling | ${pr.price_ceiling:.2f} |",
                f"| Est. Margin | {pr.margin_estimate_pct:.1f}% |",
                "",
                f"**Rationale**: {pr.pricing_rationale}",
                "",
            ]
        meta = self.execution_metadata
        lines += [
            "## ⚙️ Execution Metadata",
            f"| Metric | Value |",
            f"|--------|-------|",
            f"| Architecture | {meta.architecture} |",
            f"| Total Latency | {meta.total_latency_ms:.0f}ms |",
            f"| LLM Tokens | {meta.llm_tokens_used:,} |",
            f"| Est. Cost | ${meta.estimated_cost_usd:.4f} |",
            f"| Tool Calls | {meta.tool_calls} |",
            f"| Blackboard R/W | {meta.blackboard_reads}/{meta.blackboard_writes} |",
            f"| A2A Calls | {meta.a2a_calls} |",
            f"| P2P Messages (sent/received) | {meta.p2p_messages_sent}/{meta.p2p_messages_received} |",
            f"| Task Dispatch Ownership | {meta.dispatch_transport} |",
            "",
            "## 🛡️ Guardrail Flags",
            f"- Risk Level: **{self.guardrail_flags.risk_level.upper()}**",
            f"- Toxicity: {'⚠️ Yes' if self.guardrail_flags.toxicity_detected else '✅ No'}",
            f"- Injection: {'⚠️ Yes' if self.guardrail_flags.injection_detected else '✅ No'}",
            f"- Blocked: {'🚫 Yes' if self.guardrail_flags.blocked else '✅ No'}",
            "",
            "---",
            "*Generated by MAS E-commerce Intelligence System | CrewAI + Google ADK*",
        ]
        return "\n".join(lines)


# ─── Blackboard message schema ──────────────────────────────────────────────

class BlackboardEntry(BaseModel):
    key: str
    value: Any
    agent_name: str
    run_id: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    version: int = 1


# ─── P2P message schema ─────────────────────────────────────────────────────

#: Agent identifiers are lower-case snake_case names (``adk_orchestrator``).
P2P_AGENT_ID_PATTERN = re.compile(r"^[a-z][a-z0-9_]{1,63}$")
#: Correlation/delivery identifiers are opaque tokens, safe for SQL + logs.
P2P_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
P2P_MESSAGE_TYPES = frozenset(
    {
        "task_request",
        "task_result",
        "status_update",
        "query",
        "reply",
        "data",
        "alert",
        "error",
    }
)
#: Hard cap on a single message payload to keep the mailbox bounded.
MAX_P2P_CONTENT_BYTES = 64 * 1024


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class P2PMessage(BaseModel):
    """A validated point-to-point message between two named agents.

    Unlike a blackboard entry, a P2P message is *addressed*: it belongs to one
    recipient, is consumed exactly once, and is correlated to a task/run via
    ``correlation_id``.
    """

    model_config = ConfigDict(frozen=True)

    msg_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    correlation_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    sender: str
    recipient: str
    content: Any
    msg_type: str = "data"
    created_at: datetime = Field(default_factory=_utc_now)
    delivered_at: Optional[datetime] = None
    acknowledged: bool = False

    @field_validator("msg_id", "correlation_id")
    @classmethod
    def _validate_token(cls, value: Any, info) -> str:
        if not isinstance(value, str) or not P2P_TOKEN_PATTERN.match(value):
            raise ValueError(
                f"{info.field_name} must match {P2P_TOKEN_PATTERN.pattern}."
            )
        return value

    @field_validator("sender", "recipient")
    @classmethod
    def _validate_agent_id(cls, value: Any, info) -> str:
        if not isinstance(value, str) or not P2P_AGENT_ID_PATTERN.match(value):
            raise ValueError(
                f"{info.field_name} must match {P2P_AGENT_ID_PATTERN.pattern}."
            )
        return value

    @field_validator("msg_type")
    @classmethod
    def _validate_msg_type(cls, value: Any) -> str:
        if value not in P2P_MESSAGE_TYPES:
            allowed = ", ".join(sorted(P2P_MESSAGE_TYPES))
            raise ValueError(f"msg_type must be one of: {allowed}.")
        return value

    @field_validator("content")
    @classmethod
    def _validate_content(cls, value: Any) -> Any:
        if value is None:
            raise ValueError("content must not be None.")
        try:
            encoded = json.dumps(value, default=_reject_non_serialisable)
        except (TypeError, ValueError) as error:
            raise ValueError(f"content must be JSON serialisable: {error}") from error
        size = len(encoded.encode("utf-8"))
        if size > MAX_P2P_CONTENT_BYTES:
            raise ValueError(
                f"content is {size} bytes; the limit is {MAX_P2P_CONTENT_BYTES}."
            )
        return value

    @field_validator("created_at", "delivered_at")
    @classmethod
    def _validate_timestamp(cls, value: Optional[datetime]) -> Optional[datetime]:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value

    def to_envelope(self) -> Dict[str, Any]:
        """Serialise the message for transport/logging."""
        return json.loads(self.model_dump_json())


def _reject_non_serialisable(value: Any) -> Any:
    raise TypeError(f"{type(value).__name__} is not JSON serialisable")


# ─── Performance evaluation schemas ────────────────────────────────────────

class ExperimentRun(BaseModel):
    run_id: str
    run_number: int
    persona: str
    architecture: str
    query: str
    latency_ms: float
    tokens_used: int
    estimated_cost_usd: float
    tool_calls: int
    guardrail_flags: int
    confidence: float
    status: str
    error: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


# ─── Vision / Screenshot Understanding Schemas ──────────────────────────────

class ScreenEntity(BaseModel):
    category: str
    value: str
    confidence: float = 1.0


class ScreenshotUnderstanding(BaseModel):
    screenshot_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    url: str = ""
    title: str = ""
    layout_type: str = "general"
    summary: str = ""
    extracted_text: str = ""
    entities: List[ScreenEntity] = Field(default_factory=list)
    suggested_actions: List[str] = Field(default_factory=list)
    recommended_agents: List[str] = Field(default_factory=list)
    risk_level: Literal["low", "medium", "high"] = "low"
    image_valid: bool = False
    visual_metadata: Dict[str, Any] = Field(default_factory=dict)
    mode: Literal["live", "offline"] = "offline"
    mock: bool = True
    model: str = "offline-heuristic"
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

