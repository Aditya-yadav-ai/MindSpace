"""Unit and integration tests for final gap analysis hardening.

Verifies:
1. MaxBodySizeMiddleware rejects oversized payloads (>25MB) with HTTP 413.
2. /v1/diagnostics operational monitoring and health probe.
3. User data purge (GDPR Right to Erasure) cascading across all tables.
4. Database backup and restore integrity.
5. Schema migration version tracking.
"""

from __future__ import annotations

import os
import tempfile
import time
from pathlib import Path
from typing import Generator

import jwt
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.database import DatabaseManager, db
from app.main import app
from app.schemas import PageContext


def make_test_jwt(tenant_id: str, user_id: str) -> str:
    now = int(time.time())
    payload = {
        "sub": user_id,
        "tenant_id": tenant_id,
        "iss": settings.jwt_issuer or "https://auth.mindspace.internal",
        "aud": settings.jwt_audience or "authenticated",
        "iat": now,
        "exp": now + 3600,
        "email": f"{user_id}@example.com",
    }
    secret = settings.jwt_secret or "super-secret-jwt-key-for-testing-at-least-32-bytes-long!"
    return jwt.encode(payload, secret, algorithm="HS256")


@pytest.fixture
def auth_headers() -> dict[str, str]:
    settings.jwt_secret = "super-secret-jwt-key-for-testing-at-least-32-bytes-long!"
    settings.jwt_issuer = "https://auth.mindspace.internal"
    settings.jwt_audience = "authenticated"
    token = make_test_jwt(tenant_id="tenant-audit-1", user_id="user-audit-1")
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture
def test_client() -> Generator[TestClient, None, None]:
    os.environ["MINDSPACE_ENV"] = "test"
    with TestClient(app) as client:
        yield client


class TestGapAnalysisHardening:
    """Test suite covering gap analysis security, diagnostics, and lifecycle fixes."""

    def test_oversized_payload_rejected_with_413(self, test_client: TestClient, auth_headers: dict[str, str]):
        """MaxBodySizeMiddleware must return HTTP 413 when Content-Length exceeds 25MB."""
        headers = dict(auth_headers)
        # Simulate header with 30 MB length
        headers["content-length"] = str(30 * 1024 * 1024)

        response = test_client.post(
            "/v1/context",
            headers=headers,
            json={"context": {"text": "hello"}},
        )
        assert response.status_code == 413
        data = response.json()
        assert data["error"]["code"] == "payload_too_large"
        assert "exceeds maximum allowed size" in data["error"]["message"]

    def test_diagnostics_endpoint_returns_system_health(self, test_client: TestClient, auth_headers: dict[str, str]):
        """GET /v1/diagnostics must return health, uptime, engine, and migrations."""
        response = test_client.get("/v1/diagnostics", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()

        assert data["status"] == "healthy"
        assert "uptime_seconds" in data
        assert data["tenant_id"] == "tenant-audit-1"
        assert data["user_id"] == "user-audit-1"
        assert data["database"]["connected"] is True
        assert "applied_migrations" in data
        assert "001_core_schema" in data["applied_migrations"]

    def test_purge_user_data_cascades_across_tables(self, test_client: TestClient, auth_headers: dict[str, str]):
        """DELETE /v1/user/data must completely purge context, audit logs, and P2P messages."""
        tenant = "tenant-audit-1"
        user = "user-audit-1"

        # 1. Ingest context
        db.save_context(
            tenant,
            user,
            PageContext(
                url="https://example.com/test",
                title="Audit Test",
                domain="example.com",
                text="Some text content to purge.",
            ),
        )

        # 2. Add audit log
        db.log_mas_event(tenant, user, "run-101", "decision", "manager", {"test": True})

        # 3. Add P2P message
        with db.connection() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO p2p_messages_store (tenant_id, user_id, msg_id, correlation_id, sender, recipient, msg_type, content)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (tenant, user, "msg-101", "corr-101", "sender-a", "user-audit-1", "task", '{"action": "run"}'),
            )

        # Verify items exist
        ctx, _ = db.load_context(tenant, user)
        assert ctx is not None
        audits = db.get_mas_activity(tenant, user)
        assert len(audits) >= 1

        # 4. Invoke purge endpoint
        response = test_client.delete("/v1/user/data", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["purged"] is True
        assert data["records_deleted"]["user_contexts"] >= 1
        assert data["records_deleted"]["mas_audit_logs"] >= 1
        assert data["records_deleted"]["p2p_messages_store"] >= 1

        # 5. Verify records no longer exist
        post_ctx, _ = db.load_context(tenant, user)
        assert post_ctx is None
        post_audits = db.get_mas_activity(tenant, user)
        assert len(post_audits) == 0

    def test_database_backup_and_restore_cycle(self):
        """DatabaseManager must create a valid backup file and restore from it."""
        with tempfile.TemporaryDirectory() as tmpdir:
            backup_path = db.backup_database(tmpdir)
            assert os.path.exists(backup_path)
            assert os.path.getsize(backup_path) > 0

            # Test restore
            restored = db.restore_database(backup_path)
            assert restored is True

    def test_schema_migrations_version_tracking(self):
        """DatabaseManager must track applied schema migrations with timestamps."""
        migrations = db.get_applied_migrations()
        assert len(migrations) >= 1
        versions = [m["version"] for m in migrations]
        assert "001_core_schema" in versions
        first = [m for m in migrations if m["version"] == "001_core_schema"][0]
        assert "Initial multi-tenant schema" in first["description"]
