"""Resolve whether the service is running live or in labelled mock mode.

The service never reports "live" unless a usable LLM key is present. When no
key is configured, offline/mock mode is selected automatically and every
consumer must label its output as simulated.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.config import Settings, is_usable_api_key, settings

MODE_LIVE = "live"
MODE_OFFLINE = "offline"


@dataclass(frozen=True)
class RuntimeState:
    """Immutable description of how the service is currently running."""

    mode: str
    mock: bool
    llm_configured: bool
    offline_requested: bool | None
    reason: str

    def as_dict(self) -> dict[str, object]:
        return {
            "mode": self.mode,
            "mock": self.mock,
            "llm_configured": self.llm_configured,
            "offline_requested": self.offline_requested,
            "reason": self.reason,
        }


def resolve_runtime(config: Settings | None = None) -> RuntimeState:
    """Decide the runtime mode from configuration.

    Rules, in order:
    1. ``MINDSPACE_OFFLINE=1`` always wins and is reported as explicit.
    2. No usable key means mock mode, whatever the operator asked for.
    3. Only an explicit non-offline setting with a usable key is live.
    """
    active = config if config is not None else settings
    configured = is_usable_api_key(active.groq_api_key)
    requested = active.offline_mode

    if requested is True:
        return RuntimeState(
            mode=MODE_OFFLINE,
            mock=True,
            llm_configured=configured,
            offline_requested=requested,
            reason="offline mode explicitly enabled via MINDSPACE_OFFLINE",
        )

    if not configured:
        if requested is False:
            reason = (
                "MINDSPACE_OFFLINE=0 but no usable GROQ_API_KEY is configured; "
                "falling back to labelled mock mode"
            )
        else:
            reason = "no usable GROQ_API_KEY is configured"
        return RuntimeState(
            mode=MODE_OFFLINE,
            mock=True,
            llm_configured=False,
            offline_requested=requested,
            reason=reason,
        )

    return RuntimeState(
        mode=MODE_LIVE,
        mock=False,
        llm_configured=True,
        offline_requested=requested,
        reason="usable GROQ_API_KEY is configured",
    )
