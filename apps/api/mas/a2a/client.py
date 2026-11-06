"""
A2A Client (Requirement #6).

Calls the MindSpace A2A agent using the official ``a2a-sdk``:

1. resolve the AgentCard from ``/.well-known/agent-card.json``;
2. create an SDK ``Client`` for the advertised JSON-RPC interface;
3. send a ``message/send`` request carrying the task payload as JSON;
4. read the resulting task artifact (or message) back into a plain dict.

Every failure is explicit (see :mod:`mas.a2a.errors`): the client never
fabricates a successful crew run. ``run_task`` keeps its original synchronous
signature so existing callers do not change.
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import json
import logging

from typing import Any, Dict, Iterable, Optional

import httpx

from a2a.client import (
    A2ACardResolver,
    A2AClientError,
    A2AClientTimeoutError,
    AgentCardResolutionError,
    ClientConfig,
    ClientFactory,
)
from a2a.helpers.proto_helpers import new_text_message
from a2a.types import Role, SendMessageConfiguration, SendMessageRequest, TaskState
from a2a.utils.errors import A2AError as SdkA2AError
from a2a.utils.errors import JSON_RPC_ERROR_CODE_MAP

from mas.a2a.errors import (
    A2AExecutionError,
    A2AProtocolError,
    A2ATimeout,
    A2AUnavailable,
    A2AUnsupportedSkillError,
)
from mas.a2a.protocol import JSON_MEDIA_TYPE, TEXT_MEDIA_TYPE, encode_payload

logger = logging.getLogger(__name__)

__all__ = [
    "A2AClient",
    "A2AExecutionError",
    "A2AProtocolError",
    "A2ATimeout",
    "A2AUnavailable",
    "A2AUnsupportedSkillError",
]

_FAILED_STATES = {
    TaskState.TASK_STATE_FAILED,
    TaskState.TASK_STATE_REJECTED,
    TaskState.TASK_STATE_CANCELED,
}
_TERMINAL_STATES = _FAILED_STATES | {TaskState.TASK_STATE_COMPLETED}


def _run_coroutine_sync(coroutine: Any) -> Any:
    """Run a coroutine from synchronous code, even inside a running loop."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coroutine)
    # Called from a thread that already owns an event loop: run the A2A call
    # in a dedicated thread instead of nesting event loops.
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coroutine).result()


class A2AClient:
    """SDK-backed A2A client.

    Args:
        server_url: Base URL of the agent (agent card is resolved from it).
        transport: Optional httpx transport. Only used by tests to route
            requests to an in-process ASGI app; production uses the network.
    """

    def __init__(
        self,
        server_url: str,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ):
        self.server_url = server_url.rstrip("/")
        self.timeout = 120
        self._transport = transport

    def run_task(
        self, task_input: Dict[str, Any], timeout: int = 120
    ) -> Dict[str, Any]:
        """Send a task to the A2A agent and return its result.

        Args:
            task_input: Dictionary with query, persona, architecture, run_id
                and (optionally) skill.
            timeout: Maximum seconds to wait for the response.

        Returns:
            The crew result dictionary carried by the task artifact.

        Raises:
            A2AUnavailable: the card could not be resolved or the server is
                unreachable.
            A2ATimeout: the deadline expired.
            A2AUnsupportedSkillError: the agent rejected the skill.
            A2AProtocolError: the agent returned a protocol-level error.
            A2AExecutionError: the agent task ended in a failure state.
        """
        if timeout is None or timeout <= 0:
            raise ValueError("timeout must be greater than zero")

        self.timeout = timeout
        logger.info(
            "[A2A] Sending task to %s: query=%s",
            self.server_url,
            str(task_input.get("query", ""))[:80],
        )
        return _run_coroutine_sync(self._run_task_async(task_input, float(timeout)))

    async def _run_task_async(
        self, task_input: Dict[str, Any], timeout: float
    ) -> Dict[str, Any]:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(timeout),
            transport=self._transport,
        ) as http_client:
            card = await self._resolve_card(http_client)
            client = self._build_client(http_client, card)
            request = SendMessageRequest(
                message=new_text_message(
                    encode_payload(task_input),
                    media_type=JSON_MEDIA_TYPE,
                    role=Role.ROLE_USER,
                ),
                configuration=SendMessageConfiguration(
                    accepted_output_modes=[JSON_MEDIA_TYPE, TEXT_MEDIA_TYPE]
                ),
            )

            try:
                events = await asyncio.wait_for(
                    self._collect_events(client, request), timeout
                )
            except (asyncio.TimeoutError, httpx.TimeoutException,
                    A2AClientTimeoutError) as error:
                raise A2ATimeout(
                    f"A2A agent at {self.server_url} timed out after {timeout}s"
                ) from error
            except AgentCardResolutionError as error:
                raise A2AUnavailable(
                    f"A2A agent card could not be resolved at "
                    f"{self.server_url}: {error}"
                ) from error
            except httpx.HTTPError as error:
                raise A2AUnavailable(
                    f"A2A server not reachable at {self.server_url}: "
                    f"{type(error).__name__}: {error}"
                ) from error
            except SdkA2AError as error:
                raise self._protocol_error(error) from error

        result = self._extract_result(events)
        logger.info("[A2A] Task completed successfully")
        return result

    # ── discovery / transport ────────────────────────────────────────────

    async def _resolve_card(self, http_client: httpx.AsyncClient) -> Any:
        try:
            card = await A2ACardResolver(
                http_client, self.server_url
            ).get_agent_card()
        except (httpx.HTTPError, A2AClientError, ValueError) as error:
            raise A2AUnavailable(
                f"A2A agent card could not be resolved at {self.server_url}: "
                f"{type(error).__name__}: {error}"
            ) from error

        bindings = {
            interface.protocol_binding for interface in card.supported_interfaces
        }
        if "JSONRPC" not in bindings:
            # We only ship the JSON-RPC binding; refuse rather than guess.
            raise A2AProtocolError(
                "A2A agent card does not advertise a JSONRPC interface "
                f"(found: {', '.join(sorted(bindings)) or 'none'})"
            )
        return card

    def _build_client(self, http_client: httpx.AsyncClient, card: Any) -> Any:
        try:
            return ClientFactory(
                ClientConfig(
                    httpx_client=http_client,
                    streaming=False,
                    polling=False,
                    supported_protocol_bindings=["JSONRPC"],
                )
            ).create(card)
        except ValueError as error:
            raise A2AProtocolError(
                f"No compatible A2A transport for the agent card: {error}"
            ) from error

    @staticmethod
    async def _collect_events(client: Any, request: SendMessageRequest) -> list:
        return [event async for event in client.send_message(request)]

    # ── response interpretation ──────────────────────────────────────────

    def _extract_result(self, events: Iterable[Any]) -> Dict[str, Any]:
        events = list(events)
        if not events:
            raise A2AProtocolError(
                "A2A agent returned no response events"
            )

        for event in events:
            if event.HasField("message"):
                return self._result_from_message(event.message)
            if event.HasField("task"):
                return self._result_from_task(event.task)

        raise A2AProtocolError(
            "A2A agent returned an unsupported response payload"
        )

    def _result_from_message(self, message: Any) -> Dict[str, Any]:
        payload = self._json_from_parts(
            getattr(message, "parts", []),
            error="A2A agent message did not contain a JSON result",
        )
        return payload

    def _result_from_task(self, task: Any) -> Dict[str, Any]:
        state = task.status.state
        state_name = TaskState.Name(state)

        if state in _FAILED_STATES:
            reason = self._status_message_text(task)
            raise A2AExecutionError(
                f"A2A task ended in {state_name}"
                + (f": {reason}" if reason else ""),
                state=state_name,
            )
        if state not in _TERMINAL_STATES:
            raise A2AProtocolError(
                f"A2A task finished in non-terminal state {state_name}; "
                "no result was produced"
            )

        for artifact in task.artifacts:
            try:
                return self._json_from_parts(
                    artifact.parts,
                    error="A2A task artifact did not contain a JSON result",
                )
            except A2AProtocolError:
                continue

        reason = self._status_message_text(task)
        raise A2AProtocolError(
            "A2A task completed without a JSON artifact"
            + (f": {reason}" if reason else "")
        )

    @staticmethod
    def _json_from_parts(parts: Iterable[Any], error: str) -> Dict[str, Any]:
        # Prefer text parts: they preserve JSON integer types.
        for part in parts:
            if part.WhichOneof("content") == "text":
                text = (part.text or "").strip()
                if not text:
                    continue
                try:
                    value = json.loads(text)
                except json.JSONDecodeError as exc:
                    raise A2AProtocolError(f"{error}: {exc}") from exc
                if isinstance(value, dict):
                    return value
                raise A2AProtocolError(
                    f"{error}: JSON payload is {type(value).__name__}, expected object"
                )

        for part in parts:
            if part.WhichOneof("content") == "data":
                from google.protobuf import json_format

                value = json_format.MessageToDict(part.data)
                if isinstance(value, dict):
                    return value
                raise A2AProtocolError(
                    f"{error}: data payload is {type(value).__name__}, expected object"
                )

        raise A2AProtocolError(error)

    @staticmethod
    def _status_message_text(task: Any) -> Optional[str]:
        message = task.status.message
        if not message or not message.parts:
            return None
        texts = [
            part.text
            for part in message.parts
            if part.WhichOneof("content") == "text" and part.text
        ]
        if not texts:
            return None
        return "\n".join(texts)

    @staticmethod
    def _protocol_error(error: SdkA2AError) -> A2AProtocolError:
        code = JSON_RPC_ERROR_CODE_MAP.get(type(error))
        message = str(error) or type(error).__name__
        if code == -32602 and "unsupported skill" in message.lower():
            return A2AUnsupportedSkillError(message, code=code)
        return A2AProtocolError(message, code=code)
