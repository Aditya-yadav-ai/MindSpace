"""Offline tests for the multi-backend MCP web search.

No network access is used: fixtures are recorded payload shapes and the
backends are replaced with deterministic fakes. Live behaviour is covered
separately by manual smoke runs (see docs/project-progress.md).
"""
from __future__ import annotations

import unittest
from unittest import mock

from mas.mcp_service import server


BING_RSS_FIXTURE = """<?xml version="1.0" encoding="utf-8" ?>
<rss version="2.0"><channel>
  <title>Bing: wireless earbuds market</title>
  <item>
    <title>Wireless earbuds market size 2026 - Example Research</title>
    <link>https://example.com/earbuds-market</link>
    <description>&lt;b&gt;Market&lt;/b&gt; size and earbuds forecast.</description>
  </item>
  <item>
    <title>SunRisers Hyderabad</title>
    <link>https://example.invalid/cricket</link>
    <description>Unrelated cloaked payload.</description>
  </item>
</channel></rss>
"""

GOOGLE_NEWS_FIXTURE = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<rss version="2.0"><channel>
  <item>
    <title>The best wireless earbuds of 2026 - Mashable</title>
    <link>https://news.google.com/rss/articles/AAA</link>
    <pubDate>Tue, 20 Oct 2026 09:01:06 GMT</pubDate>
    <description>&lt;a href="https://news.google.com/x"&gt;Mashable&lt;/a&gt;&amp;nbsp;&amp;nbsp;
      &lt;font&gt;The best earbuds, tested.&lt;/font&gt;</description>
    <source url="https://mashable.com">Mashable</source>
  </item>
  <item>
    <title>Earbuds market outlook - Forbes</title>
    <link>https://news.google.com/rss/articles/BBB</link>
    <pubDate>Mon, 19 Oct 2026 20:52:00 GMT</pubDate>
    <description>Market outlook.</description>
    <source url="https://www.forbes.com">Forbes</source>
  </item>
</channel></rss>
"""

DDG_HTML_FIXTURE = """
<html><body>
  <div class="result results_links results_links_deep web-result">
    <div class="links_main links_deep result__body">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a"
           href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fmarket%3Fa%3D1&amp;rut=xyz">
           Wireless earbuds market report</a>
      </h2>
      <a class="result__snippet" href="#">Market size and pricing for earbuds.</a>
    </div>
  </div>
  <div class="result results_links">
    <h2 class="result__title"><a class="result__a" href="https://direct.example.org/page">Direct hit</a></h2>
    <a class="result__snippet" href="#">Second snippet.</a>
  </div>
</body></html>
"""


class QueryTokenTests(unittest.TestCase):
    def test_drops_function_words_and_short_tokens(self):
        tokens = server._query_tokens("Market analysis of the wireless earbuds in 2026")
        self.assertEqual(tokens, ["market", "analysis", "wireless", "earbuds", "2026"])

    def test_deduplicates_tokens(self):
        self.assertEqual(server._query_tokens("earbuds earbuds market"), ["earbuds", "market"])

    def test_required_matches_scales_with_query_length(self):
        self.assertEqual(server._required_matches(1), 1)
        self.assertEqual(server._required_matches(2), 1)
        self.assertEqual(server._required_matches(3), 2)
        self.assertEqual(server._required_matches(4), 2)
        self.assertEqual(server._required_matches(5), 2)
        self.assertEqual(server._required_matches(6), 2)
        self.assertEqual(server._required_matches(9), 3)

    def test_long_verbose_query_still_accepts_a_focused_headline(self):
        # Regression: a 1-in-2 threshold rejected every real result for
        # natural-language queries such as this one.
        topics = server._query_tokens(
            "what is a good price for selling phone cases I make at home"
        )
        rows = [
            {
                "title": "Phone case prices climb as material costs rise",
                "url": "https://news.example/cases",
                "snippet": "Sellers of phone cases report margin pressure.",
            }
        ]
        relevant, verdict = server._select_relevant(topics, rows)
        self.assertEqual(len(relevant), 1, verdict)
        self.assertTrue(verdict.startswith("accepted:"), verdict)


class BackendDeadlineTests(unittest.TestCase):
    """A hung backend must be abandoned instead of blocking the whole search."""

    def test_returns_value_when_fast_enough(self):
        self.assertEqual(server._run_with_deadline(lambda: 42, 2.0, "fast"), 42)

    def test_abandons_a_hung_backend(self):
        import time

        started = time.monotonic()
        with self.assertRaises(server.BackendTimeout):
            server._run_with_deadline(lambda: time.sleep(5), 0.2, "hung")
        self.assertLess(time.monotonic() - started, 2.0)

    def test_propagates_backend_exceptions(self):
        def boom():
            raise ValueError("bad payload")

        with self.assertRaises(ValueError):
            server._run_with_deadline(boom, 2.0, "boom")

    def test_web_search_is_bounded_even_if_a_backend_hangs(self):
        import time

        def hang(_query, _limit):
            time.sleep(5)
            return []

        with mock.patch.object(server, "SEARCH_BACKENDS", [("google_news_rss", hang)]), \
                mock.patch.object(server, "PRIMARY_DEADLINE_SECONDS", 0.2):
            started = time.monotonic()
            payload = server.web_search("elasticity mechanical keyboards", 5)
            elapsed = time.monotonic() - started

        self.assertLess(elapsed, 3.0)
        self.assertIsNone(payload["backend"])
        self.assertIn("BackendTimeout", payload["attempts"]["google_news_rss"])


class RelevanceFilterTests(unittest.TestCase):
    def test_rejects_fully_irrelevant_payload(self):
        # Bing has served exactly this shape of cloaked junk for a valid query.
        poisoned = [
            {"title": "Oracle VirtualBox", "url": "https://virtualbox.example", "snippet": "Downloads"},
            {"title": "YouTube Music", "url": "https://music.example", "snippet": "Listen now"},
            {"title": "Kalyan Panel Chart", "url": "https://matka.example", "snippet": "Panel results"},
        ]
        relevant, verdict = server._select_relevant(
            server._query_tokens("wireless earbuds market"), poisoned
        )
        self.assertEqual(relevant, [])
        self.assertTrue(verdict.startswith("rejected:"), verdict)

    def test_accepts_on_topic_payload(self):
        rows = [
            {"title": "Wireless earbuds market size 2026", "url": "https://a.example", "snippet": "Market report"},
            {"title": "Best wireless earbuds", "url": "https://b.example", "snippet": "Reviews"},
        ]
        relevant, verdict = server._select_relevant(
            server._query_tokens("wireless earbuds market"), rows
        )
        self.assertEqual(len(relevant), 2)
        self.assertTrue(verdict.startswith("accepted:"), verdict)

    def test_drops_partially_relevant_rows_but_keeps_matches(self):
        rows = [
            {"title": "Wireless earbuds price comparison", "url": "https://a.example", "snippet": ""},
            {"title": "Cricket highlights", "url": "https://b.example", "snippet": ""},
        ]
        relevant, _ = server._select_relevant(
            server._query_tokens("wireless earbuds market"), rows
        )
        self.assertEqual([row["url"] for row in relevant], ["https://a.example"])

    def test_single_token_match_is_not_enough_for_long_query(self):
        rows = [{"title": "Standing - Wikipedia", "url": "https://w.example/standing", "snippet": "Posture"}]
        relevant, _ = server._select_relevant(
            server._query_tokens("standing desk market trends"), rows
        )
        self.assertEqual(relevant, [])

    def test_generic_word_matches_alone_are_not_evidence(self):
        # Observed in a live run: a Forbes housing-market article matched
        # "price", "home" and "market" for a phone-case query and was cited.
        rows = [
            {
                "title": "Housing Market Predictions For 2026: When Will Home Prices Drop?",
                "url": "https://news.example/housing",
                "snippet": "Home prices and the housing market outlook.",
            }
        ]
        relevant, verdict = server._select_relevant(
            server._query_tokens("what is a good price for selling phone cases at home"), rows
        )
        self.assertEqual(relevant, [], verdict)
        self.assertIn("distinctive", verdict)

    def test_distinctive_term_keeps_a_relevant_result(self):
        rows = [
            {
                "title": "How To Make Phone Cases in 2026: A Complete Business Guide",
                "url": "https://news.example/cases",
                "snippet": "A guide to selling phone cases online.",
            }
        ]
        relevant, verdict = server._select_relevant(
            server._query_tokens("what is a good price for selling phone cases at home"), rows
        )
        self.assertEqual(len(relevant), 1, verdict)

    def test_empty_payload_is_reported_as_empty(self):
        relevant, verdict = server._select_relevant(["earbuds"], [])
        self.assertEqual(relevant, [])
        self.assertTrue(verdict.startswith("empty:"), verdict)

    def test_large_payload_needs_two_on_topic_rows(self):
        rows = [
            {"title": "Widget review", "url": f"https://x.example/{i}", "snippet": ""}
            for i in range(8)
        ]
        rows[0]["title"] = "Wireless earbuds market"
        relevant, verdict = server._select_relevant(
            server._query_tokens("wireless earbuds market"), rows
        )
        self.assertEqual(relevant, [])
        self.assertIn("only 1 of 8", verdict)


class ParserTests(unittest.TestCase):
    def test_decode_ddg_href_unwraps_redirect(self):
        wrapped = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage%3Fa%3D1&rut=x"
        self.assertEqual(server._decode_ddg_href(wrapped), "https://example.com/page?a=1")

    def test_decode_ddg_href_passes_through_direct_url(self):
        self.assertEqual(
            server._decode_ddg_href("https://example.com/x"), "https://example.com/x"
        )

    def test_parse_ddg_html_extracts_titles_urls_snippets(self):
        results = server._parse_ddg_html(DDG_HTML_FIXTURE, 5)
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["url"], "https://example.com/market?a=1")
        self.assertEqual(results[0]["title"], "Wireless earbuds market report")
        self.assertEqual(results[0]["snippet"], "Market size and pricing for earbuds.")
        self.assertEqual(results[1]["url"], "https://direct.example.org/page")

    def test_parse_bing_rss_strips_markup(self):
        results = server._parse_bing_rss(BING_RSS_FIXTURE, 5)
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["snippet"], "Market size and earbuds forecast.")
        self.assertEqual(results[0]["url"], "https://example.com/earbuds-market")

    def test_parse_google_news_rss_records_provenance(self):
        results = server._parse_google_news_rss(GOOGLE_NEWS_FIXTURE, 5)
        self.assertEqual(len(results), 2)
        first = results[0]
        self.assertEqual(first["source"], "Mashable")
        self.assertEqual(first["publisher_url"], "https://mashable.com")
        self.assertEqual(first["published"], "2026-10-20T09:01:06+00:00")
        self.assertNotIn("<a", first["snippet"])

    def test_parse_hn_hits_falls_back_to_item_url(self):
        hits = [
            {"title": "Ask HN: earbuds", "objectID": "42", "created_at": "2026-01-02T03:04:05Z"},
            {"title": "Earbuds teardown", "url": "https://example.com/teardown", "objectID": "43"},
            {"objectID": "44"},
        ]
        results = server._parse_hn_hits(hits, 5)
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["url"], "https://news.ycombinator.com/item?id=42")
        self.assertEqual(results[0]["published"], "2026-01-02T03:04:05Z")
        self.assertEqual(results[1]["url"], "https://example.com/teardown")

    def test_parse_library_rows_skips_rows_without_url(self):
        rows = [
            {"title": "A", "href": "https://a.example", "body": "body a"},
            {"title": "B", "href": "", "body": "body b"},
        ]
        results = server._parse_library_rows(rows, 5)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["snippet"], "body a")


def _fake(name, rows, error=None):
    def backend(query, limit):
        if error:
            raise error
        return rows

    backend.__name__ = name
    return (name, backend)


class WebSearchOrchestrationTests(unittest.TestCase):
    def test_falls_through_failures_and_junk_to_first_good_backend(self):
        junk = [{"title": "Oracle VirtualBox", "url": "https://v.example", "snippet": ""}]
        good = [
            {"title": "Wireless earbuds market size", "url": "https://good.example", "snippet": "Report"},
            {"title": "Wireless earbuds pricing", "url": "https://good.example", "snippet": "dupe"},
        ]
        backends = (
            _fake("broken", [], RuntimeError("HTTP 503")),
            _fake("junk", junk),
            _fake("good", good),
        )
        with mock.patch.object(server, "SEARCH_BACKENDS", backends):
            payload = server.web_search("wireless earbuds market", 5)
        self.assertEqual(payload["backend"], "good")
        self.assertEqual(payload["count"], 1)  # duplicate URL collapsed
        self.assertEqual(payload["backends_tried"], ["broken", "junk", "good"])
        self.assertIn("error: RuntimeError", payload["attempts"]["broken"])
        self.assertTrue(payload["attempts"]["junk"].startswith("rejected:"))
        self.assertIsNone(payload["error"])

    def test_all_backends_bad_returns_explicit_error(self):
        backends = (
            _fake("broken", [], RuntimeError("HTTP 503")),
            _fake("junk", [{"title": "Kalyan Panel Chart", "url": "https://m.example", "snippet": ""}]),
        )
        with mock.patch.object(server, "SEARCH_BACKENDS", backends):
            payload = server.web_search("wireless earbuds market", 5)
        self.assertEqual(payload["results"], [])
        self.assertEqual(payload["count"], 0)
        self.assertIsNone(payload["backend"])
        self.assertIn("failed or returned only irrelevant results", payload["error"])

    def test_explicit_backend_selection_is_honoured(self):
        good = [{"title": "Wireless earbuds market", "url": "https://good.example", "snippet": ""}]
        backends = (_fake("first", []), _fake("second", good))
        with mock.patch.object(server, "SEARCH_BACKENDS", backends):
            payload = server.web_search("wireless earbuds market", 5, backend="second")
        self.assertEqual(payload["backend"], "second")
        self.assertEqual(payload["backends_tried"], ["second"])

    def test_max_results_is_capped(self):
        rows = [
            {"title": "Wireless earbuds market", "url": f"https://good.example/{i}", "snippet": ""}
            for i in range(40)
        ]
        with mock.patch.object(server, "SEARCH_BACKENDS", (_fake("good", rows),)):
            payload = server.web_search("wireless earbuds market", 999)
        self.assertEqual(payload["count"], 10)

    def test_short_query_is_rejected(self):
        payload = server.web_search("a", 5)
        self.assertEqual(payload["results"], [])
        self.assertIn("too short", payload["error"])


if __name__ == "__main__":
    unittest.main()
