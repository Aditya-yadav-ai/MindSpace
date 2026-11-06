"""
Guardrails for MAS security (Requirement #8).

Multiple validation layers:
1. Input toxicity detection (for personas with abusive language)
2. Prompt injection attack detection
3. Pydantic type validation on tool outputs
4. LLM output content validation
5. Rate limiting per persona

Detection is obfuscation-resistant: text is Unicode-normalised, zero-width and
bidi characters are removed, homoglyphs and leetspeak are folded, whitespace is
collapsed, and base64-looking runs are decoded and re-scanned. The canonical
text is only used for matching and (when toxicity is found) for filtering; it is
never treated as instructions.
"""
from __future__ import annotations

import base64
import binascii
import re
import unicodedata
import logging
from typing import Any, Dict, List, Optional, Tuple
from pydantic import BaseModel, ValidationError
from mas.models.schemas import GuardrailFlags

logger = logging.getLogger(__name__)


# ─── Toxic/abusive language patterns ─────────────────────────────────────────
# These simulate the 'aggressive trader' and 'toxic user' personas
TOXIC_PATTERNS = [
    r"\b(stupid|idiot|moron|dumb|hate|loser|screw you|f\*\*k|sh\*t|damn|crap)\b",
    r"\b(kill|destroy|burn|attack|assault)\b",
    r"(go to hell|shut up|you suck)",
]

# ─── Prompt injection patterns ────────────────────────────────────────────────
INJECTION_PATTERNS = [
    # "ignore your instructions" must be caught even without a temporal
    # qualifier ("previous"/"above"). Benign uses such as "ignore the noise"
    # are still safe because the pattern requires an instruction noun.
    r"ignore\s+(?:all\s+|any\s+)?(?:(?:your|the|my|our|these|those|system|previous|prior|above|preceding|earlier)\s+)*(?:instructions?|rules?|prompts?|guidelines?|directives?)",
    r"forget\s+(everything|all|anything)\s+(above|before|prior|previously)",
    r"disregard\s+(all\s+|any\s+)?(the\s+|your\s+)?(system|previous|prior|above)?\s*(prompt|instructions?|rules|guidelines)",
    r"(new|updated|revised)\s+instructions\s*:",
    r"(you are now|from now on you are|act as)\s+(a|an|the|no longer)\s+(?!market|product|analyst|researcher|optimizer)",
    r"jailbreak",
    r"dan mode",
    r"(do anything now|developer mode)",
    r"(override|disable|bypass|turn off)\s+(the\s+|your\s+)?(safety|guardrail|filter|restriction|polic)",
    r"<(script|iframe|object|embed)",
    r"(javascript\s*:|onerror\s*=|onload\s*=|data\s*:\s*text/html)",
    r"(system|assistant|human):",
    r"\\n(system|assistant|human):",
    r"prompt injection",
    r"(reveal|print|repeat|show|output|leak)\s+(me\s+)?(your\s+)?(system\s+)?(prompt|instructions)",
    # Exfiltration verbs that real personas use ("tell me all your system
    # prompts"). A qualifier (system/hidden/initial/original/full) is required
    # so ordinary requests like "give me the instructions for the desk" pass.
    r"(?:tell|give|share|disclose|dump|reveal|print|repeat|show|output|leak)\s+(?:me\s+)?(?:all\s+)?(?:your|the)\s+(?:system\s+|hidden\s+|initial\s+|original\s+|full\s+)(?:prompts?|instructions?)",
    r"what\s+(?:is|are|was|were)\s+(?:your|the)\s+(?:system\s+)?(?:prompt|instructions?)",
    r"what (are|were) your instructions",
    r"(send|post|upload|forward|email|transmit|exfiltrate)\s+(the\s+|your\s+)?(api\s*key|token|password|credentials|secrets?|env(ironment)?\s+variables?)",
    r"(call|invoke|execute)\s+(the\s+)?(tool|function)\b",
    r"base64\.decode",
    r"exec\(|eval\(",
]

_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u200b-\u200f\u202a-\u202e\ufeff]")
_HOMOGLYPHS = str.maketrans(
    {
        "\u0430": "a", "\u0435": "e", "\u043e": "o", "\u0440": "p", "\u0441": "c",
        "\u0443": "y", "\u0445": "x", "\u0456": "i", "\u0458": "j", "\u0455": "s",
        "\u0501": "d", "\u04bb": "h", "\u04cf": "l",
        "\u0410": "a", "\u0415": "e", "\u041e": "o", "\u0420": "p", "\u0421": "c",
        "\u0423": "y", "\u0425": "x",
        "\u0391": "a", "\u0392": "b", "\u0395": "e", "\u0396": "z", "\u0397": "h",
        "\u0399": "i", "\u039a": "k", "\u039c": "m", "\u039d": "n", "\u039f": "o",
        "\u03a1": "p", "\u03a4": "t", "\u03a7": "x", "\u03b1": "a", "\u03bf": "o",
    }
)
_LEETSPEAK_L = str.maketrans(
    {"0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s"}
)
_LEETSPEAK_I = str.maketrans(
    {"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s"}
)
_BASE64_CANDIDATE = re.compile(r"[A-Za-z0-9+/]{20,}={0,2}")
_PAYLOAD_HINTS = ("ignore", "instruction", "prompt", "disregard", "exfiltrate", "reveal", "password", "api key")


def canonical_text(text: str) -> str:
    """Case-preserving canonical form used for matching and toxic filtering."""
    folded = unicodedata.normalize("NFKC", text or "")
    folded = _CONTROL_CHARS.sub("", folded)
    folded = folded.translate(_HOMOGLYPHS)
    return re.sub(r"[ \t]+", " ", folded).strip()


def _decoded_payloads(text: str) -> List[str]:
    found: List[str] = []
    for match in _BASE64_CANDIDATE.finditer(text or ""):
        token = match.group()
        if len(token) % 4:
            token += "=" * (-len(token) % 4)
        try:
            decoded = base64.b64decode(token, validate=True)
            printable = decoded.decode("utf-8")
        except (binascii.Error, ValueError, UnicodeDecodeError):
            continue
        printable = "".join(ch for ch in printable if ch.isprintable() or ch.isspace())
        lowered = printable.lower()
        if len(printable.strip()) >= 8 and any(hint in lowered for hint in _PAYLOAD_HINTS):
            found.append(printable)
    return found


class GuardrailValidator:
    """
    Central guardrail manager.
    Validates inputs before they reach agents,
    and validates tool outputs before they enter the blackboard.
    """

    def __init__(self, max_input_length: int = 2000, toxicity_block: bool = True):
        self.max_input_length = max_input_length
        self.toxicity_block = toxicity_block
        self._toxic_re = re.compile(
            "|".join(TOXIC_PATTERNS), re.IGNORECASE
        )
        self._injection_re = re.compile(
            "|".join(INJECTION_PATTERNS), re.IGNORECASE
        )

    def _views(self, text: str) -> List[str]:
        """Matching views: canonical, both leetspeak readings, decoded payloads."""
        canonical = canonical_text(text)
        variants = {
            canonical.translate(_LEETSPEAK_L),
            canonical.translate(_LEETSPEAK_I),
        }
        views = [canonical]
        views.extend(sorted(variant for variant in variants if variant != canonical))
        views.extend(canonical_text(payload) for payload in _decoded_payloads(text))
        return views

    def validate_input(self, text: str, persona: str = "unknown") -> Tuple[str, GuardrailFlags]:
        """
        Validate and sanitize user input.
        Returns (sanitized_text, flags).
        """
        flags = GuardrailFlags()

        # 1. Length check
        if len(text) > self.max_input_length:
            text = text[:self.max_input_length]
            flags.type_errors.append(f"Input truncated to {self.max_input_length} chars")
            logger.warning(f"[Guardrail] Input truncated for persona={persona}")

        views = self._views(text)

        # 2. Injection detection
        injection_match = None
        for view in views:
            injection_match = self._injection_re.search(view)
            if injection_match:
                break
        if injection_match:
            flags.injection_detected = True
            flags.risk_level = "high"
            flags.blocked = True
            flags.reason = f"Prompt injection detected: '{injection_match.group()}'"
            logger.warning(f"[Guardrail] INJECTION BLOCKED persona={persona} match='{injection_match.group()}'")
            return "", flags

        # 3. Toxicity detection
        toxic_match = None
        for view in views:
            toxic_match = self._toxic_re.search(view)
            if toxic_match:
                break
        if toxic_match:
            flags.toxicity_detected = True
            flags.risk_level = "medium"
            if self.toxicity_block:
                # Sanitize rather than block — replace toxic words
                text = self._toxic_re.sub("[FILTERED]", canonical_text(text))
                logger.warning(f"[Guardrail] Toxic content filtered persona={persona} match='{toxic_match.group()}'")
            else:
                flags.risk_level = "high"
                flags.blocked = True
                flags.reason = f"Toxic content: '{toxic_match.group()}'"
                return "", flags

        # 4. XSS/HTML injection
        text = re.sub(r"<[^>]+>", "", text)

        flags.sanitized_input = text
        if flags.toxicity_detected and not flags.blocked:
            flags.risk_level = "medium"
        elif not flags.toxicity_detected and not flags.injection_detected:
            flags.risk_level = "low"

        logger.debug(f"[Guardrail] Input validated persona={persona} risk={flags.risk_level}")
        return text, flags

    def validate_tool_output(self, output: Any, schema: type, agent_name: str) -> Tuple[Optional[Any], List[str]]:
        """
        Validate tool output against a Pydantic schema.
        Returns (validated_model_or_None, errors).
        """
        errors = []
        if output is None:
            errors.append(f"{agent_name}: Tool returned None")
            return None, errors
        try:
            if isinstance(output, dict):
                validated = schema(**output)
            elif isinstance(output, schema):
                validated = output
            else:
                errors.append(f"{agent_name}: Unexpected type {type(output).__name__}")
                return None, errors
            return validated, errors
        except ValidationError as e:
            for err in e.errors():
                errors.append(f"{agent_name}: {err['loc']} - {err['msg']}")
            logger.error(f"[Guardrail] Type validation failed agent={agent_name}: {errors}")
            return None, errors

    def validate_llm_output(self, output: str, agent_name: str) -> Tuple[str, List[str]]:
        """Validate LLM text output for injection or harmful content."""
        warnings = []
        if not output or not output.strip():
            warnings.append(f"{agent_name}: Empty LLM output")
            return "", warnings
        # Check for prompt injection in LLM response (adversarial outputs)
        if any(self._injection_re.search(view) for view in self._views(output)):
            output = "[OUTPUT FILTERED: potential injection in LLM response]"
            warnings.append(f"{agent_name}: LLM output contained injection patterns")
        return output.strip(), warnings

    def check_price_sanity(self, price: float, context: str = "") -> Tuple[bool, str]:
        """Sanity check for pricing outputs."""
        if price <= 0:
            return False, f"Invalid negative/zero price {price} in {context}"
        if price > 100_000:
            return False, f"Unrealistic price {price} > $100,000 in {context}"
        return True, ""


# ─── Singleton ────────────────────────────────────────────────────────────────
_validator: Optional[GuardrailValidator] = None


def get_validator() -> GuardrailValidator:
    global _validator
    if _validator is None:
        from mas.config import config
        _validator = GuardrailValidator(
            max_input_length=config.MAX_INPUT_LENGTH,
            toxicity_block=True,
        )
    return _validator
