import unittest
from unittest.mock import patch

from mas.mcp_service.client import MCPToolResult
from mas.tools.mcp_tools import PriceForecastTool, WebSearchMCPTool


def mcp_ok(payload):
    return MCPToolResult(tool="web_search", ok=True, data=payload, text="")


def mcp_fail(message):
    return MCPToolResult(tool="web_search", ok=False, error=message)


class WebSearchMCPAdapterTests(unittest.TestCase):
    """The adapter must go through the MCP client, not a direct DDG import."""

    def test_run_calls_mcp_web_search_tool(self):
        payload = {
            "results": [
                {"title": "Observed result", "url": "https://news.example.org/result", "snippet": "Source text"}
            ]
        }
        with patch("mas.tools.mcp_tools.call_tool_sync", return_value=mcp_ok(payload)) as call:
            result = WebSearchMCPTool().run("test query", max_results=3)

        call.assert_called_once()
        args, kwargs = call.call_args
        self.assertEqual(args[0], "web_search")
        self.assertEqual(args[1], {"query": "test query", "max_results": 3})
        self.assertEqual(
            result["results"],
            [{"title": "Observed result", "url": "https://news.example.org/result", "snippet": "Source text"}],
        )
        self.assertEqual(result["total_results"], 1)
        self.assertIsNone(result["error"])
        self.assertEqual(result["transport"], "mcp/stdio")

    def test_run_normalises_href_and_body_keys(self):
        payload = {"results": [{"title": "t", "href": "https://a.example/x", "body": "b"}]}
        with patch("mas.tools.mcp_tools.call_tool_sync", return_value=mcp_ok(payload)):
            result = WebSearchMCPTool().run("q")
        self.assertEqual(result["results"][0]["url"], "https://a.example/x")
        self.assertEqual(result["results"][0]["snippet"], "b")

    def test_successful_empty_search_is_not_an_error(self):
        with patch("mas.tools.mcp_tools.call_tool_sync", return_value=mcp_ok({"results": []})):
            result = WebSearchMCPTool().run("no hits")
        self.assertEqual(result["results"], [])
        self.assertEqual(result["total_results"], 0)
        self.assertIsNone(result["error"])

    def test_transport_failure_fails_closed(self):
        with patch(
            "mas.tools.mcp_tools.call_tool_sync",
            return_value=mcp_fail("MCP transport error: FileNotFoundError: server missing"),
        ):
            result = WebSearchMCPTool().run("test query")
        self.assertEqual(result["results"], [])
        self.assertIn("MCP transport error", result["error"])
        self.assertNotIn("example.com", str(result["results"]))

    def test_tool_reported_error_fails_closed(self):
        with patch(
            "mas.tools.mcp_tools.call_tool_sync",
            return_value=mcp_fail("Search failed: TimeoutError: search timed out"),
        ):
            result = WebSearchMCPTool().run("test query")
        self.assertEqual(result["results"], [])
        self.assertIn("TimeoutError", result["error"])

    def test_tool_interface_raises_for_empty_search(self):
        with patch.object(
            WebSearchMCPTool,
            "run",
            return_value={"query": "test", "results": [], "error": None},
        ):
            with self.assertRaisesRegex(RuntimeError, "no results"):
                WebSearchMCPTool()("test")


class PriceForecastTests(unittest.TestCase):
    def test_forecast_requires_observed_prices(self):
        with self.assertRaisesRegex(ValueError, "observed historical prices"):
            PriceForecastTool().run("sample product")

    def test_forecast_is_deterministic_in_shape(self):
        result = PriceForecastTool().run("widget", [10.0, 10.5, 11.0, 11.4, 11.9])
        self.assertEqual(len(result["forecast_30d"]), 30)
        self.assertIn(result["trend"], {"upward", "downward", "stable"})
        self.assertGreater(result["confidence"], 0)

    def test_forecast_is_bit_for_bit_repeatable(self):
        """Same inputs must give the same numbers: no random noise in the output."""
        prices = [10.0, 10.5, 11.0, 11.4, 11.9, 12.2, 12.6]
        first = PriceForecastTool().run("widget", prices)
        second = PriceForecastTool().run("widget", prices)
        self.assertEqual(first, second)

    def test_forecast_publishes_an_uncertainty_band_instead_of_noise(self):
        result = PriceForecastTool().run("widget", [10.0, 10.5, 11.0, 11.4, 11.9])
        self.assertGreater(result["residual_std"], 0)
        for point, low, high in zip(
            result["forecast_30d"], result["forecast_30d_lower"], result["forecast_30d_upper"]
        ):
            self.assertLessEqual(low, point)
            self.assertLessEqual(point, high)


if __name__ == "__main__":
    unittest.main()
