"""Tests for the Vision Agent and `/v1/screenshot` multimodal API endpoint."""
from __future__ import annotations

import unittest
from fastapi.testclient import TestClient

from app.main import app
from mas.agents.vision_agent import VisionAgent, vision_agent


class VisionAgentTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)
        self.agent = VisionAgent()
        # 1x1 Red PNG
        self.valid_png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

    def test_vision_agent_genuine_image_inspection(self) -> None:
        is_valid, meta, err = self.agent.inspect_image(self.valid_png)
        self.assertTrue(is_valid)
        self.assertIsNone(err)
        self.assertEqual(meta["width"], 1)
        self.assertEqual(meta["height"], 1)
        self.assertEqual(meta["format"], "PNG")
        self.assertIn("average_luminance", meta)
        self.assertIn("detected_theme", meta)

    def test_vision_agent_corrupted_image_handling(self) -> None:
        # Malformed base64
        is_valid, meta, err = self.agent.inspect_image("not-a-valid-base64-image-string!!!")
        self.assertFalse(is_valid)
        self.assertIn("Invalid base64", str(err))

        # Valid base64 but not an image
        is_valid2, meta2, err2 = self.agent.inspect_image("SGVsbG8gV29ybGQ=")  # "Hello World"
        self.assertFalse(is_valid2)
        self.assertIn("parsing failed", str(err2))

    def test_vision_agent_entity_extraction(self) -> None:
        text = (
            "Quarterly Review on 2026-11-15. "
            "Please review the Q4 financial report and approve budget of $45,000. "
            "Reference document available at https://docs.google.com/document/d/xyz. "
            "Action item: Send draft to board members tomorrow."
        )
        understanding = self.agent.analyze(
            screenshot_base64=self.valid_png,
            url="https://docs.google.com/document/d/xyz",
            title="Q4 Financial Review",
            text_context=text,
        )

        self.assertIsNotNone(understanding.screenshot_id)
        self.assertEqual(understanding.layout_type, "workspace_document")
        self.assertTrue(understanding.image_valid)
        self.assertEqual(understanding.visual_metadata["width"], 1)

        categories = {e.category for e in understanding.entities}
        self.assertIn("date", categories)
        self.assertIn("amount", categories)
        self.assertIn("link", categories)
        self.assertIn("visual_resolution", categories)
        self.assertTrue(len(understanding.suggested_actions) > 0)
        self.assertIn("manager", understanding.recommended_agents)

    def test_vision_agent_ecommerce_detection(self) -> None:
        text = "Sony WH-1000XM5 Wireless Headphones. Special discount price: $399.99 USD in cart."
        understanding = self.agent.analyze(
            url="https://store.example.com/product/sony-wh1000xm5",
            title="Buy Sony WH-1000XM5 - Electronics Store",
            text_context=text,
        )
        self.assertEqual(understanding.layout_type, "ecommerce")
        self.assertIn("product", understanding.recommended_agents)

    def test_screenshot_api_endpoint(self) -> None:
        payload = {
            "screenshot": self.valid_png,
            "url": "https://calendar.google.com/calendar/u/0/r",
            "title": "Google Calendar - November 2026",
            "textContext": {
                "url": "https://calendar.google.com/calendar/u/0/r",
                "title": "Google Calendar - November 2026",
                "text": "Team sync meeting scheduled for 2026-11-20 at 10:00 AM.",
            },
        }

        response = self.client.post("/v1/screenshot", json=payload, headers={"X-MindSpace-Client": "test"})
        self.assertEqual(response.status_code, 200)

        data = response.json()
        self.assertIn("analysis", data)
        self.assertTrue(data["analysis"]["image_valid"])
        self.assertEqual(data["analysis"]["visual_metadata"]["width"], 1)
        self.assertEqual(data["analysis"]["detected_layout"], "calendar_schedule")
        self.assertIn("calendar", data["analysis"]["recommended_agents"])
        self.assertTrue(data["mock"])

    def test_vision_multimodal_live_understanding_parsing(self) -> None:
        from unittest.mock import patch
        from app.llm import LLMResult

        mock_llm_json = """{
            "layout_type": "workspace_document",
            "summary": "Multimodal analysis shows a technical documentation page with API endpoints and code blocks.",
            "visible_intents": ["review API documentation", "integrate REST endpoint"],
            "suggested_actions": ["Copy curl snippet", "Generate SDK client"],
            "recommended_agents": ["docs", "extractor"]
        }"""

        with patch("app.llm.generate_vision_understanding") as mock_vision:
            mock_vision.return_value = LLMResult(
                text=mock_llm_json,
                model="groq/llama-3.2-11b-vision-preview",
                mock=False,
                prompt_tokens=42,
                completion_tokens=85,
            )

            understanding = self.agent.analyze(
                screenshot_base64=self.valid_png,
                url="https://docs.example.com/api",
                title="API Documentation",
                text_context="Documentation text",
            )

            self.assertEqual(understanding.mode, "live")
            self.assertFalse(understanding.mock)
            self.assertEqual(understanding.model, "groq/llama-3.2-11b-vision-preview")
            self.assertEqual(understanding.layout_type, "workspace_document")
            self.assertEqual(understanding.summary, "Multimodal analysis shows a technical documentation page with API endpoints and code blocks.")
            self.assertIn("Copy curl snippet", understanding.suggested_actions)
            self.assertIn("docs", understanding.recommended_agents)
            intent_entities = [e.value for e in understanding.entities if e.category == "visual_intent"]
            self.assertIn("review API documentation", intent_entities)


if __name__ == "__main__":
    unittest.main()
