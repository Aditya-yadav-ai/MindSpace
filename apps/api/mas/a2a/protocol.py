"""Shared A2A protocol definitions for the MindSpace crew agent.

The wire contract is deliberately narrow and honest:

* one advertised skill, ``market_research``, because that is the only stage
  the crew can complete with verifiable evidence (the report layer refuses to
  emit product/pricing sections without observed data);
* requests and results travel as a JSON object in a single ``text`` part with
  media type ``application/json``. JSON text keeps integer types intact, which
  a protobuf ``Value`` (always double) would not;
* unknown skills, missing ``query`` values and unparsable payloads raise
  :class:`InvalidPayloadError`, which the server maps onto a JSON-RPC
  ``InvalidParams`` error instead of returning a fake success.
"""
from __future__ import annotations

import json

from typing import Any, Dict, Mapping, Optional

from a2a.types import (
    AgentCapabilities,
    AgentCard,
    AgentInterface,
    AgentSkill,
)
from a2a.utils.constants import (
    AGENT_CARD_WELL_KNOWN_PATH,
    PROTOCOL_VERSION_CURRENT,
    TransportProtocol,
)

AGENT_NAME = "MindSpace Ecommerce Research Agent"
AGENT_DESCRIPTION = (
    "Runs the MindSpace evidence-backed market research crew and returns "
    "structured results with source URLs."
)
AGENT_VERSION = "1.0.0"

JSONRPC_PATH = "/a2a"
JSON_MEDIA_TYPE = "application/json"
TEXT_MEDIA_TYPE = "text/plain"

SKILL_MARKET_RESEARCH = "market_research"
SUPPORTED_SKILLS = (SKILL_MARKET_RESEARCH,)

SUPPORTED_ARCHITECTURES = ("sequential", "parallel", "hierarchical", "react")
DEFAULT_ARCHITECTURE = "sequential"
DEFAULT_PERSONA = "professional_analyst"

__all__ = [
    "AGENT_CARD_WELL_KNOWN_PATH",
    "AGENT_DESCRIPTION",
    "AGENT_NAME",
    "AGENT_VERSION",
    "DEFAULT_ARCHITECTURE",
    "DEFAULT_PERSONA",
    "InvalidPayloadError",
    "JSONRPC_PATH",
    "JSON_MEDIA_TYPE",
    "SKILL_MARKET_RESEARCH",
    "SUPPORTED_ARCHITECTURES",
    "SUPPORTED_SKILLS",
    "build_agent_card",
    "decode_request_payload",
    "encode_payload",
    "normalize_task_input",
]


class InvalidPayloadError(ValueError):
    """A request did not carry a usable MindSpace task payload."""


def build_agent_card(base_url: str) -> AgentCard:
    """Build the A2A agent card advertised at the well-known path.

    ``base_url`` is the externally reachable origin of the A2A server; the
    JSON-RPC interface URL is derived from it so a client that resolves the
    card can send messages without extra configuration.
    """
    rpc_url = f"{base_url.rstrip('/')}{JSONRPC_PATH}"
    return AgentCard(
        name=AGENT_NAME,
        description=AGENT_DESCRIPTION,
        version=AGENT_VERSION,
        supported_interfaces=[
            AgentInterface(
                url=rpc_url,
                protocol_binding=TransportProtocol.JSONRPC.value,
                protocol_version=PROTOCOL_VERSION_CURRENT,
            )
        ],
        capabilities=AgentCapabilities(
            streaming=False,
            push_notifications=False,
        ),
        default_input_modes=[JSON_MEDIA_TYPE, TEXT_MEDIA_TYPE],
        default_output_modes=[JSON_MEDIA_TYPE],
        skills=[
            AgentSkill(
                id=SKILL_MARKET_RESEARCH,
                name="Market research",
                description=(
                    "Collect live market research evidence for an e-commerce "
                    "query and return a structured report with source URLs."
                ),
                tags=["market-research", "ecommerce", "web-evidence"],
                examples=[
                    "Research the wireless earbuds market for a product team",
                ],
                input_modes=[JSON_MEDIA_TYPE, TEXT_MEDIA_TYPE],
                output_modes=[JSON_MEDIA_TYPE],
            )
        ],
    )


def encode_payload(payload: Mapping[str, Any]) -> str:
    """Serialise a payload for a ``text`` part without losing JSON types."""
    return json.dumps(dict(payload), ensure_ascii=False)


def decode_request_payload(message: Optional[Any]) -> Dict[str, Any]:
    """Extract the JSON object carried by an A2A ``Message``.

    Accepts either a ``data`` part (converted back to plain JSON) or a ``text``
    part containing a JSON object. Anything else is rejected explicitly.
    """
    if message is None:
        raise InvalidPayloadError("Request did not include a message")

    parts = list(getattr(message, "parts", []) or [])
    if not parts:
        raise InvalidPayloadError("Request message has no content parts")

    data_payload: Optional[Dict[str, Any]] = None
    text_error: Optional[Exception] = None

    for part in parts:
        kind = part.WhichOneof("content")
        if kind == "data":
            from google.protobuf import json_format

            try:
                value = json_format.MessageToDict(part.data)
            except Exception as error:  # noqa: BLE001 - surfaced to the caller
                text_error = error
                continue
            if isinstance(value, dict):
                data_payload = value
                break
        elif kind == "text":
            text = (part.text or "").strip()
            if not text:
                continue
            try:
                value = json.loads(text)
            except json.JSONDecodeError as error:
                text_error = error
                continue
            if isinstance(value, dict):
                return value

    if data_payload is not None:
        return data_payload

    if text_error is not None:
        raise InvalidPayloadError(
            f"Payload is not a JSON object: {type(text_error).__name__}: {text_error}"
        )
    raise InvalidPayloadError(
        "Request message must contain a JSON object in a text or data part"
    )


def normalize_task_input(payload: Mapping[str, Any]) -> Dict[str, Any]:
    """Validate and normalise a task payload.

    Raises:
        InvalidPayloadError: when the payload cannot be executed as-is, i.e.
            an unsupported skill, a missing query, or a bad architecture.
    """
    if not isinstance(payload, Mapping):
        raise InvalidPayloadError("Payload must be a JSON object")

    skill = payload.get("skill", SKILL_MARKET_RESEARCH)
    if not isinstance(skill, str) or skill not in SUPPORTED_SKILLS:
        raise InvalidPayloadError(
            f"Unsupported skill: {skill!r}. Supported skills: "
            f"{', '.join(SUPPORTED_SKILLS)}"
        )

    query = payload.get("query")
    if not isinstance(query, str) or not query.strip():
        raise InvalidPayloadError("Missing required field: query (non-empty string)")

    persona = payload.get("persona", DEFAULT_PERSONA)
    if not isinstance(persona, str) or not persona.strip():
        raise InvalidPayloadError("Field persona must be a non-empty string")

    architecture = payload.get("architecture", DEFAULT_ARCHITECTURE)
    if architecture not in SUPPORTED_ARCHITECTURES:
        raise InvalidPayloadError(
            f"Unsupported architecture: {architecture!r}. Supported: "
            f"{', '.join(SUPPORTED_ARCHITECTURES)}"
        )

    run_id = payload.get("run_id", "")
    if run_id is None:
        run_id = ""
    if not isinstance(run_id, str):
        raise InvalidPayloadError("Field run_id must be a string")

    return {
        "query": query.strip(),
        "persona": persona,
        "architecture": architecture,
        "run_id": run_id,
        "skill": skill,
    }
