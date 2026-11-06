# Observability: tracing, audit and provenance

Requirement 9 asks for traces that show what the agents did, tool-invocation logs, and a way to
export them. This document records the wiring, how to verify it, and what is still missing.

## What exists

| Concern              | Implementation                                                                     | Verified by                                                           |
| -------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Correlation          | `X-Request-ID` accepted and echoed; contextvar propagated                          | `tests/test_api_v1.py`, `tests/test_health_ready.py`                  |
| Error envelopes      | structured `{error:{code,message,request_id}}`                                     | `tests/test_api_v1.py`                                                |
| Audit trail          | append-only JSONL per run: who / what / when / input keys / output key / rationale | `mas/monitoring/observability.py::AuditTrail`                         |
| Spans                | OpenTelemetry spans around orchestration stages                                    | `mas/monitoring/observability.py::OTelTracer`                         |
| Tool-invocation span | `tool.web_search` span with `query`, `result_count`, `backend`, `ok`               | `tests/test_research_reliability.py::ObservabilityConfigurationTests` |
| Agent metrics        | per-agent steps / tool calls / errors / latency snapshot                           | `mas/evaluation/harness.py::snapshot_agent_metrics`                   |
| Token & cost         | captured on the live model path; `null` (not `0`) offline                          | `tests/test_search_backends.py`, evaluation records                   |

## Export configuration

Tracing always records into an in-memory exporter so tests and reports can read spans. To also
export over OTLP/HTTP, set:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318        # /v1/traces appended automatically
OTEL_EXPORTER_OTLP_HEADERS=api-key=...                    # optional, comma-separated k=v
```

The module creates **one** process-wide `TracerProvider` (`_ensure_provider`). This matters:
`trace.set_tracer_provider` is one-shot, so the previous design — a new provider per
`OTelTracer()` — silently sent spans to whichever provider was registered first, and
`get_spans_summary()` only ever saw its own instance's spans. Now every instance shares the
provider and the same in-memory exporter, and `get_tracer()` is initialised at API startup
(`create_app`) so export is active before the first request.

Verify without a collector:

```bash
cd apps/api
.venv312\Scripts\python.exe -c "from mas.monitoring.observability import otlp_status; print(otlp_status())"
```

`otlp_configured` becomes `true` only after the provider is initialised (startup or first
`get_tracer()`), and only when the endpoint is set **and** the optional
`opentelemetry-exporter-otlp-proto-http` package is importable. If the endpoint is set but the
exporter is missing, a warning is logged and spans stay in memory — export is never silently
faked.

## Honest limitations

- No collector is reachable in this environment, so the OTLP transport itself was verified only
  up to configuration (provider built, `BatchSpanProcessor` attached, spans still readable
  in-memory). It is **not** claimed that spans were received by a backend.
- Token and cost capture is inert offline: no model key is configured, and the fields are
  recorded as `null` with `llm_available: false` rather than fabricated.
- On Windows consoles using cp1252, CrewAI's third-party agent-log handler can fail to print an
  emoji (`'charmap' codec can't encode character`). It is caught by the event bus and does not
  affect results; set `PYTHONIOENCODING=utf-8` to silence it.
