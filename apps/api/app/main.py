"""FastAPI application for the MindSpace Python API service.

Endpoints:
- ``GET /health`` liveness probe, no I/O, stable shape.
- ``GET /ready`` readiness probe exposing the resolved runtime mode.
- ``POST /v1/context`` store a user-initiated page capture for this client.
- ``GET /v1/context/latest`` read the most recent capture (TTL bound).
- ``DELETE /v1/context`` forget the stored capture.
- ``POST /v1/assist`` summarise / explain / extract / answer about a capture.

Every response that contains generated text carries ``mode`` and ``mock`` so a
client can never mistake simulated output for a real model response.
"""

from __future__ import annotations

import logging
import time
import uuid
from contextvars import ContextVar
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings
from app.context_store import context_store
from app.guardrails import (
    MAX_UNTRUSTED_CHARS,
    check_question,
    redact_secrets,
    sanitise_untrusted,
    scan_injection,
)
from app.llm import LLMError, generate
from app.prompts import PROMPT_VERSION, build_messages
from app.runtime import resolve_runtime
from app.schemas import (
    AssistRequest,
    AssistResponse,
    ContextIngestRequest,
    ContextIngestResponse,
    ContextLatestResponse,
    ErrorDetail,
    ErrorEnvelope,
    GuardReport,
    Provenance,
    ScreenshotAnalysis,
    ScreenshotRequest,
    ScreenshotResponse,
    SourceRef,
)
from mas.agents.vision_agent import vision_agent

logger = logging.getLogger(__name__)

request_id_ctx: ContextVar[str] = ContextVar("request_id", default="")

CLIENT_ID_HEADER = "X-MindSpace-Client"
DEFAULT_CLIENT_ID = "local"
_MAX_CLIENT_ID = 64

CORS_ORIGIN_REGEX = (
    r"(chrome-extension://[a-p]{32}"
    r"|http://localhost:\d{1,5}"
    r"|http://127\.0\.0\.1:\d{1,5})"
)


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Attach a correlation id to every request and echo it back."""

    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        incoming = request.headers.get("X-Request-ID", "")
        request_id = incoming if incoming and len(incoming) <= 128 else uuid.uuid4().hex
        token = request_id_ctx.set(request_id)
        request.state.request_id = request_id
        try:
            response = await call_next(request)
        finally:
            request_id_ctx.reset(token)
        response.headers["X-Request-ID"] = request_id
        return response


def _error(status: int, code: str, message: str, *, retryable: bool = False) -> JSONResponse:
    envelope = ErrorEnvelope(
        error=ErrorDetail(
            code=code,
            message=redact_secrets(message),
            retryable=retryable,
            request_id=request_id_ctx.get(),
        )
    )
    return JSONResponse(status_code=status, content=envelope.model_dump())


def _client_id(value: str | None) -> str:
    if not value:
        return DEFAULT_CLIENT_ID
    cleaned = value.strip()
    if not cleaned or len(cleaned) > _MAX_CLIENT_ID:
        return DEFAULT_CLIENT_ID
    if not all(ch.isalnum() or ch in "-_.:@" for ch in cleaned):
        return DEFAULT_CLIENT_ID
    return cleaned


def create_app() -> FastAPI:
    # Initialise tracing once at startup so OTLP export (when configured via
    # OTEL_EXPORTER_OTLP_ENDPOINT) is active for every request, not only after
    # the first agent run.
    from mas.monitoring.observability import get_tracer

    get_tracer()

    application = FastAPI(
        title="MindSpace Agent API",
        version="1.0.0",
        description="Browser page assistant and multi-agent research service.",
    )
    application.add_middleware(RequestIdMiddleware)
    application.add_middleware(
        CORSMiddleware,
        allow_origin_regex=CORS_ORIGIN_REGEX,
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-Request-ID", CLIENT_ID_HEADER],
        expose_headers=["X-Request-ID"],
        max_age=600,
    )

    @application.exception_handler(RequestValidationError)
    async def _validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        location = ".".join(str(part) for part in first.get("loc", ()) if part != "body")
        detail = first.get("msg", "Invalid request")
        message = f"{location}: {detail}" if location else detail
        return _error(422, "validation_error", message)

    @application.exception_handler(HTTPException)
    async def _http_handler(_: Request, exc: HTTPException) -> JSONResponse:
        return _error(exc.status_code, "http_error", str(exc.detail))

    @application.exception_handler(Exception)
    async def _unhandled_handler(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error: %s", type(exc).__name__)
        return _error(500, "internal_error", "The service failed to handle this request.")

    @application.get("/health")
    def health_check() -> dict[str, bool]:
        """Liveness probe: the process is up and serving requests."""
        return {"ok": True}

    @application.get("/ready")
    def readiness_check() -> dict[str, object]:
        """Readiness probe with an explicit, machine-readable mode label."""
        state = resolve_runtime()
        return {
            "status": "ready",
            "service": settings.service_name,
            "port": settings.port,
            **state.as_dict(),
            "checks": {"config": "ok"},
        }

    @application.post("/v1/context", response_model=ContextIngestResponse)
    def ingest_context(
        payload: ContextIngestRequest,
        client: Annotated[str | None, Header(alias=CLIENT_ID_HEADER)] = None,
    ) -> ContextIngestResponse:
        context = payload.context
        text, truncated = sanitise_untrusted(context.text, MAX_UNTRUSTED_CHARS)
        if not text.strip():
            raise HTTPException(
                status_code=422,
                detail="captured text is empty; capture again or paste the page text manually",
            )
        context.text = text
        context.text_truncated = truncated
        context.word_count = len(text.split())
        client_id = _client_id(client)
        context_store.put(client_id, context)
        return ContextIngestResponse(
            stored=True,
            client_id=client_id,
            word_count=context.word_count,
            truncated=truncated,
            stored_at=context.captured_at,
        )

    @application.get("/v1/context/latest", response_model=ContextLatestResponse)
    def latest_context(
        client: Annotated[str | None, Header(alias=CLIENT_ID_HEADER)] = None,
    ) -> ContextLatestResponse:
        context, age = context_store.get(_client_id(client))
        return ContextLatestResponse(context=context, age_seconds=age)

    @application.delete("/v1/context")
    def clear_context(
        client: Annotated[str | None, Header(alias=CLIENT_ID_HEADER)] = None,
    ) -> dict[str, bool]:
        context_store.clear_client(_client_id(client))
        return {"cleared": True}

    @application.post("/v1/assist", response_model=AssistResponse)
    def assist(
        payload: AssistRequest,
        client: Annotated[str | None, Header(alias=CLIENT_ID_HEADER)] = None,
    ) -> AssistResponse:
        started = time.monotonic()
        client_id = _client_id(client)

        context = payload.context
        if context is None:
            context, _ = context_store.get(client_id)
        if context is None:
            raise HTTPException(
                status_code=409,
                detail="no page context is available; capture a page first",
            )

        text, truncated = sanitise_untrusted(context.text, MAX_UNTRUSTED_CHARS)
        if not text.strip():
            raise HTTPException(status_code=422, detail="page context contains no readable text")

        if payload.action == "ask":
            ok, reason = check_question(payload.question)
            if not ok:
                raise HTTPException(status_code=422, detail=reason)

        injection_flags = scan_injection(text)
        messages = build_messages(
            payload.action,
            text,
            question=payload.question,
            max_words=payload.max_words,
            title=context.title,
            url=context.url,
        )

        try:
            result = generate(
                payload.action,
                messages,
                text=text,
                question=payload.question,
                max_words=payload.max_words,
                title=context.title,
                domain=context.domain,
            )
        except LLMError as error:
            return _error(
                503,
                "model_unavailable",
                str(error),
                retryable=error.retryable,
            )  # type: ignore[return-value]

        mode_value = "offline" if result.mock else "live"
        sources: list[SourceRef] = []
        if context.url or context.title:
            snippet = " ".join(text.split()[:35])
            sources.append(
                SourceRef(index=1, title=context.title, url=context.url, snippet=snippet)
            )

        latency_ms = round((time.monotonic() - started) * 1000, 2)
        logger.info(
            "assist action=%s mode=%s mock=%s latency_ms=%s injection_flags=%s words=%s",
            payload.action,
            mode_value,
            result.mock,
            latency_ms,
            injection_flags,
            context.word_count,
        )

        return AssistResponse(
            request_id=request_id_ctx.get(),
            action=payload.action,
            result=result.text,
            mode=mode_value,
            mock=result.mock,
            model=result.model,
            sources=sources,
            guardrails=GuardReport(
                truncated=truncated or context.text_truncated,
                injection_flags=injection_flags,
                blocked=False,
            ),
            provenance=Provenance(
                mode=mode_value,
                mock=result.mock,
                model=result.model,
                prompt_version=PROMPT_VERSION,
                context_source=context.source,
                context_domain=context.domain,
            ),
            latency_ms=latency_ms,
        )

    @application.post("/v1/screenshot", response_model=ScreenshotResponse)
    async def analyze_screenshot(
        payload: ScreenshotRequest,
        client_id: Annotated[str, Header(alias="X-MindSpace-Client")] = "local",
    ) -> ScreenshotResponse:
        started = time.monotonic()
        text_context = payload.textContext.text if payload.textContext else ""
        understanding = vision_agent.analyze(
            screenshot_base64=payload.screenshot,
            url=payload.url,
            title=payload.title,
            text_context=text_context,
        )

        entities_dict: dict[str, list[str]] = {}
        for ent in understanding.entities:
            entities_dict.setdefault(ent.category, []).append(ent.value)

        supervisor_plan = [
            f"1. Vision Agent: Screen layout identified as '{understanding.layout_type}'.",
            f"2. Manager Agent: Selected specialist agents: {', '.join(understanding.recommended_agents)}.",
        ]
        for idx, act in enumerate(understanding.suggested_actions, start=3):
            supervisor_plan.append(f"{idx}. Workflow: {act}")

        latency_ms = round((time.monotonic() - started) * 1000, 2)
        return ScreenshotResponse(
            request_id=request_id_ctx.get(),
            analysis=ScreenshotAnalysis(
                detected_layout=understanding.layout_type,
                extracted_text=understanding.extracted_text,
                entities=entities_dict,
                suggested_tasks=understanding.suggested_actions,
                recommended_agents=understanding.recommended_agents,
                supervisor_plan=supervisor_plan,
                image_valid=understanding.image_valid,
                visual_metadata=understanding.visual_metadata,
            ),
            mode=understanding.mode,
            mock=understanding.mock,
            model=understanding.model,
            latency_ms=latency_ms,
        )

    @application.get("/v1/mas/activity")
    def get_mas_activity(
        limit: int = 50,
        run_id: str | None = None,
    ) -> dict[str, Any]:
        """Expose real Blackboard audit logs and P2P mailbox events from the multi-agent backend."""
        import json
        import sqlite3
        from pathlib import Path

        base_dir = Path(__file__).resolve().parent.parent / "mas" / "outputs"
        bb_path = base_dir / "blackboard.db"
        p2p_path = base_dir / "p2p_mailbox.db"

        audit_events: list[dict[str, Any]] = []
        if bb_path.exists():
            try:
                with sqlite3.connect(str(bb_path), timeout=3.0) as conn:
                    conn.row_factory = sqlite3.Row
                    query = "SELECT id, run_id, event_type, agent_name, details, created_at FROM audit_log"
                    params: list[Any] = []
                    if run_id:
                        query += " WHERE run_id = ?"
                        params.append(run_id)
                    query += " ORDER BY id DESC LIMIT ?"
                    params.append(limit)
                    rows = conn.execute(query, params).fetchall()
                    for r in rows:
                        det = r["details"]
                        try:
                            det = json.loads(det) if det else {}
                        except Exception:
                            pass
                        audit_events.append({
                            "id": r["id"],
                            "run_id": r["run_id"],
                            "event_type": r["event_type"],
                            "agent_name": r["agent_name"],
                            "details": det,
                            "created_at": r["created_at"],
                        })
            except Exception as e:
                logger.warning("Failed to query blackboard.db: %s", e)

        p2p_messages: list[dict[str, Any]] = []
        if p2p_path.exists():
            try:
                with sqlite3.connect(str(p2p_path), timeout=3.0) as conn:
                    conn.row_factory = sqlite3.Row
                    query = "SELECT seq, msg_id, correlation_id, sender, recipient, msg_type, content, created_at, delivered_at, acknowledged FROM p2p_messages"
                    params = []
                    if run_id:
                        query += " WHERE correlation_id = ?"
                        params.append(run_id)
                    query += " ORDER BY seq DESC LIMIT ?"
                    params.append(limit)
                    rows = conn.execute(query, params).fetchall()
                    for r in rows:
                        cnt = r["content"]
                        try:
                            cnt = json.loads(cnt) if cnt else {}
                        except Exception:
                            pass
                        p2p_messages.append({
                            "seq": r["seq"],
                            "msg_id": r["msg_id"],
                            "correlation_id": r["correlation_id"],
                            "sender": r["sender"],
                            "recipient": r["recipient"],
                            "msg_type": r["msg_type"],
                            "content": cnt,
                            "created_at": r["created_at"],
                            "delivered_at": r["delivered_at"],
                            "acknowledged": bool(r["acknowledged"]),
                        })
            except Exception as e:
                logger.warning("Failed to query p2p_mailbox.db: %s", e)

        return {
            "status": "ok",
            "stats": {
                "audit_events_count": len(audit_events),
                "p2p_messages_count": len(p2p_messages),
            },
            "blackboard_events": audit_events,
            "p2p_messages": p2p_messages,
        }

    return application


app = create_app()


if __name__ == "__main__":
    import uvicorn

    logging.basicConfig(level=logging.INFO)
    startup_state = resolve_runtime()
    if startup_state.mock:
        logger.warning(
            "Starting in OFFLINE/MOCK mode: %s. Produced results are simulated.",
            startup_state.reason,
        )
    else:
        logger.info("Starting in LIVE mode: %s", startup_state.reason)
    logger.info("Listening on %s:%s", settings.host, settings.port)
    uvicorn.run(app, host=settings.host, port=settings.port)
