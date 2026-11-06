"""
Agent tool adapters.

1. ``WebSearchMCPTool`` — a thin adapter that calls the **real MCP server**
   (``mas.mcp_service.server``) over the MCP protocol via
   ``mas.mcp_service.client``. It does not import DuckDuckGo itself.
2. ``PriceForecastTool`` — a local deterministic numerical tool. It is *not* an
   MCP tool and is not described as one.

Both are usable directly by the CrewAI/ADK agents.
"""
from __future__ import annotations
import time
import logging
from typing import Any, Dict, List, Optional
import numpy as np

from mas.mcp_service.client import MCPToolResult, call_tool_sync

logger = logging.getLogger(__name__)


# ─── Tool 1: Web search over MCP ─────────────────────────────────────────────

class WebSearchMCPTool:
    """
    MCP-backed web search.

    The search itself runs inside the MCP server process and is invoked through
    the MCP protocol (``tools/call`` → ``web_search``). Transport failures are
    reported, never silently replaced with fabricated results.
    """
    name: str = "web_search"
    description: str = (
        "Search the web for real-time information about e-commerce products, "
        "market trends, competitor pricing, and industry news. "
        "Input: search query string. Output: list of results with title, url, snippet."
    )

    def run(self, query: str, max_results: int = 5) -> Dict[str, Any]:
        """Call the MCP `web_search` tool and return structured results."""
        from mas.monitoring.observability import get_tracer

        start = time.time()
        logger.info(f"[WebSearchMCPTool] MCP call: {query!r}")

        tracer = get_tracer()
        with tracer.span(
            "tool.web_search",
            {"tool": "web_search", "query": query, "max_results": max_results},
        ) as span:
            result: MCPToolResult = call_tool_sync(
                "web_search", {"query": query, "max_results": max_results}, timeout_seconds=75
            )

            results: List[Dict[str, Any]] = []
            error: Optional[str] = None
            backend: Optional[str] = None
            backends_tried: List[str] = []
            if not result.ok:
                error = result.error or "MCP web_search failed."
                logger.error("[WebSearchMCPTool] %s", error)
            else:
                payload = result.data if isinstance(result.data, dict) else {}
                backend = payload.get("backend")
                backends_tried = [str(name) for name in payload.get("backends_tried", []) or []]
                for row in payload.get("results", []) or []:
                    normalized: Dict[str, Any] = {
                        "title": str(row.get("title", "")),
                        "url": str(row.get("url", row.get("href", ""))),
                        "snippet": str(row.get("snippet", row.get("body", ""))),
                    }
                    # Preserve provenance fields the search backend reported.
                    for key in ("published", "source", "publisher_url"):
                        if row.get(key):
                            normalized[key] = str(row[key])
                    results.append(normalized)
                logger.info(
                    "[WebSearchMCPTool] Found %s results via %s",
                    len(results),
                    backend or "unknown",
                )

            elapsed = (time.time() - start) * 1000
            if span is not None:
                try:
                    span.set_attribute("result_count", len(results))
                    span.set_attribute("backend", backend or "none")
                    span.set_attribute("ok", error is None)
                except Exception:
                    pass

        return {
            "query": query,
            "results": results,
            "total_results": len(results),
            "search_time_ms": round(elapsed, 2),
            "error": error,
            "backend": backend,
            "backends_tried": backends_tried,
            "transport": "mcp/stdio",
        }

    # CrewAI tool interface
    def __call__(self, query: str) -> str:
        result = self.run(query)
        if result["error"]:
            raise RuntimeError(result["error"])
        if not result["results"]:
            raise RuntimeError("Live search completed with no results.")

        output_lines = [f"Web Search Results for: '{result['query']}'\n"]
        for i, r in enumerate(result["results"], 1):
            output_lines.append(f"{i}. **{r['title']}**")
            output_lines.append(f"   URL: {r['url']}")
            if r.get("source") or r.get("published"):
                provenance = " / ".join(
                    part for part in (r.get("source"), r.get("published")) if part
                )
                output_lines.append(f"   Source: {provenance}")
            output_lines.append(f"   {r['snippet']}\n")
        return "\n".join(output_lines)


# ─── Tool 2: Local price forecast (not MCP) ──────────────────────────────────

class PriceForecastTool:
    """
    Local deterministic price forecast using numpy/scipy.
    Uses exponential smoothing + linear regression for a 30-day forecast.
    This is a local numerical tool, NOT an MCP tool.
    """
    name: str = "price_forecast"
    description: str = (
        "Forecast product prices for the next 30 days using statistical ML. "
        "Input: product name and list of historical prices (at least 7 data points). "
        "Output: 30-day price forecast, trend direction, confidence, and recommended price."
    )

    def run(self, product_name: str,
            historical_prices: Optional[List[float]] = None) -> Dict[str, Any]:
        """Generate a 30-day price forecast."""
        logger.info(f"[PriceForecastTool] Forecasting for: {product_name}")

        if not historical_prices or len(historical_prices) < 3:
            raise ValueError("At least three observed historical prices are required.")

        prices = np.array(historical_prices, dtype=float)
        n = len(prices)
        t = np.arange(n)

        # ── Linear trend component ──
        coeffs = np.polyfit(t, prices, 1)
        slope = coeffs[0]
        intercept = coeffs[1]

        # ── Exponential smoothing ──
        alpha = 0.3  # smoothing factor
        smoothed = [prices[0]]
        for i in range(1, n):
            smoothed.append(alpha * prices[i] + (1 - alpha) * smoothed[-1])
        last_smoothed = smoothed[-1]

        # ── 30-day forecast ──
        # Deliberately no random jitter: this tool is documented as deterministic
        # and its output is presented as a forecast, so injecting noise "for
        # realism" would be fabricating variance. Uncertainty is reported
        # explicitly instead, as a band derived from the in-sample residuals.
        forecast = []
        for i in range(1, 31):
            trend_component = slope * (n + i) + intercept
            smoothing_component = last_smoothed * (1 + slope / (prices.mean() + 1e-9))
            predicted = 0.5 * trend_component + 0.5 * smoothing_component
            forecast.append(round(max(0.01, predicted), 2))

        # ── Metrics ──
        predicted_in_sample = np.array([slope * i + intercept for i in t])
        residuals = prices - predicted_in_sample
        mae = float(np.mean(np.abs(residuals)))
        residual_std = float(np.std(residuals, ddof=1)) if n > 1 else 0.0

        trend = "stable"
        if slope > prices.mean() * 0.01:
            trend = "upward"
        elif slope < -prices.mean() * 0.01:
            trend = "downward"

        # Confidence based on R^2
        ss_res = np.sum((prices - predicted_in_sample) ** 2)
        ss_tot = np.sum((prices - prices.mean()) ** 2)
        r2 = 1 - ss_res / (ss_tot + 1e-9)
        confidence = float(np.clip(r2, 0.1, 0.99))

        recommended_price = round(float(np.mean(forecast[:7])), 2)  # 7-day avg

        result = {
            "product_name": product_name,
            "historical_prices": [round(float(p), 2) for p in prices],
            "forecast_30d": forecast,
            # Deterministic ±1.96σ band from in-sample residuals. This is the
            # honest replacement for the randomness that used to be added to the
            # point forecast.
            "forecast_30d_lower": [
                round(max(0.01, value - 1.96 * residual_std), 2) for value in forecast
            ],
            "forecast_30d_upper": [
                round(value + 1.96 * residual_std, 2) for value in forecast
            ],
            "residual_std": round(residual_std, 3),
            "trend": trend,
            "confidence": round(confidence, 3),
            "mae": round(mae, 3),
            "recommended_price": recommended_price,
        }
        logger.info(f"[PriceForecastTool] Trend={trend} confidence={confidence:.2f} "
                    f"recommended=${recommended_price}")
        return result

    def __call__(self, product_name: str, historical_prices: str = "") -> str:
        """CrewAI tool interface — accepts string input."""
        prices = []
        if historical_prices:
            try:
                prices = [float(x.strip()) for x in historical_prices.split(",") if x.strip()]
            except ValueError:
                pass
        result = self.run(product_name, prices or None)
        return (
            f"Price Forecast for '{result['product_name']}':\n"
            f"- Trend: {result['trend'].upper()}\n"
            f"- Confidence: {result['confidence']:.0%}\n"
            f"- Recommended Price: ${result['recommended_price']:.2f}\n"
            f"- 7-Day Forecast: {result['forecast_30d'][:7]}\n"
            f"- 30-Day Forecast (first 5): {result['forecast_30d'][:5]}\n"
            f"- MAE: ${result['mae']:.2f}\n"
        )


# ─── Tool registry ─────────────────────────────────────────────────────────────

WEB_SEARCH_TOOL = WebSearchMCPTool()
FORECASTING_TOOL = PriceForecastTool()
