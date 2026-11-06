"""Regression tests for the liveness and readiness endpoints."""

import unittest

from fastapi.testclient import TestClient

from app import config as app_config
from app.main import app


class HealthEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_health_shape_is_unchanged(self) -> None:
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})

    def test_ready_reports_a_consistent_mode_label(self) -> None:
        response = self.client.get("/ready")
        self.assertEqual(response.status_code, 200)
        body = response.json()

        self.assertEqual(body["status"], "ready")
        self.assertIn(body["mode"], {"live", "offline"})
        self.assertIsInstance(body["mock"], bool)
        # mock must always agree with the mode; never "live" while mocking.
        self.assertEqual(body["mock"], body["mode"] == "offline")
        self.assertEqual(body["checks"], {"config": "ok"})
        self.assertIsInstance(body["port"], int)
        self.assertTrue(0 < body["port"] < 65536)

    def test_ready_reports_offline_when_no_key_is_configured(self) -> None:
        original = app_config.settings.groq_api_key
        app_config.settings.groq_api_key = ""
        try:
            body = self.client.get("/ready").json()
        finally:
            app_config.settings.groq_api_key = original

        self.assertEqual(body["mode"], "offline")
        self.assertTrue(body["mock"])
        self.assertFalse(body["llm_configured"])
        self.assertIn("GROQ_API_KEY", body["reason"])

    def test_ready_does_not_leak_the_api_key(self) -> None:
        secret = "gsk_live_secret_value_that_must_not_escape"
        original = app_config.settings.groq_api_key
        app_config.settings.groq_api_key = secret
        try:
            response = self.client.get("/ready")
        finally:
            app_config.settings.groq_api_key = original

        self.assertEqual(response.json()["mode"], "live")
        self.assertNotIn(secret, response.text)


if __name__ == "__main__":
    unittest.main()
