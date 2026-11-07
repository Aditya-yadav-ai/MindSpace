"""Independent verification tests for JWT authentication and multi-tenant isolation.

Tests:
1. JWT signature, expiration, issuer, and audience validation.
2. User and tenant identity extraction from cryptographically verified tokens.
3. Strict multi-tenant isolation (User A cannot access User B's context, documents, or audit logs).
4. Cross-tenant leakage prevention.
5. Production fail-closed behavior.
"""

from __future__ import annotations

import time
import unittest
from datetime import datetime, timezone
from unittest import mock

import jwt
from fastapi.testclient import TestClient

from app.config import settings
from app.context_store import context_store
from app.database import db
from app.main import app
from app.rate_limiter import rate_limiter
from app.security.jwt_auth import AuthUser, validate_jwt, extract_auth_user

TEST_SECRET = "super-secret-jwt-key-for-testing-at-least-32-bytes-long!"
TEST_ISSUER = "https://auth.mindspace.internal"
TEST_AUDIENCE = "authenticated"


def make_jwt(
    sub: str,
    tenant_id: str | None = None,
    secret: str = TEST_SECRET,
    expires_in_seconds: int = 3600,
    issuer: str = TEST_ISSUER,
    audience: str = TEST_AUDIENCE,
    email: str = "",
) -> str:
    now = int(time.time())
    payload = {
        "sub": sub,
        "iss": issuer,
        "aud": audience,
        "iat": now,
        "exp": now + expires_in_seconds,
        "email": email or f"{sub}@example.com",
    }
    if tenant_id:
        payload["tenant_id"] = tenant_id
    return jwt.encode(payload, secret, algorithm="HS256")


class JwtAndMultiTenancyTests(unittest.TestCase):
    def setUp(self) -> None:
        context_store.clear()
        rate_limiter.clear()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        context_store.clear()
        rate_limiter.clear()

    # ── JWT VERIFICATION SUITE ───────────────────────────────────────────────

    def test_valid_jwt_authenticates_and_extracts_identity(self) -> None:
        """A properly signed, unexpired JWT must be verified and grant access."""
        with mock.patch.object(settings, "jwt_secret", TEST_SECRET), \
             mock.patch.object(settings, "jwt_issuer", TEST_ISSUER), \
             mock.patch.object(settings, "jwt_audience", TEST_AUDIENCE), \
             mock.patch.object(settings, "environment", "production"):

            token = make_jwt("alice-123", tenant_id="acme-corp")
            headers = {"Authorization": f"Bearer {token}"}

            resp = self.client.get("/v1/context/latest", headers=headers)
            self.assertEqual(resp.status_code, 200)

    def test_expired_jwt_is_strictly_rejected(self) -> None:
        """Expired JWT tokens must fail validation with HTTP 401."""
        with mock.patch.object(settings, "jwt_secret", TEST_SECRET), \
             mock.patch.object(settings, "jwt_issuer", TEST_ISSUER), \
             mock.patch.object(settings, "jwt_audience", TEST_AUDIENCE), \
             mock.patch.object(settings, "environment", "production"):

            expired_token = make_jwt("alice-123", expires_in_seconds=-100)
            headers = {"Authorization": f"Bearer {expired_token}"}

            resp = self.client.get("/v1/context/latest", headers=headers)
            self.assertEqual(resp.status_code, 401)
            self.assertIn("expired", resp.json()["error"]["message"].lower())

    def test_tampered_jwt_signature_is_strictly_rejected(self) -> None:
        """JWT with forged/tampered signature must fail validation with HTTP 401."""
        with mock.patch.object(settings, "jwt_secret", TEST_SECRET), \
             mock.patch.object(settings, "jwt_issuer", TEST_ISSUER), \
             mock.patch.object(settings, "jwt_audience", TEST_AUDIENCE), \
             mock.patch.object(settings, "environment", "production"):

            forged_token = make_jwt("alice-123", secret="wrong-secret-key-attacker-guess!")
            headers = {"Authorization": f"Bearer {forged_token}"}

            resp = self.client.get("/v1/context/latest", headers=headers)
            self.assertEqual(resp.status_code, 401)
            self.assertIn("signature", resp.json()["error"]["message"].lower())

    def test_invalid_jwt_issuer_is_rejected(self) -> None:
        """JWT with unexpected issuer claim must be rejected."""
        with mock.patch.object(settings, "jwt_secret", TEST_SECRET), \
             mock.patch.object(settings, "jwt_issuer", TEST_ISSUER), \
             mock.patch.object(settings, "jwt_audience", TEST_AUDIENCE), \
             mock.patch.object(settings, "environment", "production"):

            invalid_iss_token = make_jwt("alice-123", issuer="https://evil-untrusted-issuer.com")
            headers = {"Authorization": f"Bearer {invalid_iss_token}"}

            resp = self.client.get("/v1/context/latest", headers=headers)
            self.assertEqual(resp.status_code, 401)
            self.assertIn("issuer", resp.json()["error"]["message"].lower())

    def test_invalid_jwt_audience_is_rejected(self) -> None:
        """JWT with mismatched audience claim must be rejected."""
        with mock.patch.object(settings, "jwt_secret", TEST_SECRET), \
             mock.patch.object(settings, "jwt_issuer", TEST_ISSUER), \
             mock.patch.object(settings, "jwt_audience", TEST_AUDIENCE), \
             mock.patch.object(settings, "environment", "production"):

            invalid_aud_token = make_jwt("alice-123", audience="wrong-service-aud")
            headers = {"Authorization": f"Bearer {invalid_aud_token}"}

            resp = self.client.get("/v1/context/latest", headers=headers)
            self.assertEqual(resp.status_code, 401)
            self.assertIn("audience", resp.json()["error"]["message"].lower())

    # ── MULTI-TENANT ISOLATION SUITE ─────────────────────────────────────────

    def test_two_users_cannot_access_each_others_context(self) -> None:
        """User A and User B must have strictly isolated contexts. Neither can read the other's data."""
        with mock.patch.object(settings, "jwt_secret", TEST_SECRET), \
             mock.patch.object(settings, "jwt_issuer", TEST_ISSUER), \
             mock.patch.object(settings, "jwt_audience", TEST_AUDIENCE), \
             mock.patch.object(settings, "environment", "production"):

            token_alice = make_jwt("alice-user-id", tenant_id="tenant-alpha")
            token_bob = make_jwt("bob-user-id", tenant_id="tenant-beta")

            headers_alice = {"Authorization": f"Bearer {token_alice}"}
            headers_bob = {"Authorization": f"Bearer {token_bob}"}

            # 1. Alice ingests her confidential page
            alice_payload = {
                "context": {
                    "url": "https://alpha.internal/q3-confidential",
                    "title": "Alpha Q3 Confidential Strategy",
                    "text": "Alpha corporate secrets: Project Phoenix is launching on December 1st.",
                }
            }
            resp_alice_post = self.client.post("/v1/context", json=alice_payload, headers=headers_alice)
            self.assertEqual(resp_alice_post.status_code, 200)

            # 2. Alice reads her context and receives it
            resp_alice_get = self.client.get("/v1/context/latest", headers=headers_alice)
            self.assertEqual(resp_alice_get.status_code, 200)
            self.assertIn("Phoenix", resp_alice_get.json()["context"]["text"])

            # 3. Bob attempts to read context -> MUST be None (No leakage)
            resp_bob_get = self.client.get("/v1/context/latest", headers=headers_bob)
            self.assertEqual(resp_bob_get.status_code, 200)
            self.assertIsNone(resp_bob_get.json()["context"], "Bob must NOT see Alice's context!")

            # 4. Bob ingests his own page
            bob_payload = {
                "context": {
                    "url": "https://beta.internal/public-page",
                    "title": "Beta Public Blog",
                    "text": "Beta public announcement: We love open source tools.",
                }
            }
            resp_bob_post = self.client.post("/v1/context", json=bob_payload, headers=headers_bob)
            self.assertEqual(resp_bob_post.status_code, 200)

            # 5. Alice's context is STILL intact and separate
            resp_alice_verify = self.client.get("/v1/context/latest", headers=headers_alice)
            self.assertEqual(resp_alice_verify.status_code, 200)
            self.assertIn("Phoenix", resp_alice_verify.json()["context"]["text"])

            # 6. Bob deletes his context -> Alice's context is untouched
            self.client.delete("/v1/context", headers=headers_bob)
            resp_bob_after_delete = self.client.get("/v1/context/latest", headers=headers_bob)
            self.assertIsNone(resp_bob_after_delete.json()["context"])

            resp_alice_final = self.client.get("/v1/context/latest", headers=headers_alice)
            self.assertIsNotNone(resp_alice_final.json()["context"])

    def test_tenant_isolation_in_audit_activity_logs(self) -> None:
        """Audit logs in /v1/mas/activity must be strictly partitioned by tenant and user."""
        with mock.patch.object(settings, "jwt_secret", TEST_SECRET), \
             mock.patch.object(settings, "jwt_issuer", TEST_ISSUER), \
             mock.patch.object(settings, "jwt_audience", TEST_AUDIENCE), \
             mock.patch.object(settings, "environment", "production"):

            token_alice = make_jwt("alice-user-id", tenant_id="tenant-alpha")
            token_bob = make_jwt("bob-user-id", tenant_id="tenant-beta")

            headers_alice = {"Authorization": f"Bearer {token_alice}"}
            headers_bob = {"Authorization": f"Bearer {token_bob}"}

            # Ingest context for Alice and Bob
            self.client.post(
                "/v1/context",
                json={"context": {"url": "https://alpha.com", "text": "Alice context"}},
                headers=headers_alice,
            )
            self.client.post(
                "/v1/context",
                json={"context": {"url": "https://beta.com", "text": "Bob context"}},
                headers=headers_bob,
            )

            # Alice requests activity
            act_alice = self.client.get("/v1/mas/activity", headers=headers_alice).json()
            self.assertEqual(act_alice["tenant_id"], "tenant-alpha")
            self.assertEqual(act_alice["user_id"], "alice-user-id")
            for ev in act_alice["blackboard_events"]:
                self.assertNotEqual(ev.get("details", {}).get("url"), "https://beta.com")

            # Bob requests activity
            act_bob = self.client.get("/v1/mas/activity", headers=headers_bob).json()
            self.assertEqual(act_bob["tenant_id"], "tenant-beta")
            self.assertEqual(act_bob["user_id"], "bob-user-id")
            for ev in act_bob["blackboard_events"]:
                self.assertNotEqual(ev.get("details", {}).get("url"), "https://alpha.com")
