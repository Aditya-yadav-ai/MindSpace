"""
Configuration management for MAS.
All settings loaded from environment variables with sensible defaults.
"""
from __future__ import annotations
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Mirror of app.config.PLACEHOLDER_MARKERS. Kept local so the MAS package can
# still be imported without the web application (see Stage 3 report).
_PLACEHOLDER_MARKERS = (
    "placeholder",
    "replace-me",
    "replace_me",
    "changeme",
    "change-me",
    "set-your-key",
    "set_your_key",
    "your-api-key",
    "your_api_key",
    "your_key",
    "your-key",
    "invalid",
    "dummy",
    "example",
    "set-in-cloud-console",
)


def _is_usable_api_key(value: str | None) -> bool:
    """True only for a non-empty value that is not a known placeholder."""
    if not value:
        return False
    normalized = value.strip().lower()
    if not normalized:
        return False
    return not any(marker in normalized for marker in _PLACEHOLDER_MARKERS)


def _is_offline_requested() -> bool:
    raw = os.getenv("MINDSPACE_OFFLINE") or os.getenv("OFFLINE_MODE")
    if raw is None or not raw.strip():
        return False
    return raw.strip().lower() in {"1", "true", "yes", "on"}


BASE_DIR = Path(__file__).parent
OUTPUTS_DIR = BASE_DIR / "outputs"
OUTPUTS_DIR.mkdir(exist_ok=True)
(OUTPUTS_DIR / "heatmaps").mkdir(exist_ok=True)
(OUTPUTS_DIR / "reports").mkdir(exist_ok=True)
(OUTPUTS_DIR / "evaluation").mkdir(exist_ok=True)


class Config:
    # LLM
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    GROQ_CONFIGURED: bool = _is_usable_api_key(GROQ_API_KEY)
    OFFLINE_REQUESTED: bool = _is_offline_requested()
    # Mock mode is forced when no usable key exists, regardless of the request.
    OFFLINE_MODE: bool = OFFLINE_REQUESTED or not GROQ_CONFIGURED
    GROQ_MODEL_FAST: str = os.getenv("GROQ_MODEL_FAST", "llama3-8b-8192")
    GROQ_MODEL_SMART: str = os.getenv("GROQ_MODEL_SMART", "llama-3.1-70b-versatile")
    GROQ_MODEL_ADK: str = os.getenv("GROQ_MODEL_ADK", "groq/llama-3.1-70b-versatile")

    # A2A Server
    A2A_SERVER_HOST: str = os.getenv("A2A_SERVER_HOST", "127.0.0.1")
    A2A_SERVER_PORT: int = int(os.getenv("A2A_SERVER_PORT", "8001"))
    A2A_SERVER_URL: str = os.getenv("A2A_SERVER_URL", "http://127.0.0.1:8001")

    # Blackboard
    BLACKBOARD_DB: str = str(OUTPUTS_DIR / "blackboard.db")
    # P2P messaging uses a separate store: messages are addressed and consumed,
    # whereas blackboard entries are shared and persistent.
    P2P_DB: str = os.getenv("P2P_DB", str(OUTPUTS_DIR / "p2p_mailbox.db"))

    # Local knowledge base used for retrieval (RAG) on the Python agent path.
    # Relative defaults are resolved against the repository so the project stays portable.
    KNOWLEDGE_DB: str = os.getenv("KNOWLEDGE_DB", str(OUTPUTS_DIR / "knowledge.db"))

    # Observability
    AUDIT_LOG: str = str(OUTPUTS_DIR / "audit_trail.jsonl")
    OTEL_ENDPOINT: str = os.getenv("OTEL_ENDPOINT", "")

    # Evaluation
    EVAL_RUNS: int = int(os.getenv("EVAL_RUNS", "40"))
    RESULTS_CSV: str = str(OUTPUTS_DIR / "evaluation" / "results_dataset.csv")
    BOXPLOT_PNG: str = str(OUTPUTS_DIR / "evaluation" / "boxplot.png")
    PERFORMANCE_REPORT: str = str(OUTPUTS_DIR / "evaluation" / "performance_report.md")

    # Deployment
    GCP_PROJECT: str = os.getenv("GCP_PROJECT", "your-gcp-project-id")
    GCP_REGION: str = os.getenv("GCP_REGION", "us-central1")
    SERVICE_NAME: str = os.getenv("SERVICE_NAME", "mindspace-agent-api")

    # Guardrails
    MAX_INPUT_LENGTH: int = 2000
    TOXICITY_THRESHOLD: float = 0.7


config = Config()
