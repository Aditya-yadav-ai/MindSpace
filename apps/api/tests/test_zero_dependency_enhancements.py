"""Tests for zero-external-dependency enhancements and local demo workflow.

Verifies:
1. 8-step multi-agent demonstration lifecycle executes cleanly and deterministically.
2. Provider status abstraction and fallback readiness.
3. Database sample demo data seeding and reset mechanics with tenant isolation.
4. /v1/research and /v1/mas/demo API endpoints.
"""

from __future__ import annotations

import os
import time
from typing import Generator

import jwt
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.database import db
from app.llm import get_provider_status
from app.main import app
from mas.demo_workflow import run_multi_agent_demo


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
    token = make_test_jwt(tenant_id="demo-tenant", user_id="demo-user")
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture
def test_client() -> Generator[TestClient, None, None]:
    os.environ["MINDSPACE_ENV"] = "test"
    with TestClient(app) as client:
        yield client


class TestZeroDependencyEnhancements:
    """Verification suite for offline multi-agent intelligence and demo capabilities."""

    def test_provider_status_reports_offline_fallback_readiness(self):
        """Provider status must report configured model and fallback engine readiness."""
        status = get_provider_status()
        assert status["provider"] == "groq"
        assert "configured_model" in status
        assert status["fallback_engine"] == "offline-heuristic-rag"
        assert status["fallback_ready"] is True

    def test_multi_agent_demo_executes_all_eight_steps(self):
        """run_multi_agent_demo must execute all 8 stages and return grounded citations."""
        query = "Explain Transformer multi-head self-attention mechanisms"
        result = run_multi_agent_demo(query, tenant_id="demo-tenant", user_id="demo-user")

        assert result["status"] == "success"
        assert result["query"] == query
        assert result["steps_count"] == 8
        assert len(result["extracted_facts"]) >= 1
        assert len(result["sources"]) >= 1
        assert result["total_latency_ms"] > 0

        # Verify step progression
        stages = [step["stage"] for step in result["execution_trace"]]
        expected_stages = [
            "request_received",
            "task_decomposition",
            "agent_selection",
            "p2p_message_dispatched",
            "mcp_tool_execution",
            "rag_retrieval",
            "response_synthesized",
            "workflow_completed",
        ]
        assert stages == expected_stages

        # Verify offline labelling
        assert result["mock"] is True or result["mode"] == "live"
        if result["mock"]:
            assert "[SIMULATED]" in result["summary"]

    def test_demo_data_seeding_and_reset_preserves_tenant_isolation(self):
        """Seeding and resetting demo data must operate strictly on demo-tenant."""
        # 1. Seed demo data
        seed_res = db.seed_demo_data("demo-tenant", "demo-user")
        assert seed_res["seeded"] is True
        assert seed_res["tenant_id"] == "demo-tenant"

        # Verify demo context exists
        ctx, _ = db.load_context("demo-tenant", "demo-user")
        assert ctx is not None
        assert "Attention Is All You Need" in ctx.title

        # Verify other tenant has zero bleeding
        other_ctx, _ = db.load_context("production-tenant", "real-user")
        assert other_ctx is None

        # 2. Reset demo data
        reset_res = db.reset_demo_data("demo-tenant", "demo-user")
        assert reset_res["seeded"] is True

        # Verify reseeded context is present
        reseeded_ctx, _ = db.load_context("demo-tenant", "demo-user")
        assert reseeded_ctx is not None

    def test_research_api_endpoint(self, test_client: TestClient, auth_headers: dict[str, str]):
        """POST /v1/research must trigger agent pipeline and return typed ResearchResponse."""
        payload = {
            "query": "Evaluate multi-agent system failure recovery and P2P messaging",
            "persona": "technical_expert",
            "architecture": "hierarchical",
        }
        response = test_client.post("/v1/research", headers=auth_headers, json=payload)
        assert response.status_code == 200
        data = response.json()

        assert data["query"] == payload["query"]
        assert data["persona"] == "technical_expert"
        assert data["architecture"] == "hierarchical"
        assert data["status"] in ("success", "partial")
        assert len(data["summary"]) > 20
        assert len(data["sources"]) >= 1

    def test_mas_demo_endpoint_returns_full_trace(self, test_client: TestClient, auth_headers: dict[str, str]):
        """POST /v1/mas/demo must return the complete 8-step execution trace."""
        response = test_client.post(
            "/v1/mas/demo",
            headers=auth_headers,
            json={"query": "Demonstrate complete agent cooperation trace"},
        )
        assert response.status_code == 200
        data = response.json()

        assert data["status"] == "success"
        assert data["steps_count"] == 8
        assert "execution_trace" in data
        assert len(data["execution_trace"]) == 8
