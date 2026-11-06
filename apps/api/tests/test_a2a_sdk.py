"""A2A SDK interoperability tests (real a2a-sdk 1.2.3, in-process ASGI).

Scope: the A2A layer itself. Crew execution is replaced by a module-level
double so the tests stay offline; the transport, agent card discovery,
JSON-RPC dispatch, executor validation and task states are the real SDK.
"""
from __future__ import annotations

import json
import logging
import socket
import threading
import time
import unittest

from unittest import mock

import httpx
import uvicorn

from a2a.client import A2ACardResolver, ClientConfig, ClientFactory
from a2a.helpers.proto_helpers import new_text_message
from a2a.types import (
    Message,
    Role,
    SendMessageConfiguration,
    SendMessageRequest,
    TaskState,
)
from a2a.utils.errors import InvalidParamsError

from mas.a2a.client import (
    A2AClient,
    A2AExecutionError,
    A2AProtocolError,
    A2ATimeout,
    A2AUnavailable,
    A2AUnsupportedSkillError,
)
from mas.a2a.protocol import (
    JSON_MEDIA_TYPE,
    SKILL_MARKET_RESEARCH,
    build_agent_card,
    encode_payload,
)
from mas.a2a.server import create_a2a_app

BASE_URL = "http://test"

# Expected protocol errors are logged by the SDK with tracebacks; keep the
# test output readable. Assertions still verify every failure path.
logging.getLogger("a2a").setLevel(logging.CRITICAL)
logging.getLogger("mas.a2a").setLevel(logging.CRITICAL)

CREW_RESULT = {
    "status": "ok",
    "errors": [],
    "market_research": '{"query": "earbuds", "results": []}',
    "product_analysis": None,
    "pricing_recommendation": None,
    "framework": "crewai",
    "llm_used": True,
    "tokens_used": 123,
    "tasks_completed": 3,
    "agents": ["market_researcher", "product_analyst"],
    "elapsed_ms": 12.5,
}


def make_app():
    return create_a2a_app(base_url=BASE_URL)


class LiveA2AServer:
    """Run the real A2A app under uvicorn on an ephemeral port."""

    def __init__(self) -> None:
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._sock.bind(("127.0.0.1", 0))
        self.port = self._sock.getsockname()[1]
        self.url = f"http://127.0.0.1:{self.port}"
        self._thread: threading.Thread | None = None
        self._server: uvicorn.Server | None = None

    def __enter__(self) -> "LiveA2AServer":
        app = create_a2a_app(base_url=self.url)
        config = uvicorn.Config(
            app, host="127.0.0.1", port=self.port, log_level="warning",
            lifespan="off",
        )
        self._server = uvicorn.Server(config)
        self._thread = threading.Thread(
            target=self._server.run,
            kwargs={"sockets": [self._sock]},
            daemon=True,
        )
        self._thread.start()

        deadline = time.time() + 15
        while not self._server.started and time.time() < deadline:
            if not self._thread.is_alive():
                break
            time.sleep(0.01)
        if not self._server.started:
            raise RuntimeError("uvicorn did not start for the A2A test server")
        return self

    def __exit__(self, *exc_info: object) -> None:
        if self._server is not None:
            self._server.should_exit = True
        if self._thread is not None:
            self._thread.join(timeout=10)
        self._sock.close()


def task_request(payload: dict[str, object], *, message_id: str = "msg-1"):
    return SendMessageRequest(
        message=new_text_message(
            encode_payload(payload),
            media_type=JSON_MEDIA_TYPE,
            role=Role.ROLE_USER,
        ),
        configuration=SendMessageConfiguration(
            accepted_output_modes=[JSON_MEDIA_TYPE]
        ),
    )


class AgentCardTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.app = make_app()
        self.http = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app), base_url=BASE_URL
        )

    async def asyncTearDown(self) -> None:
        await self.http.aclose()

    async def test_agent_card_advertises_jsonrpc_interface(self) -> None:
        response = await self.http.get("/.well-known/agent-card.json")

        self.assertEqual(response.status_code, 200)
        card = response.json()
        self.assertEqual(card["name"], "MindSpace Ecommerce Research Agent")
        self.assertEqual(card["version"], "1.0.0")
        self.assertEqual(len(card["supportedInterfaces"]), 1)
        interface = card["supportedInterfaces"][0]
        self.assertEqual(interface["protocolBinding"], "JSONRPC")
        self.assertEqual(interface["protocolVersion"], "1.0")
        self.assertEqual(interface["url"], f"{BASE_URL}/a2a")
        self.assertFalse(card["capabilities"]["streaming"])
        self.assertEqual([skill["id"] for skill in card["skills"]],
                         [SKILL_MARKET_RESEARCH])

    async def test_agent_card_resolves_with_sdk_resolver(self) -> None:
        card = await A2ACardResolver(self.http, BASE_URL).get_agent_card()

        self.assertEqual(card.name, "MindSpace Ecommerce Research Agent")
        self.assertEqual(
            [skill.id for skill in card.skills], [SKILL_MARKET_RESEARCH]
        )
        self.assertEqual(
            [i.protocol_binding for i in card.supported_interfaces], ["JSONRPC"]
        )

    async def test_legacy_agent_card_is_still_served(self) -> None:
        response = await self.http.get("/.well-known/agent.json")

        self.assertEqual(response.status_code, 200)
        legacy = response.json()
        self.assertEqual(legacy["framework"], "crewai")
        self.assertEqual(legacy["agent_card"], "/.well-known/agent-card.json")


class A2ASdkRoundTripTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.app = make_app()
        self.http = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app), base_url=BASE_URL
        )
        card = await A2ACardResolver(self.http, BASE_URL).get_agent_card()
        self.client = ClientFactory(
            ClientConfig(httpx_client=self.http, streaming=False)
        ).create(card)

    async def asyncTearDown(self) -> None:
        await self.http.aclose()

    async def _send(self, request: SendMessageRequest) -> list:
        return [event async for event in self.client.send_message(request)]

    async def test_task_execution_returns_crew_result(self) -> None:
        with mock.patch(
            "mas.a2a.server._run_crew_for_task_input", return_value=CREW_RESULT
        ) as crew_call:
            events = await self._send(
                task_request(
                    {
                        "skill": SKILL_MARKET_RESEARCH,
                        "query": "wireless earbuds",
                        "persona": "professional_analyst",
                        "architecture": "sequential",
                        "run_id": "run-42",
                    }
                )
            )

        self.assertEqual(len(events), 1)
        task = events[0].task
        self.assertEqual(task.status.state, TaskState.TASK_STATE_COMPLETED)
        self.assertEqual(len(task.artifacts), 1)
        self.assertEqual(task.artifacts[0].name, "crew_result")

        part = task.artifacts[0].parts[0]
        self.assertEqual(part.WhichOneof("content"), "text")
        self.assertEqual(part.media_type, JSON_MEDIA_TYPE)
        self.assertEqual(json.loads(part.text), CREW_RESULT)
        # JSON text keeps integers as integers (protobuf Value would not).
        self.assertIsInstance(json.loads(part.text)["tokens_used"], int)

        crew_call.assert_called_once()
        self.assertEqual(
            crew_call.call_args.args[0],
            {
                "query": "wireless earbuds",
                "persona": "professional_analyst",
                "architecture": "sequential",
                "run_id": "run-42",
                "skill": SKILL_MARKET_RESEARCH,
            },
        )

    async def test_unknown_skill_is_rejected_without_running_crew(self) -> None:
        with mock.patch(
            "mas.a2a.server._run_crew_for_task_input", return_value=CREW_RESULT
        ) as crew_call:
            with self.assertRaises(InvalidParamsError) as raised:
                await self._send(
                    task_request({"skill": "pricing_optimization", "query": "x"})
                )

        self.assertIn("Unsupported skill", str(raised.exception))
        crew_call.assert_not_called()

    async def test_missing_query_is_rejected(self) -> None:
        with mock.patch(
            "mas.a2a.server._run_crew_for_task_input", return_value=CREW_RESULT
        ) as crew_call:
            with self.assertRaises(InvalidParamsError) as raised:
                await self._send(task_request({"skill": SKILL_MARKET_RESEARCH}))

        self.assertIn("query", str(raised.exception))
        crew_call.assert_not_called()

    async def test_unsupported_architecture_is_rejected(self) -> None:
        with mock.patch(
            "mas.a2a.server._run_crew_for_task_input", return_value=CREW_RESULT
        ) as crew_call:
            with self.assertRaises(InvalidParamsError):
                await self._send(
                    task_request({"query": "x", "architecture": "swarm"})
                )

        crew_call.assert_not_called()

    async def test_malformed_json_payload_is_rejected(self) -> None:
        request = SendMessageRequest(
            message=new_text_message("{not json", role=Role.ROLE_USER),
            configuration=SendMessageConfiguration(
                accepted_output_modes=[JSON_MEDIA_TYPE]
            ),
        )
        with mock.patch(
            "mas.a2a.server._run_crew_for_task_input", return_value=CREW_RESULT
        ) as crew_call:
            with self.assertRaises(InvalidParamsError) as raised:
                await self._send(request)

        self.assertIn("JSON", str(raised.exception))
        crew_call.assert_not_called()

    async def test_message_without_parts_is_rejected(self) -> None:
        request = SendMessageRequest(
            message=Message(message_id="empty", role=Role.ROLE_USER),
            configuration=SendMessageConfiguration(
                accepted_output_modes=[JSON_MEDIA_TYPE]
            ),
        )
        with self.assertRaises(InvalidParamsError):
            await self._send(request)

    async def test_crew_failure_marks_the_task_failed(self) -> None:
        with mock.patch(
            "mas.a2a.server._run_crew_for_task_input",
            side_effect=RuntimeError("model quota exhausted"),
        ):
            events = await self._send(task_request({"query": "wireless earbuds"}))

        self.assertEqual(len(events), 1)
        task = events[0].task
        self.assertEqual(task.status.state, TaskState.TASK_STATE_FAILED)
        self.assertEqual(task.artifacts, [])
        message = task.status.message
        self.assertIn("model quota exhausted", message.parts[0].text)

    async def test_legacy_rest_task_endpoint_still_works(self) -> None:
        with mock.patch(
            "mas.a2a.server._run_crew_for_task_input", return_value=CREW_RESULT
        ):
            response = await self.http.post(
                "/tasks",
                json={
                    "input": {
                        "query": "wireless earbuds",
                        "run_id": "legacy-run",
                    }
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["output"], CREW_RESULT)

    async def test_agent_card_builder_matches_served_card(self) -> None:
        served = (await self.http.get("/.well-known/agent-card.json")).json()
        card = build_agent_card(BASE_URL)

        self.assertEqual(served["name"], card.name)
        self.assertEqual(
            served["supportedInterfaces"][0]["url"],
            card.supported_interfaces[0].url,
        )


class A2AClientTests(unittest.TestCase):
    """The synchronous public client API, including failure mapping."""

    def setUp(self) -> None:
        self.app = make_app()

    def _client(self, transport=None) -> A2AClient:
        return A2AClient(
            BASE_URL, transport=transport or httpx.ASGITransport(app=self.app)
        )

    def test_run_task_returns_crew_result_dict(self) -> None:
        with mock.patch(
            "mas.a2a.server._run_crew_for_task_input", return_value=CREW_RESULT
        ) as crew_call:
            result = self._client().run_task(
                {
                    "skill": SKILL_MARKET_RESEARCH,
                    "query": "wireless earbuds",
                    "run_id": "run-client",
                },
                timeout=20,
            )

        self.assertEqual(result, CREW_RESULT)
        self.assertIsInstance(result["tokens_used"], int)
        crew_call.assert_called_once()

    def test_run_task_rejects_unsupported_skill(self) -> None:
        with mock.patch(
            "mas.a2a.server._run_crew_for_task_input", return_value=CREW_RESULT
        ) as crew_call:
            with self.assertRaises(A2AUnsupportedSkillError) as raised:
                self._client().run_task(
                    {"skill": "product_analysis", "query": "x"}, timeout=20
                )

        self.assertIn("Unsupported skill", str(raised.exception))
        crew_call.assert_not_called()

    def test_run_task_reports_failed_task(self) -> None:
        with mock.patch(
            "mas.a2a.server._run_crew_for_task_input",
            side_effect=RuntimeError("crew crashed"),
        ):
            with self.assertRaises(A2AExecutionError) as raised:
                self._client().run_task({"query": "x"}, timeout=20)

        self.assertEqual(raised.exception.state, "TASK_STATE_FAILED")
        self.assertIn("crew crashed", str(raised.exception))

    def test_run_task_times_out(self) -> None:
        """A real HTTP server is required: ASGITransport ignores httpx timeouts.

        This exercises the production deadline path end to end: the client
        gives up while the crew is still running and reports A2ATimeout.
        """
        with LiveA2AServer() as server:
            def slow_crew(_payload):
                time.sleep(1.5)
                return CREW_RESULT

            with mock.patch(
                "mas.a2a.server._run_crew_for_task_input", side_effect=slow_crew
            ):
                with self.assertRaises(A2ATimeout):
                    A2AClient(server.url).run_task({"query": "x"}, timeout=0.2)

    def test_run_task_reports_unreachable_agent(self) -> None:
        def refuse(_request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("connection refused", request=_request)

        client = A2AClient(
            BASE_URL, transport=httpx.MockTransport(refuse)
        )
        with self.assertRaises(A2AUnavailable):
            client.run_task({"query": "x"}, timeout=5)

    def test_run_task_requires_positive_timeout(self) -> None:
        with self.assertRaises(ValueError):
            self._client().run_task({"query": "x"}, timeout=0)

    def test_run_task_over_real_http(self) -> None:
        """Card discovery, JSON-RPC dispatch and artifact parsing over TCP."""
        with LiveA2AServer() as server:
            with mock.patch(
                "mas.a2a.server._run_crew_for_task_input", return_value=CREW_RESULT
            ) as crew_call:
                result = A2AClient(server.url).run_task(
                    {"query": "wireless earbuds", "run_id": "live-run"},
                    timeout=30,
                )

        self.assertEqual(result, CREW_RESULT)
        self.assertIsInstance(result["tokens_used"], int)
        self.assertEqual(crew_call.call_args.args[0]["run_id"], "live-run")

    def test_run_task_rejects_card_without_jsonrpc(self) -> None:
        def only_rest(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "name": "Rest-only agent",
                    "description": "no rpc",
                    "version": "1.0.0",
                    "supportedInterfaces": [
                        {
                            "url": BASE_URL,
                            "protocolBinding": "HTTP+JSON",
                            "protocolVersion": "1.0",
                        }
                    ],
                    "capabilities": {"streaming": False},
                    "defaultInputModes": ["application/json"],
                    "defaultOutputModes": ["application/json"],
                    "skills": [],
                },
            )

        client = A2AClient(BASE_URL, transport=httpx.MockTransport(only_rest))
        with self.assertRaises(A2AProtocolError) as raised:
            client.run_task({"query": "x"}, timeout=5)

        self.assertIn("JSONRPC", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
