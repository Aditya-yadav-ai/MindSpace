"""Model invocation with an explicit, clearly-labelled offline fallback.

Live mode calls the configured model through LiteLLM. Offline mode produces a
deterministic extractive result derived from the real page text, prefixed with
``[SIMULATED]`` and reported with ``mock=true``. Mock text is never presented
as model output.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field

from app.config import Settings, settings as default_settings
from app.guardrails import redact_secrets
from app.runtime import MODE_LIVE, resolve_runtime
from app.schemas import AssistAction

SIMULATED_PREFIX = "[SIMULATED] "

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
_WORD = re.compile(r"[A-Za-z0-9][A-Za-z0-9'-]*")
_STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "in", "is", "are", "was", "were", "for", "on",
    "with", "as", "at", "by", "this", "that", "it", "from", "be", "you", "your", "we", "our",
}


class LLMError(Exception):
    """Raised when a live model call fails. `retryable` drives HTTP status."""

    def __init__(self, message: str, *, retryable: bool = True) -> None:
        super().__init__(message)
        self.retryable = retryable


@dataclass
class LLMResult:
    text: str
    model: str
    mock: bool
    prompt_tokens: int = 0
    completion_tokens: int = 0
    latency_ms: float = 0.0
    warnings: list[str] = field(default_factory=list)


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_SPLIT.split(text) if len(s.strip()) > 20]


def _keywords(text: str) -> list[str]:
    counts: dict[str, int] = {}
    for word in _WORD.findall(text.lower()):
        if len(word) < 4 or word in _STOPWORDS:
            continue
        counts[word] = counts.get(word, 0) + 1
    return [word for word, _ in sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:8]]


def _mock_summary(text: str, max_words: int) -> str:
    sentences = _sentences(text)[:4]
    if not sentences:
        return SIMULATED_PREFIX + "No readable sentences were available in the captured text."
    body = " ".join(sentences)
    words = body.split()[:max_words]
    points = "\n".join(f"- {s}" for s in sentences[1:3])
    return (
        f"{SIMULATED_PREFIX}Offline extractive summary (no model configured):\n"
        f"{' '.join(words)}\n{points}".strip()
    )


def _mock_explain(text: str, max_words: int, title: str, domain: str) -> str:
    sentences = _sentences(text)
    opening = sentences[0] if sentences else "The page contains little readable text."
    keywords = ", ".join(_keywords(text)[:5]) or "none detected"
    return (
        f"{SIMULATED_PREFIX}Offline explanation (no model configured):\n"
        f"Page: {title or 'untitled'} ({domain or 'unknown domain'}).\n"
        f"Main statement: {opening}\n"
        f"Frequently used terms: {keywords}.\n"
        f"The page has {len(text.split())} words; this explanation is heuristic, not model-generated."
    )[: max(400, max_words * 6)]


def _mock_extract(text: str) -> str:
    emails = sorted(set(re.findall(r"[\w.+-]+@[\w-]+\.[\w.]+", text)))[:5]
    urls = sorted(set(re.findall(r"https?://[^\s<>\"')]+", text)))[:5]
    numbers = sorted(set(re.findall(r"\b\d+(?:[.,]\d+)?\s?(?:%|USD|EUR|GBP|\$|€|£)?\b", text)))[:8]
    dates = sorted(set(re.findall(r"\b(?:19|20)\d{2}\b|\b\d{1,2}/\d{1,2}/\d{2,4}\b", text)))[:5]
    lines = [f"{SIMULATED_PREFIX}Offline extraction (no model configured):"]
    lines.append(f"- Emails: {', '.join(emails) if emails else 'not stated'}")
    lines.append(f"- Links: {', '.join(urls) if urls else 'not stated'}")
    lines.append(f"- Numbers: {', '.join(n.strip() for n in numbers) if numbers else 'not stated'}")
    lines.append(f"- Dates: {', '.join(dates) if dates else 'not stated'}")
    return "\n".join(lines)


def _mock_answer(text: str, question: str) -> str:
    words = {w for w in _WORD.findall(question.lower()) if len(w) > 3 and w not in _STOPWORDS}
    scored: list[tuple[int, str]] = []
    for sentence in _sentences(text):
        score = sum(1 for w in words if w in sentence.lower())
        if score:
            scored.append((score, sentence))
    scored.sort(key=lambda item: item[0], reverse=True)
    if not scored:
        return (
            f"{SIMULATED_PREFIX}The captured page does not appear to answer this question. "
            "No model is configured, so no generated answer was produced."
        )
    best = " ".join(s for _, s in scored[:2])
    return (
        f"{SIMULATED_PREFIX}Offline extractive answer (no model configured):\n{best}"
    )


def mock_result(
    action: AssistAction,
    text: str,
    *,
    question: str,
    max_words: int,
    title: str,
    domain: str,
) -> LLMResult:
    if action == "summarize":
        body = _mock_summary(text, max_words)
    elif action == "explain":
        body = _mock_explain(text, max_words, title, domain)
    elif action == "extract":
        body = _mock_extract(text)
    else:
        body = _mock_answer(text, question)
    return LLMResult(text=redact_secrets(body), model="offline-heuristic", mock=True)


def generate(
    action: AssistAction,
    messages: list[dict[str, str]],
    *,
    text: str,
    question: str,
    max_words: int,
    title: str = "",
    domain: str = "",
    config: Settings | None = None,
) -> LLMResult:
    """Produce an answer, live or clearly-labelled offline."""
    active = config if config is not None else default_settings
    state = resolve_runtime(active)
    if state.mode != MODE_LIVE:
        return mock_result(
            action, text, question=question, max_words=max_words, title=title, domain=domain
        )

    started = time.monotonic()
    try:
        import litellm  # imported lazily: keeps startup fast

        response = litellm.completion(
            model=active.model,
            messages=messages,
            api_key=active.groq_api_key,
            temperature=0.2,
            max_tokens=min(1024, max(256, max_words * 3)),
            timeout=active.llm_timeout_seconds,
            num_retries=1,
        )
    except Exception as error:  # noqa: BLE001 - classified below
        name = type(error).__name__
        err_str = str(error).lower()
        is_auth_error = (
            name in {"AuthenticationError", "PermissionDeniedError"}
            or "invalid_api_key" in err_str
            or "invalid api key" in err_str
            or "unauthorized" in err_str
            or "authentication" in err_str
            or "bad_api_key" in err_str
            or "401" in err_str
        )
        if is_auth_error:
            import logging

            logging.getLogger(__name__).warning(
                "Configured GROQ_API_KEY was rejected by provider (%s). "
                "Safely falling back to labelled simulated mode.",
                name,
            )
            fallback = mock_result(
                action, text, question=question, max_words=max_words, title=title, domain=domain
            )
            fallback.warnings.append(
                f"Model provider authentication failed ({name}); fell back safely to offline simulated mode."
            )
            return fallback

        retryable = name in {"Timeout", "APITimeoutError", "RateLimitError", "APIConnectionError", "InternalServerError"}
        clean_msg = f"Model call failed ({name})."
        if retryable:
            clean_msg += " This request may be retried."
        raise LLMError(
            clean_msg,
            retryable=retryable,
        ) from error

    latency_ms = round((time.monotonic() - started) * 1000, 2)
    try:
        content = response.choices[0].message.content or ""
    except (AttributeError, IndexError) as error:
        raise LLMError("Model returned an unexpected response shape.", retryable=True) from error

    usage = getattr(response, "usage", None)
    return LLMResult(
        text=redact_secrets(content.strip()),
        model=getattr(response, "model", active.model) or active.model,
        mock=False,
        prompt_tokens=int(getattr(usage, "prompt_tokens", 0) or 0),
        completion_tokens=int(getattr(usage, "completion_tokens", 0) or 0),
        latency_ms=latency_ms,
    )


def generate_vision_understanding(
    screenshot_base64: str,
    *,
    url: str = "",
    title: str = "",
    text: str = "",
    config: Settings | None = None,
) -> LLMResult:
    """Produce semantic visual understanding of a screenshot using a multimodal vision model.

    In live mode with a usable GROQ_API_KEY, LiteLLM invokes the configured vision-capable model
    (e.g. `groq/llama-3.2-11b-vision-preview`) with image content.
    In offline mode or when credentials are absent, safely falls back to transparently
    labelled simulated understanding without fabricating live model inference.
    """
    active = config if config is not None else default_settings
    state = resolve_runtime(active)
    if state.mode != MODE_LIVE:
        offline_summary = (
            f"{SIMULATED_PREFIX}Offline visual understanding (no vision model configured):\n"
            f"Page: '{title or 'untitled'}' ({url or 'unknown'})\n"
            "Visual semantic analysis is simulated because the service is running in offline mode."
        )
        return LLMResult(
            text=redact_secrets(offline_summary),
            model="offline-heuristic",
            mock=True,
        )

    started = time.monotonic()
    raw_b64 = screenshot_base64.strip()
    if not raw_b64.startswith("data:"):
        image_url = f"data:image/png;base64,{raw_b64}"
    else:
        image_url = raw_b64

    prompt = (
        "You are the Vision Agent for MindSpace, an agentic AI browser assistant.\n"
        "Carefully analyze this browser screenshot to understand the layout and task context.\n"
        f"Context URL: {url or 'unknown'}\n"
        f"Context Title: {title or 'untitled'}\n"
        f"Context Text: {text[:600] if text else 'none'}\n\n"
        "Respond in strictly valid JSON format with these exact keys:\n"
        "{\n"
        '  "layout_type": "string (one of: calendar_schedule, communication, workspace_document, ecommerce, article, dashboard, general)",\n'
        '  "summary": "string (concise semantic description of visible screen elements, modals, forms, charts)",\n'
        '  "visible_intents": ["list of strings representing what the user is viewing or trying to accomplish"],\n'
        '  "suggested_actions": ["list of actionable follow-ups"],\n'
        '  "recommended_agents": ["list of agent names from: manager, calendar, gmail, drive, docs, sheets, slides, forms, meet, classroom, chat, summarizer, extractor, knowledge, researcher, product"]\n'
        "}"
    )

    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": image_url}},
            ],
        }
    ]

    try:
        import litellm

        response = litellm.completion(
            model=active.vision_model,
            messages=messages,
            api_key=active.groq_api_key,
            temperature=0.1,
            max_tokens=1024,
            timeout=active.llm_timeout_seconds,
            num_retries=1,
        )
    except Exception as error:  # noqa: BLE001
        name = type(error).__name__
        err_str = str(error).lower()
        is_auth_error = (
            name in {"AuthenticationError", "PermissionDeniedError"}
            or "invalid_api_key" in err_str
            or "invalid api key" in err_str
            or "unauthorized" in err_str
            or "authentication" in err_str
            or "bad_api_key" in err_str
            or "401" in err_str
        )
        if is_auth_error:
            import logging

            logging.getLogger(__name__).warning(
                "Configured GROQ_API_KEY was rejected by provider during vision inference (%s). "
                "Safely falling back to labelled simulated mode.",
                name,
            )
            fallback = LLMResult(
                text=redact_secrets(
                    f"{SIMULATED_PREFIX}Vision provider authentication failed ({name}); "
                    "fell back safely to offline simulated mode."
                ),
                model="offline-heuristic",
                mock=True,
            )
            fallback.warnings.append(f"Vision provider authentication failed ({name}).")
            return fallback

        retryable = name in {
            "Timeout",
            "APITimeoutError",
            "RateLimitError",
            "APIConnectionError",
            "InternalServerError",
        }
        clean_msg = f"Vision model call failed ({name})."
        if retryable:
            clean_msg += " This request may be retried."
        raise LLMError(clean_msg, retryable=retryable) from error

    latency_ms = round((time.monotonic() - started) * 1000, 2)
    try:
        content = response.choices[0].message.content or ""
    except (AttributeError, IndexError) as error:
        raise LLMError("Vision model returned an unexpected response shape.", retryable=True) from error

    usage = getattr(response, "usage", None)
    return LLMResult(
        text=redact_secrets(content.strip()),
        model=getattr(response, "model", active.vision_model) or active.vision_model,
        mock=False,
        prompt_tokens=int(getattr(usage, "prompt_tokens", 0) or 0),
        completion_tokens=int(getattr(usage, "completion_tokens", 0) or 0),
        latency_ms=latency_ms,
    )


def get_provider_status(config: Settings | None = None) -> dict[str, Any]:
    """Expose transparent provider availability and active model configuration."""
    active = config if config is not None else default_settings
    state = resolve_runtime(active)
    return {
        "provider": "groq",
        "mode": state.mode,
        "mock": state.mode != MODE_LIVE,
        "configured_model": active.model,
        "vision_model": active.vision_model,
        "has_usable_api_key": bool(active.groq_api_key and len(active.groq_api_key.strip()) > 10),
        "timeout_seconds": active.llm_timeout_seconds,
        "fallback_engine": "offline-heuristic-rag",
        "fallback_ready": True,
    }
