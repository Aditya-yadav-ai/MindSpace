"""Versioned evaluation dataset (Requirement #10).

The dataset is generated deterministically from the project's personas so a
later person can rebuild byte-identical cases, and it is written to disk as a
JSONL artifact so a run can be tied to the exact cases it used.

Design: **matched blocks**. Each block fixes one (persona, query, tool config)
and repeats it across every architecture. Comparing architectures on identical
inputs is the only way the architecture comparison can be called fair.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATASET_VERSION = "mindspace-eval-1.0.0"
ARCHITECTURES: tuple[str, ...] = ("sequential", "hierarchical", "parallel", "react")
TOOL_CONFIG = "mcp:web_search,fetch_page,extract_facts"
PROMPT_STRATEGY_BY_ARCHITECTURE = {
    "sequential": "standard",
    "hierarchical": "standard",
    "parallel": "standard",
    "react": "react",
}

DATA_DIR = Path(__file__).resolve().parent / "data"
CASES_PATH = DATA_DIR / "cases_v1.jsonl"
META_PATH = DATA_DIR / "cases_v1.meta.json"


def _case(
    case_id: str,
    batch: str,
    block_id: str,
    persona: str,
    query: str,
    architecture: str,
    transport: str,
) -> dict[str, Any]:
    return {
        "case_id": case_id,
        "batch": batch,
        "block_id": block_id,
        "persona": persona,
        "query": query,
        "architecture": architecture,
        "prompt_strategy": PROMPT_STRATEGY_BY_ARCHITECTURE[architecture],
        "messaging_transport": transport,
        "tool_config": TOOL_CONFIG,
    }


def build_cases(queries_per_persona: int = 2) -> list[dict[str, Any]]:
    """Build the core 40-case matrix plus a small A2A transport batch.

    5 personas x 2 queries = 10 matched blocks; 10 blocks x 4 architectures =
    40 core runs. The A2A batch repeats one block across all architectures so
    both dispatch transports are represented on matched inputs.
    """
    from mas.agents.crewai_crew.personas import PERSONAS

    cases: list[dict[str, Any]] = []
    number = 0
    for persona_name, persona in PERSONAS.items():
        queries = list(persona.sample_queries)[:queries_per_persona]
        for query_index, query in enumerate(queries):
            block_id = f"block-{persona_name}-{query_index + 1}"
            for architecture in ARCHITECTURES:
                number += 1
                cases.append(
                    _case(
                        case_id=f"case-{number:03d}",
                        batch="core-p2p",
                        block_id=block_id,
                        persona=persona_name,
                        query=query,
                        architecture=architecture,
                        transport="p2p",
                    )
                )

    first_persona = next(iter(PERSONAS))
    first_query = PERSONAS[first_persona].sample_queries[0]
    for index, architecture in enumerate(ARCHITECTURES, start=1):
        cases.append(
            _case(
                case_id=f"a2a-{index:03d}",
                batch="a2a",
                block_id="block-a2a-1",
                persona=first_persona,
                query=first_query,
                architecture=architecture,
                transport="a2a",
            )
        )
    return cases


def cases_fingerprint(cases: list[dict[str, Any]]) -> str:
    payload = json.dumps(cases, sort_keys=True, ensure_ascii=True).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def write_dataset(cases: list[dict[str, Any]]) -> dict[str, Any]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with CASES_PATH.open("w", encoding="utf-8", newline="\n") as handle:
        for case in cases:
            handle.write(json.dumps(case, sort_keys=True, ensure_ascii=True) + "\n")
    meta = {
        "dataset_version": DATASET_VERSION,
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "case_count": len(cases),
        "architectures": list(ARCHITECTURES),
        "tool_config": TOOL_CONFIG,
        "sha256": cases_fingerprint(cases),
        "description": (
            "Matched-block evaluation cases: each block fixes persona, query and "
            "tool configuration and is repeated across sequential, hierarchical, "
            "parallel and react architectures."
        ),
    }
    META_PATH.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return meta


def load_cases(path: Path | None = None) -> list[dict[str, Any]]:
    target = path or CASES_PATH
    if not target.exists():
        cases = build_cases()
        write_dataset(cases)
        return cases
    cases = []
    with target.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                cases.append(json.loads(line))
    return cases


def load_meta() -> dict[str, Any]:
    if META_PATH.exists():
        return json.loads(META_PATH.read_text(encoding="utf-8"))
    return {"dataset_version": DATASET_VERSION, "sha256": "unrecorded"}
