"""
CrewAI Agent definitions (Requirement #7).

Three agents:
1. MarketResearcher — web search + trend analysis (ReAct pattern)
2. ProductAnalyst — product deep-dive + parallel analysis
3. PricingSpecialist — pricing strategy with forecasting tool

All agents:
- Use Groq LLM via langchain-groq
- Have access to MCP tools
- Write results to the Blackboard
- Are monitored by callbacks
"""
from __future__ import annotations
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)


def _get_groq_llm(model: Optional[str] = None):
    """Create a Groq LLM instance for CrewAI.

    Returns ``None`` when no usable key is configured. Callers then run in
    offline/mock mode and must label their output as simulated.
    """
    from mas.config import config
    if not config.GROQ_CONFIGURED:
        logger.warning(
            "GROQ_API_KEY is not configured or is a placeholder - using mock LLM; "
            "results are simulated."
        )
        return None
    try:
        from langchain_groq import ChatGroq
        return ChatGroq(
            model=model or config.GROQ_MODEL_FAST,
            api_key=config.GROQ_API_KEY,
            temperature=0.1,
            max_tokens=2048,
        )
    except ImportError:
        logger.warning("langchain-groq not installed — using mock LLM")
        return None


def create_market_researcher(llm=None):
    """Creates the Market Researcher CrewAI agent."""
    from crewai import Agent
    from crewai.tools import tool
    from mas.tools.mcp_tools import WEB_SEARCH_TOOL

    @tool("web_search")
    def web_search_tool(query: str) -> str:
        """Search the web for market data, competitor info, and trends."""
        return WEB_SEARCH_TOOL(query)

    llm = llm or _get_groq_llm()
    kwargs = {
        "role": "Senior Market Research Analyst",
        "goal": (
            "Research e-commerce market trends, competitor landscape, and consumer sentiment. "
            "Use web search to gather real data. Identify market size, top competitors, "
            "key trends, and market sentiment."
        ),
        "backstory": (
            "You are a veteran market research analyst with 10+ years in e-commerce intelligence. "
            "You know how to extract actionable insights from raw search data. "
            "You always cite your sources and quantify your findings where possible. "
            "You follow the ReAct pattern: Thought -> Action -> Observation -> Repeat."
        ),
        "tools": [web_search_tool],
        "verbose": True,
        "allow_delegation": False,
        "max_iter": 5,
        "memory": False,
    }
    if llm:
        kwargs["llm"] = llm
    return Agent(**kwargs)


def create_product_analyst(llm=None):
    """Creates the Product Analyst CrewAI agent."""
    from crewai import Agent
    from crewai.tools import tool
    from mas.tools.mcp_tools import WEB_SEARCH_TOOL, FORECASTING_TOOL

    @tool("product_search")
    def product_search_tool(query: str) -> str:
        """Search for specific product information, pricing, and reviews."""
        return WEB_SEARCH_TOOL(f"product pricing reviews {query}")

    @tool("price_forecast")
    def price_forecast_tool(product_name: str) -> str:
        """Generate a statistical price forecast for a product."""
        return FORECASTING_TOOL(product_name)

    llm = llm or _get_groq_llm()
    kwargs = {
        "role": "Product Intelligence Analyst",
        "goal": (
            "Perform deep product analysis including price benchmarking, demand estimation, "
            "competitive positioning, and 30-day price forecasting."
        ),
        "backstory": (
            "You specialize in e-commerce product intelligence. You analyze competitor pricing, "
            "customer reviews, and demand signals to produce actionable product insights. "
            "You use statistical forecasting to predict price movements."
        ),
        "tools": [product_search_tool, price_forecast_tool],
        "verbose": True,
        "allow_delegation": False,
        "max_iter": 5,
        "memory": False,
    }
    if llm:
        kwargs["llm"] = llm
    return Agent(**kwargs)


def create_pricing_specialist(llm=None):
    """Creates the Pricing Strategy Specialist CrewAI agent."""
    from crewai import Agent
    from crewai.tools import tool
    from mas.tools.mcp_tools import FORECASTING_TOOL

    @tool("pricing_forecast")
    def pricing_forecast_tool(product_name: str) -> str:
        """Generate optimal pricing recommendation using statistical forecasting."""
        return FORECASTING_TOOL(product_name)

    llm = llm or _get_groq_llm()
    kwargs = {
        "role": "Pricing Strategy Specialist",
        "goal": (
            "Synthesize market research and product analysis to produce optimal pricing "
            "recommendations with margin estimates and 30-day forecasts."
        ),
        "backstory": (
            "You are an expert in e-commerce pricing strategy with deep knowledge of "
            "price elasticity, competitive dynamics, and revenue optimization. "
            "Your recommendations are always backed by data and forecasting models."
        ),
        "tools": [pricing_forecast_tool],
        "verbose": True,
        "allow_delegation": False,
        "max_iter": 3,
        "memory": False,
    }
    if llm:
        kwargs["llm"] = llm
    return Agent(**kwargs)
