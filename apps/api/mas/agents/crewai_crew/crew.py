"""
Native research workflow used when CrewAI is unavailable.
"""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Dict

from pydantic import ValidationError

from mas.models.schemas import WebSearchResult

logger = logging.getLogger(__name__)


class ResearchUnavailableError(RuntimeError):
    """Raised when live search cannot provide evidence for a research run."""


SEARCH_STOPWORDS = frozenset(
    """
    a about after all also am an and any are as at be been being between both but by
    can could did do does doing done for from had has have having he her here hers him
    his how i if in into is it its just me more most my no nor not now of off on once
    only or other our out over own same she should so some such than that the their them
    then there these they this those through to too under until up very was we were what
    whats when where which while who whom why will with without would you your yours
    good best better great make makes making want needs need tell show give
    optimal absolutely dominate worth provide undercut immediately
    losing lose lost range model analyse analyze right today currently soon
    """.split()
)


def _search_terms(query: str, limit: int = 4) -> str:
    """Reduce a request to the product phrase that search engines can match.

    News search matches entities, not questions. "Model the price elasticity of
    demand for mechanical keyboards at $50-$200 range" reduces to "elasticity
    mechanical keyboards"; "what's a good price for selling phone cases I make at
    home" reduces to "phone cases". Analysis framing, request verbs, generic
    commerce words and numeric noise are dropped so the query carries only the
    thing being researched.
    """
    from mas.mcp_service.server import GENERIC_QUERY_TOKENS

    # Toxicity filtering replaces abusive words with a literal marker; the
    # marker is not a search term and would otherwise dominate the query.
    query = query.replace("[FILTERED]", " ")

    tokens: list[str] = []
    seen: set[str] = set()
    for token in re.findall(r"[a-z0-9]+", query.lower()):
        # Numeric and alphanumeric tokens (prices, years, "q4") add noise.
        if len(token) < 3 or not token.isalpha():
            continue
        if token in SEARCH_STOPWORDS or token in GENERIC_QUERY_TOKENS or token in seen:
            continue
        seen.add(token)
        tokens.append(token)
        if len(tokens) >= limit:
            break
    return " ".join(tokens) if tokens else " ".join(query.split())


def _execute_query(
    tool: Any,
    search_query: str,
    merged: list[dict[str, Any]],
    seen_urls: set[str],
    backends: list[str],
    errors: list[str],
    issued: list[str],
) -> None:
    """Run one MCP search and merge its results into the accumulator."""
    from mas.models.schemas import WebSearchResult

    issued.append(search_query)
    search_result = tool.run(search_query, max_results=5)
    try:
        validated_result = WebSearchResult.model_validate(search_result)
    except ValidationError as error:
        raise ResearchUnavailableError(
            f"Malformed live search response: {error}"
        ) from error
    if validated_result.error:
        errors.append(f"{search_query}: {validated_result.error}")
        return
    if validated_result.backend and validated_result.backend not in backends:
        backends.append(validated_result.backend)
    for row in validated_result.results:
        url = str(row.get("url", ""))
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        merged.append(row)


def _native_market_research(
    query: str, persona: str, pattern: str = "sequential"
) -> str:
    """Return live search evidence as JSON without adding unsupported claims.

    The four architectures are *genuinely different control flows* even when no
    model is available, so an offline comparison measures architecture rather
    than four labels over one code path:

    ``sequential``
        Issue the product phrase; widen with a price query only if the first
        result set is thin. Strictly serial.
    ``parallel``
        Issue both queries concurrently in worker threads, then merge. More
        requests in flight, so it wins when widening is needed and loses when a
        single query would have sufficed.
    ``react``
        Thought → Action → Observation loop: search, observe how many distinct
        sources came back, and refine the query up to three times until the
        evidence is sufficient.
    ``hierarchical``
        A planner step picks the single most specific query and a worker runs
        it; if evidence is thin the planner delegates a second query to another
        worker. Two agent roles, two steps.
    """
    from concurrent.futures import ThreadPoolExecutor

    from mas.tools.mcp_tools import WebSearchMCPTool

    tool = WebSearchMCPTool()
    terms = _search_terms(query)
    price_query = f"{terms} price"

    merged: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    backends: list[str] = []
    errors: list[str] = []
    issued: list[str] = []
    details: dict[str, Any] = {"strategy": pattern}

    if pattern == "parallel":
        # Both queries at once; the early-exit optimisation is intentionally
        # absent because a parallel pattern's whole point is concurrency.
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [
                pool.submit(
                    _execute_query, tool, search_query, merged, seen_urls,
                    backends, errors, issued,
                )
                for search_query in (terms, price_query)
            ]
            for future in futures:
                future.result()
        details["concurrency"] = 2

    elif pattern == "react":
        # Observe → decide → act. Refine only while evidence is insufficient.
        refinements = [terms, price_query, f"{terms} market"]
        observations: list[int] = []
        for attempt, search_query in enumerate(refinements, start=1):
            _execute_query(
                tool, search_query, merged, seen_urls, backends, errors, issued
            )
            observations.append(len({row.get("url") for row in merged}))
            if len(merged) >= 3 or attempt == len(refinements):
                break
        details["iterations"] = len(issued)
        details["observations"] = observations

    elif pattern == "hierarchical":
        # Planner chooses the most specific single query first.
        manager_cues = ("price", "pricing", "cost", "margin", "undercut")
        primary = price_query if any(c in query.lower() for c in manager_cues) else terms
        secondary = terms if primary == price_query else price_query
        plan = [primary]
        _execute_query(tool, primary, merged, seen_urls, backends, errors, issued)
        delegations = 0
        if len(merged) < 3:
            plan.append(secondary)
            delegations = 1
            _execute_query(
                tool, secondary, merged, seen_urls, backends, errors, issued
            )
        details["plan"] = plan
        details["delegations"] = delegations

    else:  # sequential (default)
        for search_query in (terms, price_query):
            # One strong query is enough evidence; the second widens coverage
            # only when the first is thin.
            if len(merged) >= 5:
                break
            _execute_query(
                tool, search_query, merged, seen_urls, backends, errors, issued
            )

    # De-duplicate defensively. In parallel mode the two searches merge
    # concurrently, so the check-then-add on ``seen_urls`` is not atomic; the
    # same URL could be appended twice. ``source_count`` is set-based downstream,
    # but a duplicated URL in the report's source list would still be wrong.
    if merged:
        deduped: list[dict[str, Any]] = []
        deduped_urls: set[str] = set()
        for row in merged:
            url = str(row.get("url", ""))
            if not url or url in deduped_urls:
                continue
            deduped_urls.add(url)
            deduped.append(row)
        merged = deduped

    if not merged:
        detail = "; ".join(errors[:3]) or "no results"
        raise ResearchUnavailableError(f"Live search completed with no results ({detail}).")

    return json.dumps(
        {
            "query": query,
            "queries_issued": issued,
            "backends": backends,
            "results": merged[:10],
            **details,
        },
        ensure_ascii=False,
    )


class EcommerceResearchCrew:
    """Run the evidence-backed research stage and retain the legacy entry points."""

    def __init__(
        self,
        blackboard: Any,
        callback_manager: Any,
        audit_trail: Any,
        tracer: Any,
    ):
        self.blackboard = blackboard
        self.cb = callback_manager
        self.audit = audit_trail
        self.tracer = tracer

    def _run_crewai(
        self, query: str, persona: str, run_id: str, pattern: str
    ) -> Any:
        """Run a real CrewAI crew. Returns None when CrewAI cannot run."""
        from mas.agents.crewai_crew.runtime import (
            CrewUnavailable,
            crew_available,
            run_crew,
        )

        if not crew_available():
            self.audit.record(
                "market_researcher",
                "crewai_unavailable",
                {"reason": "no usable model key"},
                rationale="CrewAI requires a live model; native MCP evidence path will be used",
            )
            return None
        try:
            self.cb.on_agent_start("crewai_crew", query)
            # With a live model, CrewAI has no separate "react" process; the
            # sequential crew is the closest supported pattern. The genuine
            # react control flow lives in the native evidence path, which is
            # what runs when no model is available.
            effective_pattern = "sequential" if pattern == "react" else pattern
            result = run_crew(effective_pattern, query, persona, run_id)
        except CrewUnavailable as error:
            logger.warning("[Crew] CrewAI unavailable: %s", error)
            self.audit.record(
                "crewai_crew", "crewai_failed", {"error": str(error)},
                rationale="CrewAI could not start; falling back to native MCP evidence",
            )
            return None
        except Exception as error:  # noqa: BLE001 - reported, not hidden
            logger.exception("[Crew] CrewAI execution failed")
            self.cb.on_error("crewai_crew", f"{type(error).__name__}: {error}")
            self.audit.record(
                "crewai_crew", "crewai_error",
                {"error": f"{type(error).__name__}: {error}"},
                rationale="CrewAI raised during kickoff",
            )
            return None

        self.cb.on_agent_end("crewai_crew", result.output, tokens=result.tokens_used)
        self.audit.record(
            "crewai_crew",
            "crewai_complete",
            {
                "pattern": result.pattern,
                "tasks_completed": result.tasks_completed,
                "agents": result.agents,
                "tokens": result.tokens_used,
                "elapsed_ms": result.elapsed_ms,
            },
            output_key="market_research",
            rationale="Real CrewAI kickoff completed",
        )
        return result

    def _run_research(
        self, query: str, persona: str, run_id: str, pattern: str
    ) -> Dict[str, Any]:
        # Consume the addressed task_request sent by the orchestrator over P2P.
        # Delivery is real: the message is claimed from the mailbox and removed
        # from the pending set. A direct invocation (no request) is recorded as
        # such instead of inventing one.
        task_request = self._consume_task_request(run_id)
        result = self._run_research_stage(query, persona, run_id, pattern)
        result["p2p_task_received"] = task_request is not None
        result["p2p_result_sent"] = (
            self._send_task_result(task_request, run_id, result)
            if task_request is not None
            else False
        )
        return result

    # ── P2P coordination ─────────────────────────────────────────────────────

    def _mailbox(self) -> Any:
        return getattr(self.blackboard, "mailbox", None)

    def _consume_task_request(self, run_id: str) -> Any:
        """Claim this run's task_request message, if one was sent."""
        mailbox = self._mailbox()
        if mailbox is None:
            return None
        from mas.messaging.p2p import P2PError

        mailbox.register_peer("crewai_crew")
        try:
            messages = mailbox.receive(
                "crewai_crew", msg_type="task_request", correlation_id=run_id
            )
        except P2PError as error:
            self.audit.record(
                "crewai_crew",
                "p2p_receive_failed",
                {"error": f"{type(error).__name__}: {error}"},
                rationale="P2P task request could not be claimed",
            )
            return None

        if not messages:
            self.audit.record(
                "crewai_crew",
                "p2p_no_task_request",
                {"run_id": run_id},
                rationale="Crew invoked directly; no P2P task request was pending",
            )
            return None

        message = messages[0]
        self.audit.record(
            "crewai_crew",
            "p2p_task_received",
            {
                "msg_id": message.msg_id,
                "from": message.sender,
                "correlation_id": message.correlation_id,
            },
            input_keys=["user_query"],
            rationale="Consumed addressed task_request from the P2P mailbox",
        )
        return message

    def _send_task_result(self, request: Any, run_id: str, result: Dict[str, Any]) -> bool:
        """Reply to the task_request sender with a correlated task_result."""
        mailbox = self._mailbox()
        if mailbox is None or request is None:
            return False
        from mas.messaging.p2p import P2PError

        payload = {
            "run_id": run_id,
            "status": result.get("status"),
            "framework": result.get("framework"),
            "errors": list(result.get("errors") or []),
            "tokens_used": int(result.get("tokens_used", 0) or 0),
            "elapsed_ms": float(result.get("elapsed_ms", 0.0) or 0.0),
            "tasks_completed": int(result.get("tasks_completed", 0) or 0),
            "has_market_research": result.get("market_research") is not None,
        }
        try:
            mailbox.register_peer("adk_orchestrator")
            message = mailbox.send(
                sender="crewai_crew",
                recipient=request.sender,
                content=payload,
                msg_type="task_result",
                correlation_id=run_id,
            )
        except P2PError as error:
            self.audit.record(
                "crewai_crew",
                "p2p_result_failed",
                {"error": f"{type(error).__name__}: {error}"},
                rationale="task_result could not be delivered over P2P",
            )
            return False

        self.audit.record(
            "crewai_crew",
            "p2p_result_sent",
            {"msg_id": message.msg_id, "to": message.recipient, "run_id": run_id},
            output_key="p2p_task_result",
            rationale="Delivered correlated task_result to the orchestrator mailbox",
        )
        return True

    def _run_research_stage(
        self, query: str, persona: str, run_id: str, pattern: str
    ) -> Dict[str, Any]:
        start = time.time()
        with self.tracer.span(
            "market_research", {"agent": "market_researcher", "run_id": run_id}
        ):
            self.cb.on_agent_start("market_researcher", query)
            self.audit.record(
                "market_researcher",
                "start_research",
                {"query": query, "persona": persona},
                output_key="market_research",
            )

            # Preferred path: the real CrewAI crew executes the workflow.
            crew_result = self._run_crewai(query, persona, run_id, pattern)
            if crew_result is not None:
                # The crew's narrative output is stored separately: the report
                # layer requires machine-checkable search evidence, which is
                # collected through the MCP tool below.
                self.blackboard.write(
                    "crewai_output", crew_result.output, "crewai_crew", run_id
                )
                self.cb.on_blackboard_write("crewai_output", "crewai_crew")
                tool_start = self.cb.on_tool_start(
                    "market_researcher", "web_search", query
                )
                try:
                    market_research = _native_market_research(query, persona, pattern)
                except ResearchUnavailableError as error:
                    message = str(error)
                    self.cb.on_tool_end(
                        "market_researcher", "web_search", message, tool_start
                    )
                    self.cb.on_error("market_researcher", message)
                    result = {
                        "status": "partial",
                        "errors": [message],
                        "market_research": None,
                        "product_analysis": None,
                        "pricing_recommendation": None,
                        "framework": "crewai",
                        "llm_used": True,
                        "crewai_output": crew_result.output,
                        "tokens_used": crew_result.tokens_used,
                        "tasks_completed": crew_result.tasks_completed,
                        "agents": crew_result.agents,
                    }
                else:
                    self.cb.on_tool_end(
                        "market_researcher",
                        "web_search",
                        market_research[:200],
                        tool_start,
                    )
                    self.blackboard.write(
                        "market_research", market_research, "market_researcher", run_id
                    )
                    self.cb.on_blackboard_write("market_research", "market_researcher")
                    result = {
                        "status": "ok",
                        "errors": [],
                        "market_research": market_research,
                        "product_analysis": None,
                        "pricing_recommendation": None,
                        "framework": "crewai",
                        "llm_used": True,
                        "crewai_output": crew_result.output,
                        "tokens_used": crew_result.tokens_used,
                        "tasks_completed": crew_result.tasks_completed,
                        "agents": crew_result.agents,
                    }
                result["elapsed_ms"] = (time.time() - start) * 1000
                logger.info(
                    "[Crew] %s CrewAI run completed in %.0fms (%s tasks)",
                    pattern.upper(),
                    result["elapsed_ms"],
                    crew_result.tasks_completed,
                )
                return result

            tool_start = self.cb.on_tool_start(
                "market_researcher", "web_search", query
            )
            try:
                market_research = _native_market_research(query, persona, pattern)
            except ResearchUnavailableError as error:
                message = str(error)
                self.cb.on_tool_end(
                    "market_researcher", "web_search", message, tool_start
                )
                self.cb.on_error("market_researcher", message)
                self.audit.record(
                    "market_researcher",
                    "research_unavailable",
                    {"error": message},
                    output_key="market_research",
                )
                result = {
                    "status": "error",
                    "errors": [message],
                    "market_research": None,
                    "product_analysis": None,
                    "pricing_recommendation": None,
                    "framework": "native-mcp",
                    "llm_used": False,
                }
            else:
                self.cb.on_tool_end(
                    "market_researcher",
                    "web_search",
                    market_research[:200],
                    tool_start,
                )
                self.blackboard.write(
                    "market_research", market_research, "market_researcher", run_id
                )
                self.cb.on_agent_end("market_researcher", market_research, tokens=0)
                self.cb.on_blackboard_write("market_research", "market_researcher")
                self.audit.record(
                    "market_researcher",
                    "wrote_to_blackboard",
                    {"key": "market_research"},
                    input_keys=["user_query"],
                    output_key="market_research",
                    rationale="Stored live search results and source evidence",
                )
                result = {
                    "status": "partial",
                    "errors": [],
                    "market_research": market_research,
                    "product_analysis": None,
                    "pricing_recommendation": None,
                    "framework": "native-mcp",
                    "llm_used": False,
                }

        result["elapsed_ms"] = (time.time() - start) * 1000
        result["pattern"] = pattern
        logger.info(
            "[Crew] %s research stage completed in %.0fms",
            pattern.upper(),
            result["elapsed_ms"],
        )
        return result

    def run_sequential(self, query: str, persona: str, run_id: str) -> Dict[str, Any]:
        return self._run_research(query, persona, run_id, "sequential")

    def run_parallel(self, query: str, persona: str, run_id: str) -> Dict[str, Any]:
        return self._run_research(query, persona, run_id, "parallel")

    def run_hierarchical(self, query: str, persona: str, run_id: str) -> Dict[str, Any]:
        return self._run_research(query, persona, run_id, "hierarchical")

    def run_react(self, query: str, persona: str, run_id: str) -> Dict[str, Any]:
        return self._run_research(query, persona, run_id, "react")
