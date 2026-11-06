"""
CrewAI Task definitions.

Tasks are wired to agents and include:
- Detailed descriptions with context from the Blackboard
- Expected outputs that map to Pydantic schemas
- Callback hooks for monitoring
"""
from __future__ import annotations
import logging
from typing import Any

logger = logging.getLogger(__name__)


def create_market_research_task(agent: Any, query: str, persona: str,
                                 run_id: str) -> Any:
    """Task for the Market Research agent."""
    from crewai import Task
    return Task(
        description=f"""Research the e-commerce market for: '{query}'
        
        Persona context: {persona}
        Run ID: {run_id}
        
        Your task:
        1. Search the web for market size, trends, and competition
        2. Identify top 3-5 competitors and their positioning
        3. Assess market sentiment (positive/neutral/negative)
        4. List 3-5 key market trends
        5. Note your sources
        
        Use the ReAct pattern: Thought -> Search -> Observation -> Conclusion
        """,
        expected_output="""A comprehensive market research summary with:
        - Market size estimate (qualitative or quantitative)
        - List of top competitors
        - Market sentiment assessment
        - 3-5 key trends
        - Source citations
        Format as structured text with clear sections.""",
        agent=agent,
    )


def create_product_analysis_task(agent: Any, query: str, market_context: str,
                                  run_id: str) -> Any:
    """Task for the Product Analyst agent."""
    from crewai import Task
    return Task(
        description=f"""Perform deep product analysis for: '{query}'
        
        Market context from research: {market_context[:500] if market_context else 'Not available yet'}
        Run ID: {run_id}
        
        Your task:
        1. Identify the specific product category
        2. Find current price range in the market ($min - $max)
        3. Estimate demand score (1-10) based on trends
        4. List unique selling points vs competitors  
        5. Generate a 30-day price forecast
        6. Identify product weaknesses to address
        """,
        expected_output="""A detailed product analysis with:
        - Product name and category
        - Price range (min/max/average)
        - Demand score out of 10
        - Top 3 unique selling points
        - Top 2 weaknesses
        - Price trend direction (upward/downward/stable)
        Format as structured text.""",
        agent=agent,
    )


def create_pricing_task(agent: Any, query: str, product_context: str,
                         run_id: str) -> Any:
    """Task for the Pricing Specialist agent."""
    from crewai import Task
    return Task(
        description=f"""Generate optimal pricing recommendation for: '{query}'
        
        Product analysis context: {product_context[:500] if product_context else 'Not available yet'}
        Run ID: {run_id}
        
        Your task:
        1. Generate a 30-day price forecast
        2. Recommend an optimal price point
        3. Set price floor (break-even) and ceiling (premium)
        4. Estimate gross margin percentage
        5. Provide clear pricing rationale
        """,
        expected_output="""A pricing recommendation with:
        - Recommended price ($)
        - Price floor ($) and ceiling ($)
        - Estimated margin (%)
        - 30-day price forecast (trend)
        - Brief rationale (2-3 sentences)
        Format as structured text.""",
        agent=agent,
    )
