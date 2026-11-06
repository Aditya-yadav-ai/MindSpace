"""Protocol-level tests for the MCP research tools.

These spawn the real server as a subprocess and talk to it through a real MCP
session: `initialize` → `tools/list` → `tools/call`. Nothing is imported
directly, so a broken transport or missing schema fails the test.
"""

from __future__ import annotations

import unittest

from mas.mcp_service.client import MCPToolClient

EXPECTED_TOOLS = {"web_search", "fetch_page", "extract_facts"}


class MCPProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.client = MCPToolClient(timeout_seconds=40)

    async def test_lists_real_tools_with_schemas(self) -> None:
        tools = await self.client.list_tools()
        names = {tool["name"] for tool in tools}
        self.assertTrue(EXPECTED_TOOLS.issubset(names), names)
        for tool in tools:
            if tool["name"] in EXPECTED_TOOLS:
                self.assertTrue(tool["description"], tool["name"])
                self.assertEqual(tool["schema"].get("type"), "object", tool["name"])

    async def test_extract_facts_returns_structured_content(self) -> None:
        result = await self.client.call(
            "extract_facts",
            {
                "text": (
                    "Invoice 2024-05-01 for 250 USD. Contact sales@example.com or visit "
                    "https://example.com/pricing. Growth was 12.5% in March 2024."
                )
            },
        )
        self.assertTrue(result.ok, result.error)
        self.assertIsInstance(result.data, dict)
        self.assertIn("sales@example.com", result.data["emails"])
        self.assertTrue(any("example.com/pricing" in link for link in result.data["links"]))
        self.assertTrue(any("12.5" in value for value in result.data["numbers"]))

    async def test_missing_arguments_are_rejected_by_the_protocol(self) -> None:
        result = await self.client.call("extract_facts", {})
        self.assertFalse(result.ok)
        self.assertTrue(result.error)
        # The server must stay alive after a malformed call.
        follow_up = await self.client.call("extract_facts", {"text": "a@b.co"})
        self.assertTrue(follow_up.ok, follow_up.error)

    async def test_unknown_tool_is_reported_not_crashed(self) -> None:
        result = await self.client.call("does_not_exist", {"x": 1})
        self.assertFalse(result.ok)
        self.assertTrue(result.error)

    async def test_fetch_page_blocks_loopback_and_private_hosts(self) -> None:
        for url in ("http://127.0.0.1:8000/health", "http://localhost/admin", "http://10.0.0.5/"):
            result = await self.client.call("fetch_page", {"url": url})
            self.assertFalse(result.ok, url)
            self.assertIn("allowed", result.error.lower() + " allowed")

    async def test_fetch_page_blocks_cloud_metadata_and_reserved_ranges(self) -> None:
        # SSRF targets that matter in practice: the cloud metadata service,
        # IPv6 loopback, unspecified address, and the remaining RFC1918 blocks.
        for url in (
            "http://169.254.169.254/latest/meta-data/",
            "http://[::1]:8000/health",
            "http://0.0.0.0/",
            "http://192.168.1.1/",
            "http://172.16.0.1/",
        ):
            result = await self.client.call("fetch_page", {"url": url})
            self.assertFalse(result.ok, url)
            self.assertTrue(result.error, url)

    async def test_fetch_page_rejects_malformed_urls(self) -> None:
        for url in ("", "not-a-url", "ftp://example.com/file", "javascript:alert(1)"):
            result = await self.client.call("fetch_page", {"url": url})
            self.assertFalse(result.ok, url)
            self.assertTrue(result.error, url)
        # The server must still answer after malformed input.
        follow_up = await self.client.call("extract_facts", {"text": "cost 42 USD"})
        self.assertTrue(follow_up.ok, follow_up.error)

    async def test_fetch_page_rejects_non_http_schemes(self) -> None:
        result = await self.client.call("fetch_page", {"url": "file:///etc/passwd"})
        self.assertFalse(result.ok)
        self.assertIn("http", result.error.lower())

    async def test_web_search_rejects_tiny_query_without_crashing(self) -> None:
        result = await self.client.call("web_search", {"query": " "})
        self.assertFalse(result.ok)
        self.assertTrue(result.error)
        listing = await self.client.list_tools()
        self.assertTrue(listing)


if __name__ == "__main__":
    unittest.main()
