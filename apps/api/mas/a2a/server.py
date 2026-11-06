"""
A2A Server (Requirement #6).

Exposes the CrewAI crew as an A2A agent using the official ``a2a-sdk``:

* ``GET /.well-known/agent-card.json`` — SDK-served AgentCard discovery.
* ``POST /a2a`` — SDK JSON-RPC endpoint (``message/send``, task routes).
* ``GET /.well-known/agent.json`` and ``POST /tasks`` — the original
  hand-rolled contract, kept for backward compatibility with existing
  consumers and tests.

The executor runs the real crew (in a worker thread) and reports explicit
failures: an unknown skill or an unparsable payload becomes a JSON-RPC
``InvalidParams`` error, and a crew exception becomes a ``FAILED`` task with
the error message attached. No run is ever reported as completed unless the
crew actually returned a result.

Run standalone: python -m mas.a2a.server
Or import and mount on an existing FastAPI app.
"""
from __future__ import annotations

import asyncio
import logging
import uuid

from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import FastAPI
from pydantic import BaseModel

from a2a.helpers.proto_helpers import new_task, new_text_message
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes import (
    add_a2a_routes_to_fastapi,
    create_agent_card_routes,
    create_jsonrpc_routes,
)
from a2a.server.tasks import InMemoryTaskStore, TaskUpdater
from a2a.types import Part, TaskState
from a2a.utils.errors import InvalidParamsError, UnsupportedOperationError

from mas.a2a.protocol import (
    JSONRPC_PATH,
    JSON_MEDIA_TYPE,
    InvalidPayloadError,
    build_agent_card,
    decode_request_payload,
    encode_payload,
    normalize_task_input,
)

logger = logging.getLogger(__name__)


class A2ATaskRequest(BaseModel):
    """A2A task envelope (legacy REST contract)."""
    input: Dict[str, Any]


class A2ATaskResponse(BaseModel):
    """A2A task response envelope (legacy REST contract)."""
    output: Dict[str, Any]


def _run_crew_for_task_input(task_input: Dict[str, Any]) -> Dict[str, Any]:
    """Run the CrewAI crew for an A2A task payload.

    Shared by the SDK executor and the legacy ``POST /tasks`` route so both
    paths execute the same real code. Imports stay inside the function so
    tests and deployments can patch/inject the heavy dependencies.
    """
    query = task_input.get("query", "")
    persona = task_input.get("persona", "professional_analyst")
    architecture = task_input.get("architecture", "sequential")
    run_id = task_input.get("run_id", "")

    logger.info("[A2A Server] Received task: query=%s", query[:80])

    from mas.blackboard.shared_state import get_blackboard
    from mas.monitoring.callbacks import MASCallbackManager
    from mas.monitoring.observability import get_tracer, get_audit_trail
    from mas.agents.crewai_crew.crew import EcommerceResearchCrew

    blackboard = get_blackboard()
    cb = MASCallbackManager(run_id, str(Path(blackboard.db_path).parent))
    audit = get_audit_trail(run_id)
    tracer = get_tracer()

    crew = EcommerceResearchCrew(
        blackboard=blackboard,
        callback_manager=cb,
        audit_trail=audit,
        tracer=tracer,
    )

    if architecture == "parallel":
        return crew.run_parallel(query, persona, run_id)
    if architecture == "hierarchical":
        return crew.run_hierarchical(query, persona, run_id)
    if architecture == "react":
        return crew.run_react(query, persona, run_id)
    return crew.run_sequential(query, persona, run_id)


class MindSpaceA2AExecutor(AgentExecutor):
    """A2A executor backed by the real MindSpace crew.

    The crew is synchronous (and may perform network I/O), so it runs in a
    worker thread while the A2A task reports ``WORKING``. The result is
    attached as a JSON artifact; failures are reported as ``FAILED`` tasks.
    """

    async def execute(
        self, context: RequestContext, event_queue: EventQueue
    ) -> None:
        task_id = context.task_id or str(uuid.uuid4())
        context_id = context.context_id or str(uuid.uuid4())

        try:
            raw_payload = decode_request_payload(context.message)
            payload = normalize_task_input(raw_payload)
        except InvalidPayloadError as error:
            # Explicit protocol error: nothing was executed.
            raise InvalidParamsError(message=str(error)) from error

        # The SDK requires a Task event before status updates in V2.
        await event_queue.enqueue_event(
            new_task(task_id, context_id, TaskState.TASK_STATE_WORKING)
        )
        updater = TaskUpdater(event_queue, task_id, context_id)

        try:
            result = await asyncio.to_thread(_run_crew_for_task_input, payload)
        except asyncio.CancelledError:
            logger.warning("[A2A Server] Task %s cancelled while running", task_id)
            raise
        except Exception as error:  # noqa: BLE001 - reported as a failed task
            logger.exception("[A2A Server] Crew execution failed for %s", task_id)
            await updater.update_status(
                TaskState.TASK_STATE_FAILED,
                message=new_text_message(
                    f"Crew execution failed: {type(error).__name__}: {error}"
                ),
            )
            return

        if not isinstance(result, dict):
            await updater.update_status(
                TaskState.TASK_STATE_FAILED,
                message=new_text_message(
                    "Crew returned an unexpected result type: "
                    f"{type(result).__name__}"
                ),
            )
            return

        await updater.add_artifact(
            [Part(text=encode_payload(result), media_type=JSON_MEDIA_TYPE)],
            name="crew_result",
        )
        await updater.update_status(TaskState.TASK_STATE_COMPLETED)

    async def cancel(
        self, context: RequestContext, event_queue: EventQueue
    ) -> None:
        raise UnsupportedOperationError(
            message="Task cancellation is not supported by the MindSpace crew"
        )


def create_a2a_app(base_url: Optional[str] = None) -> FastAPI:
    """Create a FastAPI app exposing the CrewAI crew via A2A.

    Args:
        base_url: Public origin used in the agent card's interface URL.
            Defaults to ``config.A2A_SERVER_URL``.
    """
    from mas.config import config

    resolved_base_url = (base_url or config.A2A_SERVER_URL).rstrip("/")
    agent_card = build_agent_card(resolved_base_url)
    app = FastAPI(title="MindSpace A2A Server", version="1.0")

    # ── Legacy contract (kept for backward compatibility) ────────────────
    @app.get("/.well-known/agent.json")
    def agent_card_legacy():
        """Legacy A2A discovery card (superseded by agent-card.json)."""
        return {
            "name": "MindSpace CrewAI Crew",
            "description": "E-commerce intelligence crew: market research, "
                           "product analysis, pricing optimization",
            "framework": "crewai",
            "capabilities": [
                "market_research",
                "product_analysis",
                "pricing_optimization",
            ],
            "url": str(app.url_path_for("run_task")),
            "a2a_endpoint": JSONRPC_PATH,
            "agent_card": "/.well-known/agent-card.json",
        }

    @app.post("/tasks", response_model=A2ATaskResponse)
    def run_task(request: A2ATaskRequest) -> A2ATaskResponse:
        """Run a CrewAI crew task and return results (legacy REST shape)."""
        return A2ATaskResponse(output=_run_crew_for_task_input(request.input))

    # ── Official A2A SDK routes ──────────────────────────────────────────
    request_handler = DefaultRequestHandler(
        agent_executor=MindSpaceA2AExecutor(),
        task_store=InMemoryTaskStore(),
        agent_card=agent_card,
    )
    add_a2a_routes_to_fastapi(
        app,
        agent_card_routes=create_agent_card_routes(agent_card),
        jsonrpc_routes=create_jsonrpc_routes(request_handler, rpc_url=JSONRPC_PATH),
    )

    return app


# Allow `python -m mas.a2a.server`
if __name__ == "__main__":
    import uvicorn
    from mas.config import config

    app = create_a2a_app()
    uvicorn.run(
        app,
        host=config.A2A_SERVER_HOST,
        port=config.A2A_SERVER_PORT,
    )
