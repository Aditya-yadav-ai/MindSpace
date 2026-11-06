"""Tests for explicit offline/mock mode selection.

The service must never claim to be live without a usable key, and mock results
must always be labelled as such.
"""

import unittest

from app.config import Settings, is_usable_api_key
from app.runtime import MODE_LIVE, MODE_OFFLINE, resolve_runtime

REAL_KEY = "gsk_realistic_looking_key_1234567890"
PLACEHOLDER_KEYS = (
    "gsk_placeholder_set_your_key",
    "replace-me-locally",
    "CHANGEME",
    "your_key_here",
    "your-key",
    "invalid_groq_key",
    "dummy-key",
    "example_key",
    "   ",
    "",
)


class ApiKeyDetectionTests(unittest.TestCase):
    def test_usable_key_is_accepted(self) -> None:
        self.assertTrue(is_usable_api_key(REAL_KEY))

    def test_placeholder_and_blank_values_are_rejected(self) -> None:
        for value in PLACEHOLDER_KEYS:
            with self.subTest(value=value):
                self.assertFalse(is_usable_api_key(value))
        self.assertFalse(is_usable_api_key(None))


class OfflineModeTests(unittest.TestCase):
    def resolve(self, key: str, offline: bool | None) -> object:
        return resolve_runtime(Settings(_env_file=None, groq_api_key=key, offline_mode=offline))

    def test_no_key_auto_selects_labelled_mock_mode(self) -> None:
        state = self.resolve("", None)
        self.assertEqual(state.mode, MODE_OFFLINE)
        self.assertTrue(state.mock)
        self.assertFalse(state.llm_configured)

    def test_placeholder_key_is_not_treated_as_live(self) -> None:
        state = self.resolve("gsk_placeholder_set_your_key", None)
        self.assertEqual(state.mode, MODE_OFFLINE)
        self.assertTrue(state.mock)

    def test_explicit_offline_wins_even_with_a_real_key(self) -> None:
        state = self.resolve(REAL_KEY, True)
        self.assertEqual(state.mode, MODE_OFFLINE)
        self.assertTrue(state.mock)
        self.assertTrue(state.llm_configured)
        self.assertIn("MINDSPACE_OFFLINE", state.reason)

    def test_explicit_live_requires_a_usable_key(self) -> None:
        state = self.resolve(REAL_KEY, False)
        self.assertEqual(state.mode, MODE_LIVE)
        self.assertFalse(state.mock)

    def test_explicit_live_without_key_falls_back_to_mock_and_says_so(self) -> None:
        state = self.resolve("", False)
        self.assertEqual(state.mode, MODE_OFFLINE)
        self.assertTrue(state.mock)
        self.assertIn("MINDSPACE_OFFLINE=0", state.reason)


if __name__ == "__main__":
    unittest.main()
