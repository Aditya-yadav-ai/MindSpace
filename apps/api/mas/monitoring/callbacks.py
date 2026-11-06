"""
Callback-based monitoring for agents (Requirement #5).

Tracks:
- Every agent step, tool call, output
- Per-agent execution heatmaps (token × latency × tools × errors)
- Error aggregation for debugging
- Execution flow visualization
"""
from __future__ import annotations
import json
import logging
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


class AgentMetrics:
    """Stores per-agent metrics for heatmap generation."""
    def __init__(self, agent_name: str):
        self.agent_name = agent_name
        self.steps: List[Dict] = []
        self.tool_calls: List[Dict] = []
        self.errors: List[str] = []
        self.total_tokens = 0
        self.total_latency_ms = 0.0
        self.start_time: Optional[float] = None

    def record_step(self, step_name: str, tokens: int = 0,
                    latency_ms: float = 0.0, output_preview: str = ""):
        self.steps.append({
            "step": step_name,
            "tokens": tokens,
            "latency_ms": latency_ms,
            "output_preview": output_preview[:200],
            "timestamp": datetime.utcnow().isoformat(),
        })
        self.total_tokens += tokens
        self.total_latency_ms += latency_ms

    def record_tool_call(self, tool_name: str, input_preview: str,
                         output_preview: str, latency_ms: float):
        self.tool_calls.append({
            "tool": tool_name,
            "input": input_preview[:100],
            "output": output_preview[:200],
            "latency_ms": latency_ms,
            "timestamp": datetime.utcnow().isoformat(),
        })

    def record_error(self, error: str):
        self.errors.append(error)
        logger.error(f"[{self.agent_name}] ERROR: {error}")


class MASCallbackManager:
    """
    Central callback manager for the entire MAS.
    Registered callbacks fire on every agent event.
    """
    def __init__(self, run_id: str, outputs_dir: str):
        self.run_id = run_id
        self.outputs_dir = Path(outputs_dir)
        self.metrics: Dict[str, AgentMetrics] = defaultdict(
            lambda: AgentMetrics("unknown")
        )
        self._callbacks: List[Callable] = []
        self._execution_flow: List[Dict] = []
        self._global_start = time.time()

    def register(self, callback: Callable) -> None:
        """Register an event callback."""
        self._callbacks.append(callback)

    def _fire(self, event: Dict) -> None:
        """Fire all registered callbacks."""
        event["run_id"] = self.run_id
        event["timestamp"] = datetime.utcnow().isoformat()
        self._execution_flow.append(event)
        for cb in self._callbacks:
            try:
                cb(event)
            except Exception as e:
                logger.debug(f"Callback error (non-fatal): {e}")

    def on_agent_start(self, agent_name: str, task: str) -> None:
        m = AgentMetrics(agent_name)
        m.start_time = time.time()
        self.metrics[agent_name] = m
        event = {"type": "agent_start", "agent": agent_name, "task": task[:200]}
        logger.info(f"[Callback] AGENT_START agent={agent_name}")
        self._fire(event)

    def on_agent_end(self, agent_name: str, output_preview: str,
                     tokens: int = 0) -> None:
        m = self.metrics[agent_name]
        if m.start_time:
            latency = (time.time() - m.start_time) * 1000
            m.record_step("completed", tokens=tokens, latency_ms=latency,
                          output_preview=output_preview)
        event = {"type": "agent_end", "agent": agent_name,
                 "tokens": tokens, "output_preview": output_preview[:200]}
        logger.info(f"[Callback] AGENT_END agent={agent_name} tokens={tokens}")
        self._fire(event)

    def on_tool_start(self, agent_name: str, tool_name: str, input_str: str) -> float:
        """Returns the start timestamp for latency tracking."""
        t = time.time()
        event = {"type": "tool_start", "agent": agent_name,
                 "tool": tool_name, "input": input_str[:200]}
        logger.info(f"[Callback] TOOL_START agent={agent_name} tool={tool_name}")
        self._fire(event)
        return t

    def on_tool_end(self, agent_name: str, tool_name: str, output_str: str,
                    start_time: float) -> None:
        latency = (time.time() - start_time) * 1000
        m = self.metrics[agent_name]
        m.record_tool_call(tool_name, "", output_str, latency)
        event = {"type": "tool_end", "agent": agent_name, "tool": tool_name,
                 "latency_ms": round(latency, 2), "output": output_str[:200]}
        logger.info(f"[Callback] TOOL_END agent={agent_name} tool={tool_name} "
                    f"latency={latency:.0f}ms")
        self._fire(event)

    def on_blackboard_write(self, key: str, agent_name: str) -> None:
        event = {"type": "blackboard_write", "key": key, "agent": agent_name}
        logger.debug(f"[Callback] BB_WRITE key={key} agent={agent_name}")
        self._fire(event)

    def on_blackboard_read(self, key: str, agent_name: str) -> None:
        event = {"type": "blackboard_read", "key": key, "agent": agent_name}
        logger.debug(f"[Callback] BB_READ key={key} agent={agent_name}")
        self._fire(event)

    def on_a2a_call(self, caller: str, callee: str, payload_preview: str) -> None:
        event = {"type": "a2a_call", "from": caller, "to": callee,
                 "payload": payload_preview[:200]}
        logger.info(f"[Callback] A2A_CALL {caller} -> {callee}")
        self._fire(event)

    def on_error(self, agent_name: str, error: str) -> None:
        self.metrics[agent_name].record_error(error)
        event = {"type": "error", "agent": agent_name, "error": error}
        logger.error(f"[Callback] ERROR agent={agent_name}: {error}")
        self._fire(event)

    def on_guardrail_trigger(self, agent_name: str, flag_type: str,
                              risk_level: str) -> None:
        event = {"type": "guardrail", "agent": agent_name,
                 "flag": flag_type, "risk": risk_level}
        logger.warning(f"[Callback] GUARDRAIL agent={agent_name} "
                       f"flag={flag_type} risk={risk_level}")
        self._fire(event)

    # ── HEATMAP GENERATION ───────────────────────────────────────────────────

    def generate_heatmaps(self) -> List[str]:
        """
        Generate per-agent heatmaps (Requirement #5).
        Each heatmap shows: pipeline steps x metrics matrix.
        Returns list of saved PNG file paths.
        """
        try:
            import matplotlib
            matplotlib.use("Agg")  # non-interactive backend
            import matplotlib.pyplot as plt
            import numpy as np
        except ImportError:
            logger.warning("matplotlib not installed — skipping heatmaps")
            return []

        saved_files = []
        heatmap_dir = self.outputs_dir / "heatmaps"
        heatmap_dir.mkdir(exist_ok=True)

        for agent_name, metrics in self.metrics.items():
            if not metrics.steps:
                continue

            steps = [s["step"] for s in metrics.steps]
            tokens = [s["tokens"] for s in metrics.steps]
            latencies = [s["latency_ms"] for s in metrics.steps]
            tool_calls_per_step = [1 if i < len(metrics.tool_calls) else 0
                                   for i in range(len(steps))]
            errors_per_step = [1 if i < len(metrics.errors) else 0
                               for i in range(len(steps))]

            # Build matrix: rows=metrics, cols=steps
            matrix = np.array([
                [t / (max(tokens) + 1) for t in tokens],
                [l / (max(latencies) + 1) for l in latencies],
                tool_calls_per_step,
                errors_per_step,
            ])

            fig, ax = plt.subplots(figsize=(max(6, len(steps) * 1.5), 4))
            im = ax.imshow(matrix, cmap="YlOrRd", aspect="auto", vmin=0, vmax=1)

            ax.set_yticks(range(4))
            ax.set_yticklabels(["Tokens (norm)", "Latency (norm)",
                                 "Tool Calls", "Errors"])
            ax.set_xticks(range(len(steps)))
            ax.set_xticklabels(steps, rotation=45, ha="right")
            ax.set_title(f"Agent Heatmap: {agent_name}\nRun: {self.run_id[:8]}...",
                         fontsize=12, fontweight="bold")

            plt.colorbar(im, ax=ax, label="Normalized Intensity")
            plt.tight_layout()

            path = str(heatmap_dir / f"heatmap_{agent_name}_{self.run_id[:8]}.png")
            plt.savefig(path, dpi=100, bbox_inches="tight")
            plt.close()
            saved_files.append(path)
            logger.info(f"[Callback] Heatmap saved: {path}")

        # Generate combined execution flow heatmap
        if len(self.metrics) > 1:
            path = self._generate_flow_heatmap(heatmap_dir)
            if path:
                saved_files.append(path)

        return saved_files

    def _generate_flow_heatmap(self, heatmap_dir: Path) -> Optional[str]:
        """Generate a combined heatmap showing all agent interactions."""
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
            import numpy as np

            agents = list(self.metrics.keys())
            n = len(agents)
            if n < 2:
                return None

            # Interaction matrix: agent[i] triggers agent[j]
            interaction_matrix = np.zeros((n, n))
            for event in self._execution_flow:
                if event["type"] == "a2a_call":
                    frm = event.get("from", "")
                    to = event.get("to", "")
                    if frm in agents and to in agents:
                        interaction_matrix[agents.index(frm)][agents.index(to)] += 1
                elif event["type"] == "blackboard_write":
                    writer = event.get("agent", "")
                    if writer in agents:
                        for j, a in enumerate(agents):
                            if a != writer:
                                interaction_matrix[agents.index(writer)][j] += 0.5

            fig, ax = plt.subplots(figsize=(8, 6))
            im = ax.imshow(interaction_matrix, cmap="Blues")
            ax.set_xticks(range(n))
            ax.set_yticks(range(n))
            ax.set_xticklabels([a[:12] for a in agents], rotation=45, ha="right")
            ax.set_yticklabels([a[:12] for a in agents])
            ax.set_title(f"Agent Interaction Heatmap\nRun: {self.run_id[:8]}...",
                         fontsize=12, fontweight="bold")
            ax.set_xlabel("Target Agent")
            ax.set_ylabel("Source Agent")
            plt.colorbar(im, ax=ax, label="Interaction Count")

            for i in range(n):
                for j in range(n):
                    val = interaction_matrix[i][j]
                    if val > 0:
                        ax.text(j, i, f"{val:.1f}", ha="center", va="center",
                                color="white" if val > interaction_matrix.max() * 0.5 else "black",
                                fontsize=9)

            plt.tight_layout()
            path = str(heatmap_dir / f"interaction_heatmap_{self.run_id[:8]}.png")
            plt.savefig(path, dpi=100, bbox_inches="tight")
            plt.close()
            logger.info(f"[Callback] Interaction heatmap saved: {path}")
            return path
        except Exception as e:
            logger.error(f"Interaction heatmap failed: {e}")
            return None

    def get_summary(self) -> Dict:
        total_elapsed = (time.time() - self._global_start) * 1000
        return {
            "run_id": self.run_id,
            "total_latency_ms": round(total_elapsed, 2),
            "agents": {
                name: {
                    "steps": len(m.steps),
                    "tool_calls": len(m.tool_calls),
                    "errors": len(m.errors),
                    "total_tokens": m.total_tokens,
                    "total_latency_ms": round(m.total_latency_ms, 2),
                }
                for name, m in self.metrics.items()
            },
            "total_events": len(self._execution_flow),
        }

    def save_execution_flow(self) -> str:
        path = str(self.outputs_dir / f"flow_{self.run_id[:8]}.json")
        with open(path, "w") as f:
            json.dump(self._execution_flow, f, indent=2, default=str)
        return path
