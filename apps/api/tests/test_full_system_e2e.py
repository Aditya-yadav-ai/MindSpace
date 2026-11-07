"""Full End-to-End System Integration Tests.

Validates the complete pipeline:
Extension / Client Capture -> Authentication -> Gateway -> Database ->
Manager Agent -> Specialist Coordination -> Grounded Answer -> Audit Trail.
"""

from __future__ import annotations

import time
import unittest
from unittest import mock

import jwt
from fastapi.testclient import TestClient

from app.config import settings
from app.context_store import context_store
from app.database import db
from app.main import app
from app.rate_limiter import rate_limiter
from mas.knowledge.store import KnowledgeStore, chunk_text, normalise_text

E2E_JWT_SECRET = "production-e2e-audit-secret-key-must-be-long-and-secure-32b"
E2E_ISSUER = "https://auth.mindspace.internal"
E2E_AUDIENCE = "authenticated"


def generate_e2e_jwt(sub: str, tenant_id: str) -> str:
    now = int(time.time())
    payload = {
        "sub": sub,
        "tenant_id": tenant_id,
        "iss": E2E_ISSUER,
        "aud": E2E_AUDIENCE,
        "iat": now,
        "exp": now + 3600,
        "email": f"{sub}@example.com",
    }
    return jwt.encode(payload, E2E_JWT_SECRET, algorithm="HS256")


class FullSystemE2ETests(unittest.TestCase):
    def setUp(self) -> None:
        context_store.clear()
        rate_limiter.clear()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        context_store.clear()
        rate_limiter.clear()

    def test_e2e_full_cycle_capture_to_grounded_answer_and_audit(self) -> None:
        """Verify complete lifecycle from context capture to grounded answer and audit logging."""
        with mock.patch.object(settings, "jwt_secret", E2E_JWT_SECRET), \
             mock.patch.object(settings, "jwt_issuer", E2E_ISSUER), \
             mock.patch.object(settings, "jwt_audience", E2E_AUDIENCE), \
             mock.patch.object(settings, "environment", "production"), \
             mock.patch.object(settings, "offline_mode", True):

            user_token = generate_e2e_jwt("researcher-01", "research-lab")
            headers = {"Authorization": f"Bearer {user_token}"}

            # Step 1: Extension captures a research paper page and sends to /v1/context
            capture_payload = {
                "context": {
                    "url": "https://arxiv.org/abs/2401.0001",
                    "title": "Autonomous Multi-Agent Architecture",
                    "text": (
                        "MindSpace integrates Blackboard and P2P communication models. "
                        "The manager agent evaluates user questions and delegates subtasks "
                        "to specialists. In benchmark evaluations, latency reduced by 40%."
                    ),
                    "source": "extension",
                }
            }
            resp_ingest = self.client.post("/v1/context", json=capture_payload, headers=headers)
            self.assertEqual(resp_ingest.status_code, 200)
            self.assertTrue(resp_ingest.json()["stored"])
            self.assertEqual(resp_ingest.json()["client_id"], "researcher-01")

            # Step 2: Web frontend reads the latest context
            resp_latest = self.client.get("/v1/context/latest", headers=headers)
            self.assertEqual(resp_latest.status_code, 200)
            self.assertIsNotNone(resp_latest.json()["context"])
            self.assertIn("Blackboard", resp_latest.json()["context"]["text"])

            # Step 3: User asks a grounded contextual question via Manager Agent
            assist_payload = {
                "action": "ask",
                "question": "What communication models does MindSpace integrate?",
            }
            resp_assist = self.client.post("/v1/assist", json=assist_payload, headers=headers)
            self.assertEqual(resp_assist.status_code, 200)
            data = resp_assist.json()
            self.assertEqual(data["action"], "ask")
            self.assertEqual(data["mode"], "offline")
            self.assertTrue(data["mock"])  # Explicit truth in offline mode
            self.assertIn("result", data)
            self.assertGreater(len(data["sources"]), 0)

            # Step 4: Verify Blackboard / MAS activity was recorded for the user
            act_resp = self.client.get("/v1/mas/activity", headers=headers)
            self.assertEqual(act_resp.status_code, 200)
            act_data = act_resp.json()
            self.assertEqual(act_data["tenant_id"], "research-lab")
            self.assertEqual(act_data["user_id"], "researcher-01")
            self.assertGreater(act_data["stats"]["audit_events_count"], 0)

    def test_e2e_rag_chunking_indexing_and_lexical_retrieval(self) -> None:
        """Verify the local RAG knowledge base chunking, embedding, and retrieval pipeline."""
        raw_document = (
            "Google Workspace security requires OAuth 2.0 with PKCE and AES-256-GCM token encryption. "
            "MindSpace encrypts all refresh tokens before storing them in PostgreSQL. "
            "When disconnected, the Google services adapter fails closed with GoogleNotConnectedError."
        )

        chunks = chunk_text(raw_document, size=100, overlap=20)
        self.assertGreaterEqual(len(chunks), 1)

        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmpdir:
            store_db = Path(tmpdir) / "test_knowledge.db"
            store = KnowledgeStore(db_path=store_db)
            doc = store.save_document(
                title="OAuth Security Guide",
                content=raw_document,
                source_url="https://internal.docs/oauth",
            )
            self.assertTrue(bool(doc.get("id")))

            results = store.search("AES-256-GCM token encryption", limit=3, min_score=0.05)
            self.assertGreater(len(results), 0)
            top = results[0]
            self.assertIn("OAuth", top["content"])
            self.assertEqual(top["document_title"], "OAuth Security Guide")
            self.assertGreater(top["score"], 0.0)

    def test_e2e_handling_unavailable_ai_providers(self) -> None:
        """When the upstream model provider fails, the service returns a retryable 503 envelope."""
        from app.llm import LLMError

        with mock.patch.object(settings, "offline_mode", False), \
             mock.patch.object(settings, "groq_api_key", "gsk_dummy_real_looking_key_1234567890"), \
             mock.patch("app.main.generate", side_effect=LLMError("Groq service rate limited: HTTP 429", retryable=True)):

            token = generate_e2e_jwt("user-99", "tenant-99")
            headers = {"Authorization": f"Bearer {token}"}

            # Ingest context first
            self.client.post(
                "/v1/context",
                json={"context": {"url": "https://example.com", "text": "Some text content"}},
                headers=headers,
            )

            # Request assist -> provider fails
            resp = self.client.post("/v1/assist", json={"action": "summarize"}, headers=headers)
            self.assertEqual(resp.status_code, 503)
            err = resp.json()["error"]
            self.assertEqual(err["code"], "model_unavailable")
            self.assertTrue(err["retryable"])
            self.assertIn("rate limited", err["message"])
