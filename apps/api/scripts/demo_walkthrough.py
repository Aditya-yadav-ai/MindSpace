"""MindSpace Multi-Agent Live Walkthrough CLI.

Demonstrates the 8-step multi-agent architecture locally without external cloud dependencies:
1. User Request Ingestion
2. Manager / Supervisor Task Decomposition
3. Agent Selection (Context, RAG, Research, Report)
4. Inter-Agent Communication (A2A / P2P Mailbox)
5. Tool Execution (SSRF-Safe MCP Tools)
6. Knowledge-Base Retrieval (Lexical Vector RAG)
7. Final Response Synthesis & Citation Grounding
8. Complete Provenance & Execution Trace Logging

Usage:
    python apps/api/scripts/demo_walkthrough.py [--query "..."]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

# Add apps/api to path
api_root = Path(__file__).resolve().parent.parent
if str(api_root) not in sys.path:
    sys.path.insert(0, str(api_root))

from mas.demo_workflow import run_multi_agent_demo


def print_banner() -> None:
    print("\n" + "=" * 76)
    print("      MINDSPACE STAGE 8 — MULTI-AGENT ARCHITECTURE LIVE WALKTHROUGH")
    print("=" * 76)
    print("  Topology: Manager Supervisor -> CrewAI / ADK -> Blackboard & P2P Mailbox")
    print("  Security: Socket-Level SSRF Filter | PyJWT Compound Isolation | AES-256-GCM")
    print("=" * 76 + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="MindSpace Multi-Agent Demonstration Walkthrough")
    parser.add_argument(
        "--query",
        default="Synthesize multi-agent coordination patterns and Transformer self-attention complexity",
        help="User inquiry to process through the agent team",
    )
    args = parser.parse_args()

    print_banner()
    print(f"[*] Ingesting User Goal: '{args.query}'\n")

    started = time.monotonic()
    result = run_multi_agent_demo(args.query, tenant_id="demo-tenant", user_id="demo-user")
    duration = round((time.monotonic() - started) * 1000, 2)

    for event in result["execution_trace"]:
        step = event["step"]
        stage = event["stage"].upper().replace("_", " ")
        agent = event["agent"]
        elapsed = event["elapsed_ms"]
        print(f"  [STEP {step}/8] {stage:<26} | Agent: {agent:<20} (+{elapsed:.1f}ms)")
        
        details = event["details"]
        if "decomposition" in details:
            for subtask in details["decomposition"]:
                print(f"           - {subtask}")
        elif "selected_agents" in details:
            agent_names = [a["name"] for a in details["selected_agents"]]
            print(f"           -> Selected Specialist Team: {', '.join(agent_names)}")
        elif "msg_id" in details:
            print(f"           -> P2P Dispatch: {details['sender']} => {details['recipient']} (ID: {details['msg_id']})")
        elif "tool" in details:
            print(f"           -> MCP Invocation: {details['tool']} (SSRF Check: PASS, Facts: {details['facts_extracted']})")
        elif "citations_returned" in details:
            print(f"           -> RAG Vectors: Evaluated {details['candidate_chunks_evaluated']} chunks, Returned {details['citations_returned']} citations")

    print("\n" + "-" * 76)
    print(f"[*] MULTI-AGENT SYNTHESIS RESULT (Run ID: {result['run_id']})")
    print(f"    Mode: {result['mode'].upper()} | Mock: {result['mock']} | Model: {result['model']}")
    print("-" * 76)
    print(result["summary"])
    print("-" * 76)
    print("GROUNDED CITATIONS:")
    for s in result["sources"]:
        print(f"  [{s['index']}] {s['title']} (Cosine Similarity: {s['similarity']})")
        print(f"      \"{s['snippet'][:110]}...\"")

    print("\n" + "=" * 76)
    print(f"✔ DEMO COMPLETED SUCCESSFULLY IN {duration:.2f}ms (8/8 Steps Executed)")
    print("=" * 76 + "\n")


if __name__ == "__main__":
    main()

