"""MCP client used by MindSpace agents to call the research tools.

The client speaks the real protocol: it spawns the server over stdio (or
connects to its streamable-HTTP endpoint), initialises a session, lists tools
through `tools/list` and invokes them through `tools/call`.

Nothing in this module imports the server's tool functions directly — that is
the point: the tools must be reachable over MCP, not by shortcut.
"""

from __future__ import annotations

import asyncio
import json
import sys
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client
from mcp.client.streamable_http import streamable_http_client

SERVICE_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TIMEOUT_SECONDS = 30.0


@dataclass
class MCPToolResult:
    tool: str
    ok: bool
    data: Any = None
    text: str = ""
    error: str = ""
    raw: Any = None
    metadata: dict[str, Any] = field(default_factory=dict)


def _decode(result: Any) -> tuple[Any, str]:
    """Prefer structured content, fall back to concatenated text blocks."""
    structured = getattr(result, "structuredContent", None)
    if structured is not None:
        return structured, json.dumps(structured, ensure_ascii=False)[:4000]

    parts: list[str] = []
    for block in getattr(result, "content", []) or []:
        text = getattr(block, "text", None)
        if text:
            parts.append(str(text))
    joined = "\n".join(parts)
    try:
        return json.loads(joined), joined
    except (json.JSONDecodeError, TypeError):
        return None, joined


def _is_protocol_error(text: str) -> bool:
    """mcp 2.x reports unknown tools / argument failures as plain text blocks."""
    lowered = text.strip().lower()
    return lowered.startswith("unknown tool") or lowered.startswith("error executing tool")


class MCPToolClient:
    """Calls MCP tools over stdio, spawning the server as a subprocess."""

    def __init__(
        self,
        *,
        python_executable: str | None = None,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        env: dict[str, str] | None = None,
    ) -> None:
        self._python = python_executable or sys.executable
        self._timeout = timeout_seconds
        self._env = env

    @asynccontextmanager
    async def session(self):
        params = StdioServerParameters(
            command=self._python,
            args=["-m", "mas.mcp_service.server"],
            cwd=str(SERVICE_ROOT),
            env=self._env,
        )
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await asyncio.wait_for(session.initialize(), timeout=self._timeout)
                yield session

    async def list_tools(self) -> list[dict[str, Any]]:
        async with self.session() as session:
            result = await asyncio.wait_for(session.list_tools(), timeout=self._timeout)
        return [
            {
                "name": tool.name,
                "description": tool.description or "",
                "schema": getattr(tool, "input_schema", None)
                or getattr(tool, "inputSchema", None)
                or {},
            }
            for tool in result.tools
        ]

    async def call(self, name: str, arguments: dict[str, Any] | None = None) -> MCPToolResult:
        try:
            async with self.session() as session:
                result = await asyncio.wait_for(
                    session.call_tool(name, arguments or {}), timeout=self._timeout
                )
        except asyncio.TimeoutError:
            return MCPToolResult(tool=name, ok=False, error=f"MCP call timed out after {self._timeout}s.")
        except Exception as error:  # noqa: BLE001 - transport failures are surfaced, not raised
            return MCPToolResult(
                tool=name,
                ok=False,
                error=f"MCP transport error: {type(error).__name__}: {error}"[:400],
            )

        is_error = bool(getattr(result, "isError", False))
        data, text = _decode(result)
        if _is_protocol_error(text):
            is_error = True
        error_text = ""
        if is_error:
            error_text = text or "The MCP tool reported an error."
        elif isinstance(data, dict) and data.get("error"):
            error_text = str(data["error"])

        return MCPToolResult(
            tool=name,
            ok=not is_error and not error_text,
            data=data,
            text=text,
            error=error_text,
            raw=result,
            metadata={"is_error_flag": is_error},
        )


class MCPHttpClient:
    """Calls MCP tools over the streamable-HTTP transport."""

    def __init__(self, url: str = "http://127.0.0.1:8765/mcp", timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS) -> None:
        self._url = url
        self._timeout = timeout_seconds

    @asynccontextmanager
    async def session(self):
        async with streamable_http_client(self._url) as (read, write, _get_session_id):
            async with ClientSession(read, write) as session:
                await asyncio.wait_for(session.initialize(), timeout=self._timeout)
                yield session

    async def list_tools(self) -> list[dict[str, Any]]:
        async with self.session() as session:
            result = await asyncio.wait_for(session.list_tools(), timeout=self._timeout)
        return [
            {
                "name": tool.name,
                "description": tool.description or "",
                "schema": getattr(tool, "input_schema", None)
                or getattr(tool, "inputSchema", None)
                or {},
            }
            for tool in result.tools
        ]

    async def call(self, name: str, arguments: dict[str, Any] | None = None) -> MCPToolResult:
        try:
            async with self.session() as session:
                result = await asyncio.wait_for(
                    session.call_tool(name, arguments or {}), timeout=self._timeout
                )
        except Exception as error:  # noqa: BLE001
            return MCPToolResult(tool=name, ok=False, error=f"MCP HTTP error: {error}"[:400])
        data, text = _decode(result)
        is_error = bool(getattr(result, "isError", False)) or _is_protocol_error(text)
        return MCPToolResult(tool=name, ok=not is_error, data=data, text=text, error="" if not is_error else text, raw=result)


def call_tool_sync(name: str, arguments: dict[str, Any] | None = None, timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS) -> MCPToolResult:
    """Blocking helper for synchronous agent code."""
    client = MCPToolClient(timeout_seconds=timeout_seconds)
    return asyncio.run(client.call(name, arguments))


async def list_tools_async() -> list[dict[str, Any]]:
    return await MCPToolClient().list_tools()
