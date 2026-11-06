"""Tests for genuine peer-to-peer agent messaging.

These tests exercise real persistence and delivery: a message written by one
agent must appear in the recipient's mailbox exactly once, with a correlation
id and timestamps, and must never appear in the blackboard (and vice versa).
Failures (unknown peers, malformed envelopes, duplicates, broken storage) are
asserted to raise rather than being silently swallowed.
"""

from __future__ import annotations

import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from mas.blackboard.shared_state import Blackboard
from mas.messaging.p2p import (
    DeliveryFailureError,
    DuplicateMessageError,
    MalformedMessageError,
    P2PMailbox,
    UnknownRecipientError,
    UnknownSenderError,
)
from mas.models.schemas import MAX_P2P_CONTENT_BYTES


class P2PMailboxTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = str(Path(self._tmp.name) / "p2p_mailbox.db")
        self.mailbox = P2PMailbox(self.db_path)
        self.mailbox.register_peer("orchestrator")
        self.mailbox.register_peer("researcher")

    # ── successful delivery ────────────────────────────────────────────────

    def test_delivers_message_to_registered_recipient(self) -> None:
        sent = self.mailbox.send(
            sender="orchestrator",
            recipient="researcher",
            content={"query": "wireless earbuds", "n": 1},
            msg_type="task_request",
            correlation_id="run-42",
        )

        self.assertTrue(sent.msg_id)
        self.assertEqual(sent.correlation_id, "run-42")
        self.assertEqual(self.mailbox.pending_count("researcher"), 1)

        received = self.mailbox.receive("researcher", msg_type="task_request")

        self.assertEqual(len(received), 1)
        message = received[0]
        self.assertEqual(message.msg_id, sent.msg_id)
        self.assertEqual(message.sender, "orchestrator")
        self.assertEqual(message.recipient, "researcher")
        self.assertEqual(message.correlation_id, "run-42")
        self.assertEqual(message.content, {"query": "wireless earbuds", "n": 1})
        self.assertEqual(message.msg_type, "task_request")
        self.assertTrue(message.acknowledged)
        self.assertIsNotNone(message.delivered_at)
        self.assertGreaterEqual(message.delivered_at, message.created_at)

    def test_receive_is_exactly_once(self) -> None:
        self.mailbox.send(
            sender="orchestrator",
            recipient="researcher",
            content={"step": 1},
            correlation_id="run-1",
        )

        first = self.mailbox.receive("researcher")
        second = self.mailbox.receive("researcher")

        self.assertEqual(len(first), 1)
        self.assertEqual(second, [])
        self.assertEqual(self.mailbox.pending_count("researcher"), 0)
        self.assertEqual(self.mailbox.stats()["delivered"], 1)

    def test_peek_does_not_consume_message(self) -> None:
        self.mailbox.send(
            sender="orchestrator",
            recipient="researcher",
            content={"step": 1},
            correlation_id="run-1",
        )

        peeked = self.mailbox.peek("researcher")
        claimed = self.mailbox.receive("researcher")

        self.assertEqual(len(peeked), 1)
        self.assertFalse(peeked[0].acknowledged)
        self.assertEqual(len(claimed), 1)
        self.assertEqual(claimed[0].msg_id, peeked[0].msg_id)

    def test_filters_by_type_and_correlation(self) -> None:
        self.mailbox.send(
            sender="orchestrator",
            recipient="researcher",
            content={"run": "a"},
            msg_type="task_request",
            correlation_id="run-a",
        )
        self.mailbox.send(
            sender="orchestrator",
            recipient="researcher",
            content={"run": "b"},
            msg_type="task_request",
            correlation_id="run-b",
        )
        self.mailbox.send(
            sender="orchestrator",
            recipient="researcher",
            content={"run": "a"},
            msg_type="status_update",
            correlation_id="run-a",
        )

        by_correlation = self.mailbox.receive("researcher", correlation_id="run-b")
        by_type = self.mailbox.receive("researcher", msg_type="status_update")

        self.assertEqual([message.correlation_id for message in by_correlation], ["run-b"])
        self.assertEqual([message.msg_type for message in by_type], ["status_update"])
        # run-a/task_request is still pending; it was never claimed.
        remaining = self.mailbox.receive("researcher")
        self.assertEqual([message.msg_type for message in remaining], ["task_request"])
        self.assertEqual(remaining[0].correlation_id, "run-a")

    def test_messages_are_delivered_to_the_addressed_recipient_only(self) -> None:
        self.mailbox.register_peer("report_agent")
        self.mailbox.send(
            sender="orchestrator",
            recipient="researcher",
            content={"for": "researcher"},
        )

        self.assertEqual(self.mailbox.receive("report_agent"), [])
        self.assertEqual(len(self.mailbox.receive("researcher")), 1)

    def test_concurrent_consumers_claim_each_message_once(self) -> None:
        for index in range(20):
            self.mailbox.send(
                sender="orchestrator",
                recipient="researcher",
                content={"index": index},
                correlation_id="run-concurrent",
            )

        delivered: list[dict] = []
        delivered_lock = threading.Lock()

        def consume() -> None:
            claimed = self.mailbox.receive("researcher")
            with delivered_lock:
                delivered.extend(message.content for message in claimed)

        threads = [threading.Thread(target=consume) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(len(delivered), 20)
        self.assertEqual(sorted(item["index"] for item in delivered), list(range(20)))
        self.assertEqual(self.mailbox.pending_count("researcher"), 0)

    def test_explicit_acknowledge_is_idempotent(self) -> None:
        sent = self.mailbox.send(
            sender="orchestrator",
            recipient="researcher",
            content={"step": 1},
        )

        self.assertTrue(self.mailbox.acknowledge(sent.msg_id, "researcher"))
        self.assertFalse(self.mailbox.acknowledge(sent.msg_id, "researcher"))
        self.assertFalse(self.mailbox.acknowledge(sent.msg_id, "orchestrator"))
        self.assertEqual(self.mailbox.receive("researcher"), [])

    # ── unknown recipients ────────────────────────────────────────────────

    def test_unknown_recipient_is_rejected_and_not_stored(self) -> None:
        with self.assertRaises(UnknownRecipientError):
            self.mailbox.send(
                sender="orchestrator",
                recipient="ghost_agent",
                content={"step": 1},
            )

        self.assertEqual(self.mailbox.stats()["sent"], 0)
        self.assertEqual(self.mailbox.pending_count(), 0)

    def test_unregistered_sender_is_rejected(self) -> None:
        with self.assertRaises(UnknownSenderError):
            self.mailbox.send(
                sender="impostor",
                recipient="researcher",
                content={"step": 1},
            )

        self.assertEqual(self.mailbox.stats()["sent"], 0)

    def test_unregistering_a_peer_stops_delivery(self) -> None:
        self.assertTrue(self.mailbox.unregister_peer("researcher"))
        with self.assertRaises(UnknownRecipientError):
            self.mailbox.send(
                sender="orchestrator",
                recipient="researcher",
                content={"step": 1},
            )

    # ── malformed messages ────────────────────────────────────────────────

    def test_malformed_envelopes_are_rejected(self) -> None:
        cases = (
            {"sender": "Bad Sender", "recipient": "researcher", "content": {}},
            {"sender": "orchestrator", "recipient": "Bad Recipient", "content": {}},
            {"sender": "orchestrator", "recipient": "researcher", "content": None},
            {
                "sender": "orchestrator",
                "recipient": "researcher",
                "content": object(),
            },
            {
                "sender": "orchestrator",
                "recipient": "researcher",
                "content": {"blob": "x" * (MAX_P2P_CONTENT_BYTES + 1)},
            },
            {
                "sender": "orchestrator",
                "recipient": "researcher",
                "content": {},
                "msg_type": "unsupported_type",
            },
        )
        for case in cases:
            with self.subTest(case=str(case)[:60]):
                with self.assertRaises(MalformedMessageError):
                    self.mailbox.send(**case)

        self.assertEqual(self.mailbox.stats()["sent"], 0)
        self.assertEqual(self.mailbox.pending_count(), 0)

    def test_malformed_correlation_id_is_rejected(self) -> None:
        with self.assertRaises(MalformedMessageError):
            self.mailbox.send(
                sender="orchestrator",
                recipient="researcher",
                content={},
                correlation_id="bad id with spaces",
            )

    def test_invalid_peer_registration_is_rejected(self) -> None:
        with self.assertRaises(MalformedMessageError):
            self.mailbox.register_peer("Not Valid")

    def test_invalid_receive_filters_are_rejected(self) -> None:
        with self.assertRaises(MalformedMessageError):
            self.mailbox.receive("researcher", msg_type="nope")
        with self.assertRaises(MalformedMessageError):
            self.mailbox.receive("researcher", limit=0)
        with self.assertRaises(MalformedMessageError):
            self.mailbox.receive("Bad Recipient")

    # ── duplicate delivery ────────────────────────────────────────────────

    def test_duplicate_msg_id_is_rejected(self) -> None:
        first = self.mailbox.send(
            sender="orchestrator",
            recipient="researcher",
            content={"step": 1},
            msg_id="fixed-msg-id",
        )
        with self.assertRaises(DuplicateMessageError):
            self.mailbox.send(
                sender="orchestrator",
                recipient="researcher",
                content={"step": 2},
                msg_id="fixed-msg-id",
            )

        self.assertEqual(self.mailbox.stats()["sent"], 1)
        received = self.mailbox.receive("researcher")
        self.assertEqual(len(received), 1)
        self.assertEqual(received[0].msg_id, first.msg_id)
        self.assertEqual(received[0].content, {"step": 1})

    # ── failure handling ──────────────────────────────────────────────────

    def test_storage_failure_is_reported(self) -> None:
        broken_path = Path(self._tmp.name) / "not_a_database"
        broken_path.mkdir()
        with self.assertRaises(DeliveryFailureError):
            P2PMailbox(str(broken_path))

    def test_runtime_storage_failure_is_reported(self) -> None:
        fail_path = Path(self._tmp.name) / "vanishing" / "mailbox.db"
        mailbox = P2PMailbox(str(fail_path))
        mailbox.register_peer("orchestrator")
        mailbox.register_peer("researcher")

        # Replace the database file with a directory so every future open fails.
        fail_path.unlink()
        fail_path.mkdir()

        with self.assertRaises(DeliveryFailureError):
            mailbox.send(
                sender="orchestrator",
                recipient="researcher",
                content={"step": 1},
            )
        with self.assertRaises(DeliveryFailureError):
            mailbox.receive("researcher")
        with self.assertRaises(DeliveryFailureError):
            mailbox.stats()


class P2PAndBlackboardSeparationTests(unittest.TestCase):
    """P2P and the blackboard must be genuinely different paths."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.blackboard = Blackboard(str(self.root / "blackboard.db"))
        self.blackboard.mailbox.register_peer("orchestrator")
        self.blackboard.mailbox.register_peer("researcher")

    def test_p2p_and_blackboard_use_separate_stores(self) -> None:
        self.assertTrue((self.root / "blackboard.db").exists())
        self.assertTrue((self.root / "p2p_mailbox.db").exists())
        self.assertNotEqual(
            Path(self.blackboard.db_path).resolve(),
            Path(self.blackboard.mailbox.db_path).resolve(),
        )

    def test_blackboard_state_is_not_a_message(self) -> None:
        self.blackboard.write(
            "market_research", {"sources": ["https://example.org"]},
            "researcher", "run-1",
        )

        # The blackboard entry is shared state: readable by anyone, never consumed.
        self.assertEqual(
            self.blackboard.read("market_research", "run-1"),
            {"sources": ["https://example.org"]},
        )
        self.assertEqual(self.blackboard.read("market_research", "run-1")["sources"],
                         ["https://example.org"])
        # ... and it never shows up as a pending P2P message.
        self.assertEqual(self.blackboard.mailbox.receive("orchestrator"), [])

    def test_p2p_message_is_not_blackboard_state(self) -> None:
        self.blackboard.p2p_send(
            sender="orchestrator",
            recipient="researcher",
            content={"step": 1},
            msg_type="task_request",
            run_id="run-1",
            correlation_id="run-1",
        )

        self.assertIsNone(self.blackboard.read("p2p_message", "run-1"))
        self.assertEqual(self.blackboard.read_all("run-1"), {})

        # Blackboard writes do not consume P2P messages.
        self.blackboard.write("step", 1, "orchestrator", "run-1")
        self.assertEqual(self.blackboard.mailbox.pending_count("researcher"), 1)

        received = self.blackboard.p2p_receive("researcher")
        self.assertEqual(len(received), 1)
        self.assertEqual(received[0]["content"], {"step": 1})
        self.assertEqual(received[0]["correlation_id"], "run-1")

    def test_stats_track_both_paths_independently(self) -> None:
        self.blackboard.write("key", "value", "orchestrator", "run-1")
        self.blackboard.p2p_send(
            sender="orchestrator",
            recipient="researcher",
            content={"step": 1},
        )

        stats = self.blackboard.get_stats()
        self.assertEqual(stats["writes"], 1)
        self.assertEqual(stats["p2p_sends"], 1)
        self.assertEqual(stats["p2p_pending"], 1)
        self.assertEqual(stats["p2p_reads"], 0)

        self.blackboard.p2p_receive("researcher")
        stats = self.blackboard.get_stats()
        self.assertEqual(stats["writes"], 1)
        self.assertEqual(stats["p2p_reads"], 1)
        self.assertEqual(stats["p2p_pending"], 0)

    def test_blackboard_audit_records_p2p_sends(self) -> None:
        message_id = self.blackboard.p2p_send(
            sender="orchestrator",
            recipient="researcher",
            content={"step": 1},
            run_id="run-audit",
        )
        self.assertTrue(message_id)

        history = self.blackboard.get_history("run-audit")
        self.assertEqual(history, [])
        with self.blackboard._connection() as conn:
            rows = conn.execute(
                "SELECT event_type, agent_name, details FROM audit_log "
                "WHERE run_id = 'run-audit'"
            ).fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["event_type"], "p2p_send")
        self.assertEqual(rows[0]["agent_name"], "orchestrator")
        self.assertEqual(json.loads(rows[0]["details"])["msg_id"], message_id)


class FakeCallbacks:
    def __init__(self) -> None:
        self.errors: list[tuple[str, str]] = []
        self.agents: list[str] = []

    def on_agent_start(self, agent, _task):
        self.agents.append(agent)

    def on_agent_end(self, _agent, _output, tokens=0):
        pass

    def on_tool_start(self, _agent, _tool, _input):
        return 0.0

    def on_tool_end(self, *_args):
        pass

    def on_blackboard_write(self, *_args):
        pass

    def on_blackboard_read(self, *_args):
        pass

    def on_a2a_call(self, *_args):
        pass

    def on_guardrail_trigger(self, *_args):
        pass

    def on_error(self, agent, error):
        self.errors.append((agent, error))


class FakePerf:
    def __init__(self) -> None:
        self.runs: list[dict] = []

    def record_run(self, record):
        self.runs.append(record)


class FakeAudit:
    def __init__(self) -> None:
        self.records: list[dict] = []

    def record(self, agent_name, action, details, **_kwargs):
        self.records.append({"agent": agent_name, "action": action, "details": details})

    def actions(self) -> list[str]:
        return [record["action"] for record in self.records]


class FakeTracer:
    class _Span:
        def __enter__(self):
            return None

        def __exit__(self, *_exc):
            return False

    def span(self, *_args, **_kwargs):
        return self._Span()


class OrchestratorCrewP2PTests(unittest.TestCase):
    """The orchestrator and the CrewAI crew must actually exchange messages."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        self.blackboard = Blackboard(str(self.root / "blackboard.db"))
        self.audit = FakeAudit()
        self.callbacks = FakeCallbacks()

    def _orchestrator(self):
        from mas.agents.adk_agents.orchestrator import ADKOrchestrator

        orchestrator = ADKOrchestrator.__new__(ADKOrchestrator)
        orchestrator.blackboard = self.blackboard
        orchestrator.cb = self.callbacks
        return orchestrator

    def test_orchestrator_dispatches_a_correlated_task_request(self) -> None:
        orchestrator = self._orchestrator()
        with mock.patch(
            "mas.agents.adk_agents.orchestrator.get_audit_trail",
            return_value=self.audit,
        ):
            message = orchestrator._send_task_request(
                "wireless earbuds", "professional_analyst", "sequential", "run-1"
            )

        self.assertIsNotNone(message)
        self.assertEqual(message.sender, "adk_orchestrator")
        self.assertEqual(message.recipient, "crewai_crew")
        self.assertEqual(message.msg_type, "task_request")
        self.assertEqual(message.correlation_id, "run-1")
        self.assertEqual(message.content["query"], "wireless earbuds")
        self.assertIn("p2p_task_dispatched", self.audit.actions())

        pending = self.blackboard.mailbox.peek("crewai_crew")
        self.assertEqual([item.msg_id for item in pending], [message.msg_id])

    def test_crew_consumes_request_and_returns_task_result(self) -> None:
        from mas.agents.crewai_crew.crew import EcommerceResearchCrew

        orchestrator = self._orchestrator()
        with mock.patch(
            "mas.agents.adk_agents.orchestrator.get_audit_trail",
            return_value=self.audit,
        ):
            request = orchestrator._send_task_request(
                "wireless earbuds", "professional_analyst", "sequential", "run-2"
            )

        crew = EcommerceResearchCrew(
            blackboard=self.blackboard,
            callback_manager=self.callbacks,
            audit_trail=self.audit,
            tracer=FakeTracer(),
        )
        search_result = {
            "query": "wireless earbuds",
            "results": [
                {
                    "title": "Observed source",
                    "url": "https://research.example.org/earbuds",
                    "snippet": "Observed evidence.",
                }
            ],
        }
        with mock.patch.object(
            EcommerceResearchCrew, "_run_crewai", return_value=None
        ), mock.patch(
            "mas.tools.mcp_tools.WebSearchMCPTool.run", return_value=search_result
        ):
            result = crew.run_sequential(
                "wireless earbuds", "professional_analyst", "run-2"
            )

        self.assertTrue(result["p2p_task_received"])
        self.assertTrue(result["p2p_result_sent"])
        # Only market research evidence is produced by this stage, so the crew
        # reports "partial" (product/pricing evidence is absent) — not "ok".
        self.assertEqual(result["status"], "partial")
        self.assertIn("p2p_task_received", self.audit.actions())
        self.assertIn("p2p_result_sent", self.audit.actions())

        # The request was consumed exactly once.
        self.assertEqual(self.blackboard.mailbox.peek("crewai_crew"), [])

        replies = self.blackboard.mailbox.peek("adk_orchestrator")
        self.assertEqual(len(replies), 1)
        reply = replies[0]
        self.assertEqual(reply.sender, "crewai_crew")
        self.assertEqual(reply.recipient, "adk_orchestrator")
        self.assertEqual(reply.msg_type, "task_result")
        self.assertEqual(reply.correlation_id, "run-2")
        self.assertEqual(reply.content["status"], "partial")
        self.assertTrue(reply.content["has_market_research"])
        self.assertEqual(request.correlation_id, reply.correlation_id)

        # The orchestrator collects the reply exactly once.
        with mock.patch(
            "mas.agents.adk_agents.orchestrator.get_audit_trail",
            return_value=self.audit,
        ):
            collected = orchestrator._collect_task_result("run-2")
            collected_again = orchestrator._collect_task_result("run-2")

        self.assertEqual(len(collected), 1)
        self.assertEqual(collected[0].msg_id, reply.msg_id)
        self.assertEqual(collected_again, [])
        self.assertIn("p2p_result_received", self.audit.actions())

    def test_crew_records_direct_invocation_without_inventing_a_request(self) -> None:
        from mas.agents.crewai_crew.crew import EcommerceResearchCrew

        crew = EcommerceResearchCrew(
            blackboard=self.blackboard,
            callback_manager=self.callbacks,
            audit_trail=self.audit,
            tracer=FakeTracer(),
        )
        search_result = {
            "query": "wireless earbuds",
            "results": [
                {
                    "title": "Observed source",
                    "url": "https://research.example.org/earbuds",
                    "snippet": "Observed evidence.",
                }
            ],
        }
        with mock.patch.object(
            EcommerceResearchCrew, "_run_crewai", return_value=None
        ), mock.patch(
            "mas.tools.mcp_tools.WebSearchMCPTool.run", return_value=search_result
        ):
            result = crew.run_sequential(
                "wireless earbuds", "professional_analyst", "run-direct"
            )

        self.assertFalse(result["p2p_task_received"])
        self.assertFalse(result["p2p_result_sent"])
        self.assertIn("p2p_no_task_request", self.audit.actions())
        self.assertEqual(self.blackboard.mailbox.pending_count(), 0)

    def test_orchestrator_run_coordinates_the_crew_over_p2p(self) -> None:
        """End-to-end: dispatch, consume, reply, collect — all over P2P."""
        from mas.agents.adk_agents.orchestrator import ADKOrchestrator
        from mas.agents.crewai_crew.crew import EcommerceResearchCrew

        orchestrator = ADKOrchestrator(
            blackboard=self.blackboard,
            callback_manager=self.callbacks,
            perf_collector=FakePerf(),
        )
        orchestrator.tracer = FakeTracer()

        search_result = {
            "query": "wireless earbuds",
            "results": [
                {
                    "title": "Observed source",
                    "url": "https://research.example.org/earbuds",
                    "snippet": "Observed evidence.",
                }
            ],
        }
        with mock.patch.object(
            EcommerceResearchCrew, "_run_crewai", return_value=None
        ), mock.patch(
            "mas.tools.mcp_tools.WebSearchMCPTool.run", return_value=search_result
        ), mock.patch(
            "mas.agents.adk_agents.runtime.adk_available", return_value=False
        ), mock.patch(
            "mas.agents.adk_agents.orchestrator.get_audit_trail",
            return_value=self.audit,
        ):
            report = orchestrator.run(
                "wireless earbuds", persona="professional_analyst", use_a2a=False
            )

        metadata = report.execution_metadata
        self.assertEqual(metadata.p2p_messages_sent, 1)
        self.assertEqual(metadata.p2p_messages_received, 1)
        self.assertEqual(metadata.dispatch_transport, "p2p")
        self.assertIn(
            "P2P Messages (sent/received) | 1/1", report.markdown_report
        )
        self.assertIn("Task Dispatch Ownership | p2p", report.markdown_report)
        # Both sides of the exchange were consumed: nothing is left pending.
        self.assertEqual(self.blackboard.mailbox.pending_count(), 0)
        self.assertEqual(report.status, "partial")
        self.assertIn("p2p_task_dispatched", self.audit.actions())
        self.assertIn("p2p_task_received", self.audit.actions())
        self.assertIn("p2p_result_sent", self.audit.actions())
        self.assertIn("p2p_result_received", self.audit.actions())

    def test_a2a_dispatch_owns_the_task_and_p2p_stays_idle(self) -> None:
        """use_a2a=True must not also send a P2P task_request (no double dispatch)."""
        from mas.agents.adk_agents.orchestrator import ADKOrchestrator

        orchestrator = ADKOrchestrator(
            blackboard=self.blackboard,
            callback_manager=self.callbacks,
            perf_collector=FakePerf(),
        )
        orchestrator.tracer = FakeTracer()
        remote_result = {"status": "partial", "errors": []}

        with mock.patch(
            "mas.a2a.client.A2AClient.run_task", return_value=remote_result
        ) as a2a_call, mock.patch(
            "mas.agents.adk_agents.runtime.adk_available", return_value=False
        ), mock.patch(
            "mas.agents.adk_agents.orchestrator.get_audit_trail",
            return_value=self.audit,
        ):
            report = orchestrator.run(
                "wireless earbuds", persona="professional_analyst", use_a2a=True
            )

        a2a_call.assert_called_once()
        # The A2A request carries the skill; P2P is not used for the hand-off.
        self.assertEqual(
            a2a_call.call_args.kwargs["task_input"]["skill"], "market_research"
        )
        metadata = report.execution_metadata
        self.assertEqual(metadata.dispatch_transport, "a2a")
        self.assertEqual(metadata.a2a_calls, 1)
        self.assertEqual(metadata.p2p_messages_sent, 0)
        self.assertEqual(metadata.p2p_messages_received, 0)
        self.assertEqual(self.blackboard.mailbox.pending_count(), 0)
        self.assertNotIn("p2p_task_dispatched", self.audit.actions())
        self.assertNotIn("p2p_result_missing", self.audit.actions())
        self.assertIn("a2a_complete", self.audit.actions())

    def test_a2a_failure_falls_back_locally_without_p2p(self) -> None:
        """A failed A2A call runs the crew in-process; the report says so."""
        from mas.agents.adk_agents.orchestrator import ADKOrchestrator
        from mas.agents.crewai_crew.crew import EcommerceResearchCrew

        orchestrator = ADKOrchestrator(
            blackboard=self.blackboard,
            callback_manager=self.callbacks,
            perf_collector=FakePerf(),
        )
        orchestrator.tracer = FakeTracer()

        with mock.patch(
            "mas.a2a.client.A2AClient.run_task",
            side_effect=ConnectionError("A2A server not reachable"),
        ), mock.patch.object(
            EcommerceResearchCrew, "_run_crewai", return_value=None
        ), mock.patch(
            "mas.tools.mcp_tools.WebSearchMCPTool.run",
            return_value={"query": "q", "results": []},
        ), mock.patch(
            "mas.agents.adk_agents.runtime.adk_available", return_value=False
        ), mock.patch(
            "mas.agents.adk_agents.orchestrator.get_audit_trail",
            return_value=self.audit,
        ):
            report = orchestrator.run(
                "wireless earbuds", persona="professional_analyst", use_a2a=True
            )

        metadata = report.execution_metadata
        self.assertEqual(metadata.dispatch_transport, "local")
        self.assertEqual(metadata.a2a_calls, 0)
        self.assertEqual(metadata.p2p_messages_sent, 0)
        self.assertEqual(metadata.p2p_messages_received, 0)
        self.assertEqual(self.blackboard.mailbox.pending_count(), 0)
        self.assertIn("a2a_dispatch_failed", self.audit.actions())
        self.assertNotIn("p2p_task_dispatched", self.audit.actions())

    def test_blackboard_without_mailbox_support_still_runs(self) -> None:
        """Legacy blackboard doubles (no mailbox attribute) keep working."""

        from mas.agents.crewai_crew.crew import EcommerceResearchCrew

        class LegacyBlackboard:
            def __init__(self) -> None:
                self.values = {}

            def write(self, key, value, _agent, run_id):
                self.values[(key, run_id)] = value

            def read(self, key, run_id):
                return self.values.get((key, run_id))

            def get_stats(self):
                return {"reads": 0, "writes": len(self.values)}

        crew = EcommerceResearchCrew(
            blackboard=LegacyBlackboard(),
            callback_manager=self.callbacks,
            audit_trail=self.audit,
            tracer=FakeTracer(),
        )
        search_result = {
            "query": "wireless earbuds",
            "results": [
                {
                    "title": "Observed source",
                    "url": "https://research.example.org/earbuds",
                    "snippet": "Observed evidence.",
                }
            ],
        }
        with mock.patch.object(
            EcommerceResearchCrew, "_run_crewai", return_value=None
        ), mock.patch(
            "mas.tools.mcp_tools.WebSearchMCPTool.run", return_value=search_result
        ):
            result = crew.run_sequential(
                "wireless earbuds", "professional_analyst", "run-legacy"
            )

        self.assertFalse(result["p2p_task_received"])
        self.assertFalse(result["p2p_result_sent"])
        self.assertEqual(result["status"], "partial")


class P2PCrossProcessTests(unittest.TestCase):
    """Messages must survive a process boundary (the A2A server is separate)."""

    def test_delivery_across_processes(self) -> None:
        import subprocess
        import sys

        with tempfile.TemporaryDirectory() as tmp:
            db_path = str(Path(tmp) / "p2p_mailbox.db")
            mailbox = P2PMailbox(db_path)
            mailbox.register_peer("orchestrator")
            mailbox.register_peer("researcher")

            script = (
                "from mas.messaging.p2p import P2PMailbox\n"
                f"mailbox = P2PMailbox({db_path!r})\n"
                "mailbox.register_peer('orchestrator')\n"
                "mailbox.register_peer('researcher')\n"
                "mailbox.send(sender='orchestrator', recipient='researcher',"
                " content={'from': 'other-process'},"
                " msg_type='task_request', correlation_id='run-subprocess')\n"
                "print('delivered')\n"
            )
            api_root = Path(__file__).resolve().parents[1]
            completed = subprocess.run(
                [sys.executable, "-c", script],
                cwd=str(api_root),
                capture_output=True,
                text=True,
                timeout=60,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertIn("delivered", completed.stdout)

            received = mailbox.receive("researcher")
            self.assertEqual(len(received), 1)
            self.assertEqual(received[0].content, {"from": "other-process"})
            self.assertEqual(received[0].correlation_id, "run-subprocess")
            self.assertEqual(received[0].sender, "orchestrator")


class P2PTTLAndDeadLetterTests(unittest.TestCase):
    """Undelivered messages expire and are dead-lettered, never delivered."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = str(Path(self._tmp.name) / "p2p_mailbox.db")
        self.mailbox = P2PMailbox(self.db_path)
        self.mailbox.register_peer("orchestrator")
        self.mailbox.register_peer("researcher")

    def test_message_without_ttl_never_expires(self) -> None:
        self.mailbox.send(
            sender="orchestrator",
            recipient="researcher",
            content={"n": 1},
            msg_type="task_request",
        )
        self.assertEqual(self.mailbox.sweep_expired(), 0)
        self.assertEqual(len(self.mailbox.receive("researcher")), 1)

    def test_expired_message_is_dead_lettered_and_not_delivered(self) -> None:
        message = self.mailbox.send(
            sender="orchestrator",
            recipient="researcher",
            content={"task": "too late"},
            msg_type="task_request",
            ttl_seconds=0.05,
        )
        # Wait past the TTL (the only sleep in the suite; 80 ms is ample).
        import time

        time.sleep(0.12)

        self.assertEqual(self.mailbox.receive("researcher"), [])
        dead = self.mailbox.dead_letters("researcher")
        self.assertEqual(len(dead), 1)
        self.assertEqual(dead[0]["msg_id"], message.msg_id)
        self.assertEqual(dead[0]["reason"], "expired")
        # Dead-lettering is idempotent and removes the row from the mailbox.
        self.assertEqual(self.mailbox.sweep_expired(), 0)
        self.assertEqual(len(self.mailbox.dead_letters()), 1)
        stats = self.mailbox.stats()
        self.assertEqual(stats["dead_letters"], 1)
        self.assertEqual(stats["pending"], 0)

    def test_peek_never_returns_expired_messages(self) -> None:
        self.mailbox.send(
            sender="orchestrator",
            recipient="researcher",
            content={"n": 2},
            msg_type="data",
            ttl_seconds=0.05,
        )
        import time

        time.sleep(0.12)
        self.assertEqual(self.mailbox.peek("researcher"), [])
        self.assertEqual(self.mailbox.pending_count("researcher"), 0)

    def test_invalid_ttl_is_rejected(self) -> None:
        for bad in (0, -1, "5", True):
            with self.subTest(ttl=bad):
                with self.assertRaises(MalformedMessageError):
                    self.mailbox.send(
                        sender="orchestrator",
                        recipient="researcher",
                        content={"n": 3},
                        ttl_seconds=bad,
                    )


if __name__ == "__main__":
    unittest.main()