"""
ADK Pricing Optimizer Agent.

Uses ML forecasting to refine pricing recommendations.
Reads market + product data from Blackboard, writes refined pricing back.
"""
from __future__ import annotations
import logging
from typing import Any, Optional

from mas.tools.mcp_tools import FORECASTING_TOOL
from mas.models.schemas import PricingOutput

logger = logging.getLogger(__name__)


class ADKPricingAgent:
    """ADK-style pricing optimizer agent."""

    def __init__(self, blackboard: Any, callback_manager: Any):
        self.blackboard = blackboard
        self.cb = callback_manager

    def run(self, query: str, run_id: str) -> Optional[PricingOutput]:
        """Read context from Blackboard and generate ML-based pricing."""
        self.cb.on_agent_start("adk_pricing_agent", query)

        # Extract product name from query
        words = query.split()
        product_name = " ".join(words[:5]) if len(words) > 3 else query

        # Read product analysis from blackboard for context
        product_analysis = self.blackboard.read("product_analysis", run_id) or ""
        self.cb.on_blackboard_read("product_analysis", "adk_pricing_agent")

        # Extract price hints from the product analysis text
        import re
        price_matches = re.findall(r'\$([\d.]+)', product_analysis)
        historical_prices = []
        for pm in price_matches[:10]:
            try:
                historical_prices.append(float(pm))
            except ValueError:
                pass

        # Run forecasting tool
        tool_start = self.cb.on_tool_start("adk_pricing_agent", "price_forecast", product_name)
        forecast_result = FORECASTING_TOOL.run(product_name, historical_prices or None)
        self.cb.on_tool_end("adk_pricing_agent", "price_forecast",
                             str(forecast_result)[:200], tool_start)

        # Determine price floor and ceiling
        rec_price = forecast_result["recommended_price"]
        price_floor = round(rec_price * 0.75, 2)   # 75% of recommended
        price_ceiling = round(rec_price * 1.35, 2)  # 135% of recommended
        margin_pct = 35.0  # estimated standard e-commerce margin

        pricing = PricingOutput(
            product_name=product_name,
            current_market_price=round(rec_price * 1.05, 2),
            recommended_price=rec_price,
            price_floor=price_floor,
            price_ceiling=price_ceiling,
            margin_estimate_pct=margin_pct,
            forecast_30d=forecast_result["forecast_30d"],
            pricing_rationale=(
                f"Based on {forecast_result['trend']} trend analysis with "
                f"{forecast_result['confidence']:.0%} confidence. "
                f"Statistical forecasting using 30-day exponential smoothing. "
                f"MAE: ${forecast_result['mae']:.2f}."
            ),
        )

        self.cb.on_agent_end("adk_pricing_agent",
                              f"Recommended: ${rec_price}", tokens=80)
        logger.info(f"[ADKPricingAgent] Recommended ${rec_price} "
                    f"trend={forecast_result['trend']}")
        return pricing
