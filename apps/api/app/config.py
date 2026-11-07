"""Service configuration for the MindSpace Python API.

Values come from environment variables or an optional `.env` file in the
service directory. Configuration is validated before the process starts, so an
invalid value fails fast instead of producing a half-working service.
"""

from __future__ import annotations

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Substrings that identify a value that only *looks* like a credential.
# Keys matching these are treated as "not configured" so the service never
# claims to be in live mode without a real key.
PLACEHOLDER_MARKERS: tuple[str, ...] = (
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

DEFAULT_PORT = 8000
DEFAULT_SERVICE_NAME = "mindspace-agent-api"


def is_usable_api_key(value: str | None) -> bool:
    """Return True only for a non-empty value that is not a known placeholder."""
    if not value:
        return False
    normalized = value.strip().lower()
    if not normalized:
        return False
    return not any(marker in normalized for marker in PLACEHOLDER_MARKERS)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
        populate_by_name=True,
    )

    port: int = Field(default=DEFAULT_PORT, ge=1, le=65535)
    host: str = Field(default="127.0.0.1")
    service_name: str = Field(default=DEFAULT_SERVICE_NAME)
    environment: str = Field(
        default="development",
        validation_alias=AliasChoices("MINDSPACE_ENV", "ENVIRONMENT", "NODE_ENV"),
    )
    api_key: str = Field(
        default="",
        validation_alias=AliasChoices("MINDSPACE_API_KEY", "API_KEY"),
    )
    allowed_extension_ids: str = Field(
        default="",
        validation_alias=AliasChoices("ALLOWED_EXTENSION_IDS", "MINDSPACE_ALLOWED_EXTENSIONS"),
    )
    rate_limit_per_minute: int = Field(
        default=60,
        validation_alias=AliasChoices("RATE_LIMIT_PER_MINUTE", "MINDSPACE_RATE_LIMIT"),
    )
    groq_api_key: str = Field(default="")
    model: str = Field(default="groq/llama-3.1-8b-instant")
    vision_model: str = Field(default="groq/llama-3.2-11b-vision-preview")
    llm_timeout_seconds: float = Field(default=25.0, gt=0, le=120)
    cors_origins: str = Field(default="")
    database_url: str = Field(
        default="",
        validation_alias=AliasChoices("DATABASE_URL", "MINDSPACE_DATABASE_URL", "POSTGRES_URL"),
    )
    jwt_secret: str = Field(
        default="",
        validation_alias=AliasChoices("JWT_SECRET", "SUPABASE_JWT_SECRET"),
    )
    jwt_issuer: str = Field(
        default="",
        validation_alias=AliasChoices("JWT_ISSUER", "SUPABASE_JWT_ISSUER"),
    )
    jwt_audience: str = Field(
        default="authenticated",
        validation_alias=AliasChoices("JWT_AUDIENCE", "SUPABASE_JWT_AUDIENCE"),
    )
    redis_url: str = Field(
        default="",
        validation_alias=AliasChoices("REDIS_URL", "MINDSPACE_REDIS_URL"),
    )
    # Explicit operator switch: MINDSPACE_OFFLINE=1 forces mock mode,
    # MINDSPACE_OFFLINE=0 still refuses to run live without a usable key.
    offline_mode: bool | None = Field(
        default=None,
        validation_alias=AliasChoices("MINDSPACE_OFFLINE", "OFFLINE_MODE"),
    )


settings = Settings()
