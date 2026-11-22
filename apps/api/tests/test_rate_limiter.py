"""Tests for the in-memory sliding-window rate limiter.

Verifies:
- Requests within the limit are accepted.
- Requests exceeding the limit are rejected with correct retry-after.
- The sliding window evicts stale entries.
- Different keys are tracked independently.
- Thread safety under concurrent access.
"""

import threading
import time

import pytest

from app.rate_limiter import SlidingWindowRateLimiter


class TestSlidingWindowRateLimiter:
    """Unit tests for SlidingWindowRateLimiter."""

    def test_allows_requests_within_limit(self):
        limiter = SlidingWindowRateLimiter(max_requests=5, window_seconds=60.0)
        for _ in range(5):
            allowed, retry_after = limiter.is_allowed("user-1")
            assert allowed is True
            assert retry_after == 0

    def test_rejects_requests_exceeding_limit(self):
        limiter = SlidingWindowRateLimiter(max_requests=3, window_seconds=60.0)
        for _ in range(3):
            limiter.is_allowed("user-1")

        allowed, retry_after = limiter.is_allowed("user-1")
        assert allowed is False
        assert retry_after >= 1

    def test_different_keys_are_independent(self):
        limiter = SlidingWindowRateLimiter(max_requests=2, window_seconds=60.0)
        limiter.is_allowed("user-a")
        limiter.is_allowed("user-a")

        # user-a is exhausted
        allowed_a, _ = limiter.is_allowed("user-a")
        assert allowed_a is False

        # user-b is unaffected
        allowed_b, _ = limiter.is_allowed("user-b")
        assert allowed_b is True

    def test_sliding_window_evicts_old_entries(self):
        limiter = SlidingWindowRateLimiter(max_requests=2, window_seconds=0.15)
        limiter.is_allowed("user-1")
        limiter.is_allowed("user-1")

        allowed, _ = limiter.is_allowed("user-1")
        assert allowed is False

        # Wait for the window to slide past the first entries
        time.sleep(0.2)

        allowed, retry_after = limiter.is_allowed("user-1")
        assert allowed is True
        assert retry_after == 0

    def test_max_requests_override(self):
        limiter = SlidingWindowRateLimiter(max_requests=100, window_seconds=60.0)
        # Override to a low limit for this call
        for _ in range(2):
            limiter.is_allowed("user-1", max_requests=2)

        allowed, _ = limiter.is_allowed("user-1", max_requests=2)
        assert allowed is False

    def test_zero_limit_always_allows(self):
        limiter = SlidingWindowRateLimiter(max_requests=0, window_seconds=60.0)
        for _ in range(100):
            allowed, _ = limiter.is_allowed("user-1")
            assert allowed is True

    def test_clear_resets_all_history(self):
        limiter = SlidingWindowRateLimiter(max_requests=1, window_seconds=60.0)
        limiter.is_allowed("user-1")
        allowed, _ = limiter.is_allowed("user-1")
        assert allowed is False

        limiter.clear()
        allowed, _ = limiter.is_allowed("user-1")
        assert allowed is True

    def test_thread_safety(self):
        """Concurrent requests from multiple threads must not corrupt state."""
        limiter = SlidingWindowRateLimiter(max_requests=50, window_seconds=60.0)
        results = []

        def fire():
            for _ in range(10):
                allowed, _ = limiter.is_allowed("shared-key")
                results.append(allowed)

        threads = [threading.Thread(target=fire) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # 100 total attempts, 50 allowed
        assert results.count(True) == 50
        assert results.count(False) == 50

    def test_retry_after_is_positive(self):
        limiter = SlidingWindowRateLimiter(max_requests=1, window_seconds=60.0)
        limiter.is_allowed("user-1")
        _, retry_after = limiter.is_allowed("user-1")
        assert retry_after >= 1
        assert retry_after <= 61  # At most window + 1
