"""Enterprise JWT validation and identity extraction for MindSpace API.

Validates signature, expiration, issuer, audience, and extracts user/tenant identity.
Supports both Supabase JWT tokens (HS256) and service API keys.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import jwt
from fastapi import HTTPException, Request

from app.config import settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AuthUser:
    """Authenticated user context containing verified tenant and user identity."""

    user_id: str
    tenant_id: str
    email: str = ""
    role: str = "authenticated"
    is_service: bool = False


def validate_jwt(
    token: str,
    secret: str | None = None,
    issuer: str | None = None,
    audience: str | None = None,
) -> dict[str, Any]:
    """Validate a JWT token's signature, expiration, issuer, and audience.

    Raises HTTPException(401) on any validation failure.
    """
    key = secret or settings.jwt_secret.strip()
    if not key:
        raise HTTPException(
            status_code=401,
            detail="JWT secret is not configured on the service. Cannot verify token.",
        )

    expected_issuer = issuer or (settings.jwt_issuer.strip() if settings.jwt_issuer.strip() else None)
    expected_audience = audience or (settings.jwt_audience.strip() if settings.jwt_audience.strip() else None)

    options = {
        "verify_signature": True,
        "verify_exp": True,
        "verify_nbf": True,
        "verify_iat": True,
        "verify_aud": bool(expected_audience),
        "verify_iss": bool(expected_issuer),
    }

    decode_kwargs: dict[str, Any] = {
        "algorithms": ["HS256", "RS256", "ES256"],
        "options": options,
        "leeway": 30,  # 30 seconds clock drift tolerance
    }
    if expected_issuer:
        decode_kwargs["issuer"] = expected_issuer
    if expected_audience:
        decode_kwargs["audience"] = expected_audience

    try:
        payload = jwt.decode(token, key, **decode_kwargs)
    except jwt.ExpiredSignatureError as err:
        logger.warning("JWT validation failed: Token expired: %s", err)
        raise HTTPException(status_code=401, detail="Authentication token has expired.") from err
    except jwt.InvalidIssuerError as err:
        logger.warning("JWT validation failed: Invalid issuer: %s", err)
        raise HTTPException(status_code=401, detail="Authentication token issuer is invalid.") from err
    except jwt.InvalidAudienceError as err:
        logger.warning("JWT validation failed: Invalid audience: %s", err)
        raise HTTPException(status_code=401, detail="Authentication token audience is invalid.") from err
    except jwt.InvalidSignatureError as err:
        logger.warning("JWT validation failed: Invalid signature: %s", err)
        raise HTTPException(status_code=401, detail="Authentication token signature is invalid.") from err
    except jwt.PyJWTError as err:
        logger.warning("JWT validation failed: %s: %s", type(err).__name__, err)
        raise HTTPException(status_code=401, detail=f"Authentication token is invalid: {type(err).__name__}") from err

    if "sub" not in payload or not str(payload["sub"]).strip():
        logger.warning("JWT validation failed: Missing 'sub' claim in token payload.")
        raise HTTPException(status_code=401, detail="Authentication token missing user identity ('sub').")

    return payload


def extract_auth_user(payload: dict[str, Any]) -> AuthUser:
    """Extract strongly-typed AuthUser from validated JWT claims."""
    user_id = str(payload["sub"]).strip()
    app_meta = payload.get("app_metadata", {})
    user_meta = payload.get("user_metadata", {})

    tenant_id = (
        payload.get("tenant_id")
        or app_meta.get("tenant_id")
        or user_meta.get("tenant_id")
        or payload.get("org_id")
        or user_id
    )

    email = str(payload.get("email") or user_meta.get("email") or "")
    role = str(payload.get("role") or app_meta.get("role") or "authenticated")

    return AuthUser(
        user_id=user_id,
        tenant_id=str(tenant_id).strip(),
        email=email,
        role=role,
        is_service=False,
    )


def authenticate_request(request: Request) -> AuthUser:
    """Authenticate incoming HTTP request against JWT or Service API Key.

    Enforces fail-closed security in production.
    """
    is_prod = settings.environment.strip().lower() == "production"
    configured_api_key = settings.api_key.strip()
    configured_jwt_secret = settings.jwt_secret.strip()

    # 1. Check for Service API Key in header
    api_key_header = request.headers.get("X-API-Key", "").strip()
    if api_key_header and configured_api_key and api_key_header == configured_api_key:
        client_header = request.headers.get("X-MindSpace-Client", "local").strip()
        return AuthUser(
            user_id=client_header or "service_api",
            tenant_id="default",
            role="service",
            is_service=True,
        )

    # 2. Check for Authorization Bearer Header
    auth_header = request.headers.get("Authorization", "").strip()
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()
        if not token:
            raise HTTPException(status_code=401, detail="Empty bearer token provided.")

        # Check if bearer matches static service API key
        if configured_api_key and token == configured_api_key:
            client_header = request.headers.get("X-MindSpace-Client", "local").strip()
            return AuthUser(
                user_id=client_header or "service_api",
                tenant_id="default",
                role="service",
                is_service=True,
            )

        # Token looks like a JWT (3 dot-separated segments)
        if token.count(".") == 2:
            if not configured_jwt_secret and is_prod:
                raise HTTPException(
                    status_code=401,
                    detail="Production service must have JWT_SECRET configured to verify bearer tokens.",
                )
            if configured_jwt_secret:
                payload = validate_jwt(token, secret=configured_jwt_secret)
                return extract_auth_user(payload)

            # In development mode only without JWT_SECRET: decode unverified claims for local testing
            if not is_prod:
                try:
                    payload = jwt.decode(token, options={"verify_signature": False})
                    if "sub" in payload:
                        return extract_auth_user(payload)
                except Exception:
                    pass

    # 3. Unauthenticated requests handling
    if is_prod:
        raise HTTPException(
            status_code=401,
            detail="Authentication required: Provide a valid JWT Bearer token or X-API-Key.",
        )

    # 4. Local Development Fallback
    client_id = request.headers.get("X-MindSpace-Client", "local").strip() or "local"
    return AuthUser(
        user_id=client_id,
        tenant_id=client_id,
        role="developer",
        is_service=False,
    )
