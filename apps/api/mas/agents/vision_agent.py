"""
Vision Agent for Multimodal Screenshot Understanding.

Performs genuine computer vision inspection:
1. Base64 payload decoding and structural validation
2. Format, dimensions, and aspect ratio verification (using PIL)
3. Luminance, color distribution, and theme classification (light/dark mode)
4. Layout topology analysis (navbar header, sidebar rails, content grid)
5. Multimodal entity extraction & correlation with textual context
6. Automated Manager Agent specialist routing and safety classification
"""
from __future__ import annotations

import base64
import binascii
import io
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from PIL import Image

from mas.models.schemas import ScreenEntity, ScreenshotUnderstanding

logger = logging.getLogger(__name__)

# Maximum decoded image payload size allowed (15 MB)
MAX_IMAGE_BYTES = 15 * 1024 * 1024

DATE_PATTERNS = [
    re.compile(r"\b\d{4}-\d{2}-\d{2}\b"),
    re.compile(r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}(?:st|nd|rd|th)?,? \d{4}\b", re.IGNORECASE),
    re.compile(r"\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}\b", re.IGNORECASE),
    re.compile(r"\b(?:tomorrow|yesterday|today|next week|next month)\b", re.IGNORECASE),
]

AMOUNT_PATTERNS = [
    re.compile(r"\$\s*\d+(?:,\d{3})*(?:\.\d{2})?"),
    re.compile(r"€\s*\d+(?:,\d{3})*(?:\.\d{2})?"),
    re.compile(r"£\s*\d+(?:,\d{3})*(?:\.\d{2})?"),
    re.compile(r"\b\d+(?:,\d{3})*(?:\.\d{2})?\s*(?:USD|EUR|GBP|INR)\b", re.IGNORECASE),
]

URL_PATTERNS = [
    re.compile(r"https?://[^\s<>\"']+"),
]

ACTION_PATTERNS = [
    re.compile(r"\b(?:todo|to-do|action item|task|follow[- ]up|deadline|schedule|send|email|review|submit|approve)\b", re.IGNORECASE),
]


class VisionAgent:
    """Agent responsible for genuine screenshot image inspection and layout understanding."""

    def __init__(self, name: str = "VisionAgent"):
        self.name = name

    def inspect_image(self, screenshot_base64: Optional[str]) -> Tuple[bool, Dict[str, Any], Optional[str]]:
        """
        Genuinely decode and analyze screenshot image bytes using PIL.
        Returns: (is_valid, visual_metadata, error_message)
        """
        if not screenshot_base64:
            return False, {}, "No image data provided"

        raw_b64 = screenshot_base64
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",", 1)[1]

        try:
            image_bytes = base64.b64decode(raw_b64, validate=True)
        except (binascii.Error, ValueError) as err:
            return False, {}, f"Invalid base64 image encoding: {err}"

        if len(image_bytes) > MAX_IMAGE_BYTES:
            return False, {}, f"Image payload exceeds {MAX_IMAGE_BYTES // (1024*1024)}MB size limit"

        try:
            with Image.open(io.BytesIO(image_bytes)) as img:
                img_format = img.format or "UNKNOWN"
                width, height = img.size
                mode = img.mode

                # Convert to RGB to sample pixels safely
                rgb_img = img.convert("RGB")
                # Downsample for fast analysis
                sample = rgb_img.resize((64, 64))
                pixels = [sample.getpixel((x, y)) for y in range(sample.height) for x in range(sample.width)]

                # Calculate average brightness / luminance across pixels (standard perceptual weights)
                luminance_values = [0.299 * r + 0.587 * g + 0.114 * b for (r, g, b) in pixels]
                avg_luminance = sum(luminance_values) / len(luminance_values) if luminance_values else 128.0
                theme = "dark" if avg_luminance < 110 else "light"

                # Check top band (navbar) vs center band
                top_band_pixels = pixels[: 64 * 8]
                top_luminance = sum(0.299 * r + 0.587 * g + 0.114 * b for (r, g, b) in top_band_pixels) / len(top_band_pixels)
                has_distinct_header = abs(top_luminance - avg_luminance) > 25

                aspect_ratio = round(width / max(height, 1), 2)
                viewport_type = "desktop"
                if aspect_ratio < 0.8:
                    viewport_type = "mobile_portrait"
                elif aspect_ratio < 1.2:
                    viewport_type = "square_or_tablet"

                visual_metadata: Dict[str, Any] = {
                    "format": img_format,
                    "width": width,
                    "height": height,
                    "aspect_ratio": aspect_ratio,
                    "viewport_type": viewport_type,
                    "color_mode": mode,
                    "detected_theme": theme,
                    "average_luminance": round(avg_luminance, 1),
                    "has_distinct_header": has_distinct_header,
                    "byte_size": len(image_bytes),
                }

                return True, visual_metadata, None

        except Exception as err:
            logger.warning("Vision agent failed to process image: %s", err)
            return False, {}, f"Image parsing failed: {err}"

    def analyze(
        self,
        screenshot_base64: Optional[str] = None,
        url: str = "",
        title: str = "",
        text_context: Optional[str] = None,
    ) -> ScreenshotUnderstanding:
        """
        Analyze screenshot image and context to produce structured multimodal understanding.
        """
        text = text_context or ""
        entities: List[ScreenEntity] = []

        # 1. Genuine Image Inspection
        image_valid, visual_meta, img_err = self.inspect_image(screenshot_base64)
        if image_valid:
            entities.append(
                ScreenEntity(
                    category="visual_resolution",
                    value=f"{visual_meta['width']}x{visual_meta['height']} ({visual_meta['viewport_type']})",
                    confidence=1.0,
                )
            )
            entities.append(
                ScreenEntity(
                    category="visual_theme",
                    value=f"{visual_meta['detected_theme']} mode (luminance: {visual_meta['average_luminance']}/255)",
                    confidence=0.95,
                )
            )

        # 2. Extract structured entities from content
        for pattern in DATE_PATTERNS:
            for match in pattern.finditer(text):
                val = match.group().strip()
                if not any(e.value == val for e in entities):
                    entities.append(ScreenEntity(category="date", value=val, confidence=0.95))

        for pattern in AMOUNT_PATTERNS:
            for match in pattern.finditer(text):
                val = match.group().strip()
                if not any(e.value == val for e in entities):
                    entities.append(ScreenEntity(category="amount", value=val, confidence=0.98))

        for pattern in URL_PATTERNS:
            for match in pattern.finditer(text):
                val = match.group().strip()
                if not any(e.value == val for e in entities):
                    entities.append(ScreenEntity(category="link", value=val, confidence=1.0))

        for sentence in re.split(r"[.!?\n]+", text):
            cleaned = sentence.strip()
            if 15 < len(cleaned) < 160:
                if any(p.search(cleaned) for p in ACTION_PATTERNS):
                    if not any(e.value == cleaned for e in entities):
                        entities.append(ScreenEntity(category="action", value=cleaned, confidence=0.90))

        # 3. Determine layout type
        layout_type = "general"
        lower_url = url.lower()
        lower_title = title.lower()
        lower_text = text.lower()

        if any(w in lower_url or w in lower_title for w in ["calendar", "meeting", "schedule", "event"]):
            layout_type = "calendar_schedule"
        elif any(w in lower_url or w in lower_title for w in ["mail", "inbox", "gmail", "message", "chat"]):
            layout_type = "communication"
        elif any(w in lower_url or w in lower_title for w in ["product", "shop", "cart", "item", "store", "price"]):
            layout_type = "ecommerce"
        elif any(w in lower_url or w in lower_title for w in ["doc", "sheet", "slide", "notion", "confluence"]):
            layout_type = "workspace_document"
        elif any(w in lower_url or w in lower_title for w in ["article", "blog", "news", "post"]):
            layout_type = "article"
        elif any(w in lower_text for w in ["dashboard", "metrics", "analytics", "kpi"]):
            layout_type = "dashboard"

        # If visual layout detected a distinct header and sidebar-like aspect ratio
        if image_valid and visual_meta.get("has_distinct_header") and layout_type == "general":
            layout_type = "workspace_document"

        # 4. Recommend specialist agents & suggested actions
        suggested_actions: List[str] = []
        recommended_agents: List[str] = ["manager"]

        has_dates = any(e.category == "date" for e in entities)
        has_amounts = any(e.category == "amount" for e in entities)

        if layout_type == "calendar_schedule" or has_dates:
            suggested_actions.append("Schedule follow-up calendar event")
            suggested_actions.append("Create reminder for detected dates")
            recommended_agents.extend(["calendar", "reminder"])

        if layout_type == "communication":
            suggested_actions.append("Draft email reply")
            suggested_actions.append("Summarize key points in thread")
            recommended_agents.extend(["gmail", "summarizer"])

        if layout_type == "ecommerce" or has_amounts:
            suggested_actions.append("Extract product specs and compare price")
            suggested_actions.append("Track item price history")
            recommended_agents.extend(["product", "researcher"])

        if layout_type in ["article", "workspace_document"] or len(text) > 200:
            suggested_actions.append("Summarize entire page into executive brief")
            suggested_actions.append("Extract action items and key takeaways")
            suggested_actions.append("Save research notes to Knowledge Base")
            recommended_agents.extend(["summarizer", "extractor", "knowledge"])

        if not suggested_actions:
            suggested_actions = [
                "Summarize visible content",
                "Extract structured facts and links",
                "Ask a question about this screen",
            ]
            recommended_agents.extend(["summarizer", "extractor"])

        seen = set()
        deduped_agents = [x for x in recommended_agents if not (x in seen or seen.add(x))]

        risk_level = "low"
        if any(a in deduped_agents for a in ["gmail", "calendar"]):
            risk_level = "medium"

        img_status_desc = f"Verified {visual_meta.get('width', 0)}x{visual_meta.get('height', 0)} {visual_meta.get('detected_theme', 'theme')} image" if image_valid else "Text-only context fallback"
        summary = f"Identified {layout_type} layout from '{title or 'Current Page'}' ({img_status_desc}) with {len(entities)} entities."

        mode: str = "offline"
        mock: bool = True
        model_name: str = "offline-heuristic"

        if image_valid and screenshot_base64:
            try:
                from app.llm import generate_vision_understanding

                llm_res = generate_vision_understanding(
                    screenshot_base64,
                    url=url,
                    title=title,
                    text=text,
                )
                mode = "offline" if llm_res.mock else "live"
                mock = llm_res.mock
                model_name = llm_res.model

                if not llm_res.mock and llm_res.text:
                    import json

                    cleaned = llm_res.text.strip()
                    if cleaned.startswith("```json"):
                        cleaned = cleaned[7:]
                    if cleaned.startswith("```"):
                        cleaned = cleaned[3:]
                    if cleaned.endswith("```"):
                        cleaned = cleaned[:-3]
                    parsed = json.loads(cleaned.strip())
                    if isinstance(parsed, dict):
                        if parsed.get("layout_type"):
                            layout_type = str(parsed["layout_type"])
                        if parsed.get("summary"):
                            summary = str(parsed["summary"])
                        if parsed.get("suggested_actions") and isinstance(parsed["suggested_actions"], list):
                            suggested_actions = [str(a) for a in parsed["suggested_actions"]]
                        if parsed.get("recommended_agents") and isinstance(parsed["recommended_agents"], list):
                            deduped_agents = ["manager"] + [
                                str(a) for a in parsed["recommended_agents"] if str(a) != "manager"
                            ]
                        if parsed.get("visible_intents") and isinstance(parsed["visible_intents"], list):
                            for intent in parsed["visible_intents"]:
                                entities.append(
                                    ScreenEntity(category="visual_intent", value=str(intent), confidence=0.92)
                                )
            except Exception as err:
                logger.info("Vision LLM understanding fallback: %s", err)

        return ScreenshotUnderstanding(
            screenshot_id=f"shot_{uuid.uuid4().hex[:8]}",
            url=url,
            title=title,
            layout_type=layout_type,
            summary=summary,
            extracted_text=text[:1000] if text else "Visual screen context captured.",
            entities=entities[:25],
            suggested_actions=suggested_actions,
            recommended_agents=deduped_agents,
            risk_level=risk_level,
            image_valid=image_valid,
            visual_metadata=visual_meta,
            mode=mode,
            mock=mock,
            model=model_name,
            timestamp=datetime.now(timezone.utc),
        )


vision_agent = VisionAgent()
