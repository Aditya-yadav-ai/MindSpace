"""Pydantic request/response contracts for the `/v1` integration API.

These models are the boundary between the browser extension / TypeScript app
and the Python service. They are versioned: breaking changes require `/v2`.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

AssistAction = Literal["summarize", "explain", "extract", "ask"]

MAX_PAGE_TEXT_CHARS = 60_000
MAX_QUESTION_CHARS = 2_000


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class PageContext(BaseModel):
    """A single user-initiated page capture."""

    url: str = Field(default="", max_length=4096)
    title: str = Field(default="", max_length=512)
    domain: str = Field(default="", max_length=255)
    text: str = Field(default="", max_length=MAX_PAGE_TEXT_CHARS)
    word_count: int = Field(default=0, ge=0)
    text_truncated: bool = False
    captured_at: datetime = Field(default_factory=_utc_now)
    source: Literal["extension", "manual", "api"] = "api"

    @field_validator("text")
    @classmethod
    def _strip_nul(cls, value: str) -> str:
        return value.replace("\x00", "")

    @model_validator(mode="after")
    def _derive_fields(self) -> "PageContext":
        if not self.domain and self.url:
            from urllib.parse import urlparse

            host = urlparse(self.url).netloc
            object.__setattr__(self, "domain", host[:255])
        if self.text and not self.word_count:
            object.__setattr__(self, "word_count", len(self.text.split()))
        return self

    def truncated_text(self, limit: int) -> tuple[str, bool]:
        if len(self.text) <= limit:
            return self.text, False
        return self.text[:limit], True


class ContextIngestRequest(BaseModel):
    context: PageContext


class ContextIngestResponse(BaseModel):
    stored: bool
    client_id: str
    word_count: int
    truncated: bool
    stored_at: datetime


class ContextLatestResponse(BaseModel):
    context: PageContext | None
    age_seconds: float | None


class AssistRequest(BaseModel):
    action: AssistAction
    question: str = Field(default="", max_length=MAX_QUESTION_CHARS)
    context: PageContext | None = None
    max_words: int = Field(default=220, ge=40, le=800)

    @model_validator(mode="after")
    def _require_question_for_ask(self) -> "AssistRequest":
        if self.action == "ask" and not self.question.strip():
            raise ValueError("question is required when action is 'ask'")
        return self


class SourceRef(BaseModel):
    index: int = Field(ge=1)
    title: str = ""
    url: str = ""
    snippet: str = ""
    similarity: float | None = None


class GuardReport(BaseModel):
    truncated: bool = False
    injection_flags: list[str] = Field(default_factory=list)
    blocked: bool = False
    block_reason: str = ""


class Provenance(BaseModel):
    mode: Literal["live", "offline"]
    mock: bool
    model: str = ""
    prompt_version: str = "v1"
    context_source: str = ""
    context_domain: str = ""


class AssistResponse(BaseModel):
    request_id: str
    action: AssistAction
    result: str
    mode: Literal["live", "offline"]
    mock: bool
    model: str = ""
    sources: list[SourceRef] = Field(default_factory=list)
    guardrails: GuardReport = Field(default_factory=GuardReport)
    provenance: Provenance
    latency_ms: float = 0.0


class ErrorDetail(BaseModel):
    code: str
    message: str
    retryable: bool = False
    request_id: str = ""


class ErrorEnvelope(BaseModel):
    error: ErrorDetail


class ResearchRequest(BaseModel):
    query: str = Field(min_length=3, max_length=MAX_QUESTION_CHARS)
    persona: Literal[
        "professional_analyst", "casual_buyer", "technical_expert", "aggressive_trader", "toxic_user"
    ] = "professional_analyst"
    architecture: Literal["sequential", "hierarchical", "parallel"] = "sequential"


class ResearchResponse(BaseModel):
    request_id: str
    query: str
    persona: str
    architecture: str
    status: Literal["success", "partial", "error", "blocked"]
    summary: str
    sources: list[SourceRef] = Field(default_factory=list)
    mode: Literal["live", "offline"]
    mock: bool
    latency_ms: float = 0.0
    errors: list[str] = Field(default_factory=list)


class ScreenshotRequest(BaseModel):
    screenshot: str | None = None  # Base64 image data URL or raw base64 string
    url: str = Field(default="", max_length=4096)
    title: str = Field(default="", max_length=512)
    textContext: PageContext | None = None
    captured_at: datetime = Field(default_factory=_utc_now)


class ScreenshotAnalysis(BaseModel):
    detected_layout: str = "general"
    extracted_text: str = ""
    entities: dict[str, list[str]] = Field(default_factory=dict)
    suggested_tasks: list[str] = Field(default_factory=list)
    recommended_agents: list[str] = Field(default_factory=list)
    supervisor_plan: list[str] = Field(default_factory=list)
    image_valid: bool = False
    visual_metadata: dict[str, Any] = Field(default_factory=dict)


class ScreenshotResponse(BaseModel):
    request_id: str
    analysis: ScreenshotAnalysis
    mode: Literal["live", "offline"]
    mock: bool
    model: str = "offline-heuristic"
    latency_ms: float = 0.0

