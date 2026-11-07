"""In-memory sliding-window rate limiter for MindSpace API endpoints.

Thread-safe and lightweight, designed for single-node deployments and local extensions.
"""

from __future__ import annotations

import collections
import threading
import time
from typing import Deque


class SlidingWindowRateLimiter:
    """Sliding-window rate limiter tracking requests over a configurable time window."""

    def __init__(self, max_requests: int = 60, window_seconds: float = 60.0) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._history: dict[str, Deque[float]] = {}
        self._lock = threading.Lock()

    def is_allowed(self, key: str, max_requests: int | None = None) -> tuple[bool, int]:
        """Check if a request under `key` is allowed.

        Returns (allowed: bool, retry_after_seconds: int).
        """
        limit = max_requests if max_requests is not None else self.max_requests
        if limit <= 0:
            return True, 0

        now = time.monotonic()
        cutoff = now - self.window_seconds

        with self._lock:
            queue = self._history.setdefault(key, collections.deque())
            # Evict timestamps older than the cutoff
            while queue and queue[0] <= cutoff:
                queue.popleft()

            if len(queue) >= limit:
                retry_after = int(queue[0] + self.window_seconds - now) + 1
                return False, max(1, retry_after)

            queue.append(now)
            return True, 0

    def clear(self) -> None:
        """Clear all recorded rate limit history."""
        with self._lock:
            self._history.clear()


rate_limiter = SlidingWindowRateLimiter()

