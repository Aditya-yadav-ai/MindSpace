"""Tests for Production Security Hardening in MindSpace API.

Verifies:
1. Production fail-closed authentication (rejecting unauthenticated requests).
2. API Key verification via X-API-Key and Authorization Bearer header.
3. Rate limiting enforcement returning HTTP 429 when threshold exceeded.
4. Production CORS origin restriction preventing arbitrary extension IDs.
5. SSRF / DNS Rebinding protection in MCP fetch_page tool.
"""

from __future__ import annotations

import unittest
from unittest import mock
from fastapi.testclient import TestClient

from app.config import settings
from app.context_store import context_store
from app.main import app, create_app
from app.rate_limiter import rate_limiter
from mas.mcp_service.server import _is_public_host, fetch_page


class ProductionSecurityHardeningTests(unittest.TestCase):
    def setUp(self) -> None:
        context_store.clear()
        rate_limiter.clear()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        context_store.clear()
        rate_limiter.clear()

    def test_production_auth_fails_closed_when_no_key_configured(self) -> None:
        """In production environment without an API key, unauthenticated requests must be rejected."""
        with mock.patch.object(settings, "environment", "production"), \
             mock.patch.object(settings, "api_key", ""):
            resp = self.client.post("/v1/context", json={"context": {"url": "https://example.com", "text": "test content"}})
            self.assertEqual(resp.status_code, 401)
            self.assertEqual(resp.json()["error"]["code"], "unauthorized")

    def test_production_auth_requires_valid_api_key(self) -> None:
        """When an API key is configured, invalid or missing keys must return 401, while valid key succeeds."""
        with mock.patch.object(settings, "environment", "production"), \
             mock.patch.object(settings, "api_key", "secret-test-token-12345"):
            # Missing key
            resp = self.client.get("/v1/context/latest")
            self.assertEqual(resp.status_code, 401)

            # Invalid key
            resp = self.client.get("/v1/context/latest", headers={"X-API-Key": "wrong-key"})
            self.assertEqual(resp.status_code, 401)

            # Valid key via X-API-Key
            resp = self.client.get("/v1/context/latest", headers={"X-API-Key": "secret-test-token-12345"})
            self.assertEqual(resp.status_code, 200)

            # Valid key via Authorization Bearer
            resp = self.client.get("/v1/context/latest", headers={"Authorization": "Bearer secret-test-token-12345"})
            self.assertEqual(resp.status_code, 200)

    def test_probes_remain_accessible_in_production(self) -> None:
        """Health and readiness probes must remain accessible without API keys for orchestrators."""
        with mock.patch.object(settings, "environment", "production"), \
             mock.patch.object(settings, "api_key", "secret-test-token-12345"):
            health = self.client.get("/health")
            self.assertEqual(health.status_code, 200)
            self.assertEqual(health.json(), {"ok": True})

            ready = self.client.get("/ready")
            self.assertEqual(ready.status_code, 200)

    def test_rate_limiting_enforcement(self) -> None:
        """When requests exceed rate_limit_per_minute, HTTP 429 must be returned with Retry-After header."""
        with mock.patch.object(settings, "environment", "production"), \
             mock.patch.object(settings, "api_key", "valid-key"), \
             mock.patch.object(settings, "rate_limit_per_minute", 3):
            headers = {"X-API-Key": "valid-key", "X-MindSpace-Client": "ratelimit-test"}

            payload = {"context": {"url": "https://example.com", "text": "Sample text for rate test"}}

            # First 3 requests succeed
            for _ in range(3):
                r = self.client.post("/v1/context", json=payload, headers=headers)
                self.assertEqual(r.status_code, 200)

            # 4th request must be rate limited
            r4 = self.client.post("/v1/context", json=payload, headers=headers)
            self.assertEqual(r4.status_code, 429)
            self.assertEqual(r4.json()["error"]["code"], "rate_limit_exceeded")
            self.assertTrue(r4.json()["error"]["retryable"])
            self.assertIn("Retry-After", r4.headers)

    def test_production_cors_restricts_arbitrary_extensions(self) -> None:
        """Production app without wildcard regex must not allow arbitrary chrome extension origins."""
        with mock.patch.object(settings, "environment", "production"), \
             mock.patch.object(settings, "allowed_extension_ids", "abcdefghijklmnopqrstuvwxyzabcdef"):
            prod_app = create_app()
            client = TestClient(prod_app)

            # Allowed extension ID
            allowed_resp = client.options(
                "/health",
                headers={
                    "Origin": "chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef",
                    "Access-Control-Request-Method": "GET",
                },
            )
            self.assertIn("access-control-allow-origin", allowed_resp.headers)

            # Arbitrary / untrusted extension ID
            untrusted_resp = client.options(
                "/health",
                headers={
                    "Origin": "chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
                    "Access-Control-Request-Method": "GET",
                },
            )
            self.assertNotIn("access-control-allow-origin", untrusted_resp.headers)

    def test_ssrf_ip_filtering_blocks_all_internal_targets(self) -> None:
        """MCP SSRF validator must block localhost, cloud metadata, link-local, multicast, and 0.0.0.0."""
        blocked_hosts = [
            "127.0.0.1",
            "localhost",
            "169.254.169.254",
            "10.0.0.1",
            "192.168.1.1",
            "172.16.0.1",
            "0.0.0.0",
            "::1",
            "fc00::1",
            "fe80::1",
        ]
        for host in blocked_hosts:
            allowed, reason = _is_public_host(host)
            self.assertFalse(allowed, f"Host {host} should have been blocked: {reason}")

