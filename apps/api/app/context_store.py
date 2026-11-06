"""Bounded, thread-safe store for the most recent page capture per client.

The extension POSTs a capture and the web app reads the latest one. This is
deliberately server-side (not `chrome.storage`) so the browser app and the
extension can share context without cross-origin storage access.

Storage is in-memory and local to the service process: captures are never
written to disk, never logged, and expire automatically.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass

from app.schemas import PageContext

DEFAULT_TTL_SECONDS = 1800.0
MAX_CLIENTS = 64


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

    def _prune(self, now: float) -> None:
        expired = [key for key, entry in self._entries.items() if now - entry.stored_monotonic > self._ttl]
        for key in expired:
            self._entries.pop(key, None)
        if len(self._entries) > self._max_clients:
            oldest = sorted(self._entries.items(), key=lambda item: item[1].stored_monotonic)
            for key, _ in oldest[: len(self._entries) - self._max_clients]:
                self._entries.pop(key, None)

    def put(self, client_id: str, context: PageContext) -> None:
        now = time.monotonic()
        with self._lock:
            self._entries[client_id] = _Entry(context=context, stored_monotonic=now)
            self._prune(now)

    def get(self, client_id: str) -> tuple[PageContext | None, float | None]:
        now = time.monotonic()
        with self._lock:
            self._prune(now)
            entry = self._entries.get(client_id)
            if entry is None:
                return None, None
            return entry.context, round(now - entry.stored_monotonic, 3)

    def clear_client(self, client_id: str) -> None:
        with self._lock:
            self._entries.pop(client_id, None)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()


context_store = ContextStore()
