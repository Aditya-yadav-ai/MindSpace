"""Typed failures for the A2A client.

The client never invents a result: every failure mode the transport can
produce is surfaced as one of these exceptions so callers can decide what to
do (the orchestrator records the failure and falls back to an in-process crew
run, which is labelled as such in the report metadata).
"""
from __future__ import annotations

from typing import Optional


class A2AError(Exception):
    """Base class for every failure raised by :class:`A2AClient`."""


class A2AUnavailable(A2AError):
    """The agent card could not be resolved or the server is unreachable."""


class A2ATimeout(A2AError):
    """The remote agent did not answer within the caller's deadline."""


class A2AProtocolError(A2AError):
    """The remote agent answered with an A2A/JSON-RPC error."""

    def __init__(self, message: str, code: Optional[int] = None) -> None:
        super().__init__(message)
        self.code = code


class A2AUnsupportedSkillError(A2AProtocolError):
    """The remote agent rejected the requested skill."""


class A2AExecutionError(A2AError):
    """The remote agent created a task that ended in a failure state."""

    def __init__(self, message: str, state: str = "TASK_STATE_FAILED") -> None:
        super().__init__(message)
        self.state = state
