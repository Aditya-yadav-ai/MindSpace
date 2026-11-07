"""Bounded, thread-safe, multi-tenant store for page captures per user.

Integrates in-memory caching with database persistence for multi-tenant isolation.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass

from app.database import db
from app.schemas import PageContext

DEFAULT_TTL_SECONDS = 1800.0
MAX_CLIENTS = 128


@dataclass
class _Entry:
    context: PageContext
    stored_monotonic: float


class ContextStore:
    def __init__(self, ttl_seconds: float = DEFAULT_TTL_SECONDS, max_clients: int = MAX_CLIENTS) -> None:
        self._ttl = ttl_seconds
        self._max_clients = max_clients
        self._lock = threading.Lock()
        self._entries: dict[str, _Entry] = {}

    def _compound_key(self, tenant_id: str, user_id: str | None = None) -> tuple[str, str, str]:
        if user_id is None:
            # Backwards compatibility when single client_id is passed
            t_id = "default"
            u_id = tenant_id
        else:
            t_id = tenant_id
            u_id = user_id
        return f"{t_id}:{u_id}", t_id, u_id

    def _prune(self, now: float) -> None:
        expired = [key for key, entry in self._entries.items() if now - entry.stored_monotonic > self._ttl]
        for key in expired:
            self._entries.pop(key, None)
        if len(self._entries) > self._max_clients:
            oldest = sorted(self._entries.items(), key=lambda item: item[1].stored_monotonic)
            for key, _ in oldest[: len(self._entries) - self._max_clients]:
                self._entries.pop(key, None)

    def put(self, tenant_id: str, user_id_or_context: str | PageContext, context: PageContext | None = None) -> None:
        now = time.monotonic()
        if isinstance(user_id_or_context, PageContext):
            # Signature: put(client_id, context)
            key, t_id, u_id = self._compound_key(tenant_id)
            ctx = user_id_or_context
        else:
            # Signature: put(tenant_id, user_id, context)
            if context is None:
                raise ValueError("context must be provided")
            key, t_id, u_id = self._compound_key(tenant_id, user_id_or_context)
            ctx = context

        with self._lock:
            self._entries[key] = _Entry(context=ctx, stored_monotonic=now)
            self._prune(now)

        # Persist to database engine (PostgreSQL or SQLite)
        try:
            db.save_context(t_id, u_id, ctx)
        except Exception:
            pass

    def get(self, tenant_id: str, user_id: str | None = None) -> tuple[PageContext | None, float | None]:
        now = time.monotonic()
        key, t_id, u_id = self._compound_key(tenant_id, user_id)

        with self._lock:
            self._prune(now)
            entry = self._entries.get(key)
            if entry is not None:
                return entry.context, round(now - entry.stored_monotonic, 3)

        # Cache miss: load from persistent database
        try:
            ctx, age = db.load_context(t_id, u_id)
            if ctx is not None:
                with self._lock:
                    self._entries[key] = _Entry(context=ctx, stored_monotonic=now)
                return ctx, age
        except Exception:
            pass

        return None, None

    def clear_client(self, tenant_id: str, user_id: str | None = None) -> None:
        key, t_id, u_id = self._compound_key(tenant_id, user_id)
        with self._lock:
            self._entries.pop(key, None)
        try:
            db.clear_context(t_id, u_id)
        except Exception:
            pass

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
        try:
            with db.connection() as conn:
                conn.execute("DELETE FROM user_contexts")
        except Exception:
            pass


context_store = ContextStore()
