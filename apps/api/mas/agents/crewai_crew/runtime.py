"""Genuine CrewAI execution.

This module owns the *only* place where MindSpace runs a CrewAI ``Crew``. It
constructs real ``crewai.Agent`` / ``crewai.Task`` objects and calls
``Crew.kickoff()`` — the framework's own orchestration loop executes the tasks.

If no usable model key is configured, execution is refused with
``CrewUnavailable`` rather than silently substituting a plain Python function.
The caller may then use the explicitly-labelled native MCP pipeline.

Patterns are materially different:

* ``sequential`` — one crew, ``Process.sequential``, three dependent tasks.
* ``hierarchical`` — one crew, ``Process.hierarchical``, a manager LLM delegates.
* ``parallel`` — two independent crews run concurrently in worker threads, then a
  third crew consumes both outputs.
"""
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

from mas.config import config

logger = logging.getLogger(__name__)


class CrewUnavailable(RuntimeError):
    """Raised when a real CrewAI run cannot be started."""


@dataclass
class CrewRunResult:
    output: str
    pattern: str
    framework: str = "crewai"
    mode: str = "live"
    tokens_used: int = 0
    tasks_completed: int = 0
    agents: list[str] = field(default_factory=list)
    elapsed_ms: float = 0.0


def crew_available() -> bool:
    """True when a real model key is configured, so CrewAI can actually run."""
    return bool(config.GROQ_CONFIGURED)


def build_llm(model: str | None = None) -> Any:
    """Build a real CrewAI LLM. Raises when no key is configured."""
    if not config.GROQ_CONFIGURED:
        raise CrewUnavailable(
            "GROQ_API_KEY is not configured, so CrewAI cannot run a real model."
        )
    from crewai import LLM

    return LLM(
        model=model or config.GROQ_MODEL_FAST,
        api_key=config.GROQ_API_KEY,
        temperature=0.1,
        timeout=120,
    )


def _agents(llm: Any) -> list[Any]:
    from mas.agents.crewai_crew.agents import (
        create_market_researcher,
        create_pricing_specialist,
        create_product_analyst,
    )

    return [
        create_market_researcher(llm=llm),
        create_product_analyst(llm=llm),
        create_pricing_specialist(llm=llm),
    ]


def _tasks(agents: list[Any], query: str, persona: str, run_id: str) -> list[Any]:
    from mas.agents.crewai_crew.tasks import (
        create_market_research_task,
        create_pricing_task,
        create_product_analysis_task,
    )

    market, product, pricing = agents
    return [
        create_market_research_task(market, query, persona, run_id),
        create_product_analysis_task(product, query, "", run_id),
        create_pricing_task(pricing, query, "", run_id),
    ]


def _usage_tokens(crew: Any) -> int:
    metrics = getattr(crew, "usage_metrics", None)
    return int(getattr(metrics, "total_tokens", 0) or 0)


def _completed(crew: Any) -> int:
    return sum(1 for task in getattr(crew, "tasks", []) if getattr(task, "output", None))


def _finish(crew: Any, result: Any, pattern: str, elapsed: float) -> CrewRunResult:
    output = str(result)
    return CrewRunResult(
        output=output,
        pattern=pattern,
        tokens_used=_usage_tokens(crew),
        tasks_completed=_completed(crew),
        agents=[getattr(agent, "role", "") for agent in getattr(crew, "agents", [])],
        elapsed_ms=round(elapsed, 2),
    )


def run_sequential(query: str, persona: str, run_id: str, llm: Any | None = None) -> CrewRunResult:
    """Run the three research tasks in a single sequential crew."""
    from crewai import Crew, Process

    llm = llm or build_llm()
    agents = _agents(llm)
    tasks = _tasks(agents, query, persona, run_id)
    crew = Crew(agents=agents, tasks=tasks, process=Process.sequential, verbose=False)
    started = time.time()
    result = crew.kickoff()
    return _finish(crew, result, "sequential", (time.time() - started) * 1000)


def run_hierarchical(query: str, persona: str, run_id: str, llm: Any | None = None) -> CrewRunResult:
    """Run the tasks under a manager agent that delegates to the specialists."""
    from crewai import Crew, Process

    llm = llm or build_llm()
    agents = _agents(llm)
    tasks = _tasks(agents, query, persona, run_id)
    crew = Crew(
        agents=agents,
        tasks=tasks,
        process=Process.hierarchical,
        manager_llm=llm,
        verbose=False,
    )
    started = time.time()
    result = crew.kickoff()
    return _finish(crew, result, "hierarchical", (time.time() - started) * 1000)


def run_parallel(query: str, persona: str, run_id: str, llm: Any | None = None) -> CrewRunResult:
    """Run research and product analysis concurrently, then pricing.

    The two first crews are independent, so they really do execute at the same
    time in separate threads. The pricing crew consumes both outputs afterwards.
    """
    from crewai import Crew, Process, Task

    from mas.agents.crewai_crew.agents import (
        create_market_researcher,
        create_pricing_specialist,
        create_product_analyst,
    )
    from mas.agents.crewai_crew.tasks import create_pricing_task

    llm = llm or build_llm()
    started = time.time()

    market_agent = create_market_researcher(llm=llm)
    product_agent = create_product_analyst(llm=llm)

    market_task = Task(
        description=(
            f"Research the e-commerce market for: '{query}'. Persona: {persona}. "
            "Return market size, competitors, sentiment, trends and sources."
        ),
        expected_output="Structured market research with sources.",
        agent=market_agent,
    )
    product_task = Task(
        description=(
            f"Analyse the product category for: '{query}'. Return price range, demand "
            "score, differentiators, weaknesses and a 30-day price trend."
        ),
        expected_output="Structured product analysis.",
        agent=product_agent,
    )

    research_crew = Crew(agents=[market_agent], tasks=[market_task], process=Process.sequential, verbose=False)
    analysis_crew = Crew(agents=[product_agent], tasks=[product_task], process=Process.sequential, verbose=False)

    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="crewai-parallel") as pool:
        research_future = pool.submit(research_crew.kickoff)
        analysis_future = pool.submit(analysis_crew.kickoff)
        research_output = str(research_future.result())
        analysis_output = str(analysis_future.result())

    pricing_agent = create_pricing_specialist(llm=llm)
    pricing_task = create_pricing_task(pricing_agent, query, analysis_output[:800], run_id)
    pricing_crew = Crew(agents=[pricing_agent], tasks=[pricing_task], process=Process.sequential, verbose=False)
    pricing_output = str(pricing_crew.kickoff())

    combined = (
        "## Market research\n" + research_output.strip()
        + "\n\n## Product analysis\n" + analysis_output.strip()
        + "\n\n## Pricing\n" + pricing_output.strip()
    )
    return CrewRunResult(
        output=combined,
        pattern="parallel",
        tokens_used=_usage_tokens(research_crew) + _usage_tokens(analysis_crew) + _usage_tokens(pricing_crew),
        tasks_completed=_completed(research_crew) + _completed(analysis_crew) + _completed(pricing_crew),
        agents=[market_agent.role, product_agent.role, pricing_agent.role],
        elapsed_ms=round((time.time() - started) * 1000, 2),
    )


def run_crew(
    pattern: str, query: str, persona: str, run_id: str, llm: Any | None = None
) -> CrewRunResult:
    """Dispatch to the requested pattern. Unknown patterns fail loudly."""
    runners = {
        "sequential": run_sequential,
        "hierarchical": run_hierarchical,
        "parallel": run_parallel,
    }
    if pattern not in runners:
        raise CrewUnavailable(f"Unknown CrewAI pattern: {pattern}")
    return runners[pattern](query, persona, run_id, llm=llm)
