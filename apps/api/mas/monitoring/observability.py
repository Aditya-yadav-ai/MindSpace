"""
Observability: Tracing, auditability, and provenance (Requirement #9).

Implements:
- OpenTelemetry spans for each agent operation
- JSONL audit trail with full provenance
- Agent decision trace (who decided what, when, and why)
"""
from __future__ import annotations
import json
import logging
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Generator, Optional

logger = logging.getLogger(__name__)

try:
    from opentelemetry import trace
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor, SimpleSpanProcessor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
    OTEL_AVAILABLE = True
except ImportError:
    OTEL_AVAILABLE = False
    logger.warning("OpenTelemetry not installed — using local audit trail only")

try:  # Optional: only needed when an OTLP endpoint is configured.
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    OTLP_AVAILABLE = True
except ImportError:  # pragma: no cover - depends on optional install
    OTLP_AVAILABLE = False

# Process-wide provider. ``trace.set_tracer_provider`` is a one-shot global: a
# second call is ignored, so every OTelTracer instance must share the provider
# created here or spans silently land in a different exporter.
_provider: Optional[Any] = None
_memory_exporter: Optional[Any] = None
_otlp_configured: bool = False


def _ensure_provider(service_name: str):
    """Create (once) and return the process-wide TracerProvider."""
    global _provider, _memory_exporter, _otlp_configured
    if _provider is not None:
        return _provider

    import os

    resource = Resource.create({"service.name": service_name})
    provider = TracerProvider(resource=resource)
    _memory_exporter = InMemorySpanExporter()
    provider.add_span_processor(SimpleSpanProcessor(_memory_exporter))

    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    if endpoint and OTLP_AVAILABLE:
        # Endpoint may be the OTLP base (…/v1/traces appended) or a full URL.
        traces_endpoint = (
            endpoint if endpoint.rstrip("/").endswith("/v1/traces")
            else endpoint.rstrip("/") + "/v1/traces"
        )
        headers = {}
        raw_headers = os.environ.get("OTEL_EXPORTER_OTLP_HEADERS", "")
        for pair in raw_headers.split(","):
            if "=" in pair:
                key, value = pair.split("=", 1)
                headers[key.strip()] = value.strip()
        exporter = OTLPSpanExporter(endpoint=traces_endpoint, headers=headers or None)
        provider.add_span_processor(BatchSpanProcessor(exporter))
        _otlp_configured = True
        logger.info("[OTel] OTLP export enabled -> %s", traces_endpoint)
    elif endpoint and not OTLP_AVAILABLE:
        logger.warning(
            "[OTel] OTEL_EXPORTER_OTLP_ENDPOINT is set but the OTLP exporter "
            "package is not installed; spans stay in memory only."
        )

    trace.set_tracer_provider(provider)
    _provider = provider
    return provider



class AuditTrail:
    """
    JSONL-based audit trail for full provenance tracking.
    Every agent action is recorded with:
    - Who did it (agent_name)
    - What they did (action)
    - When (timestamp)
    - What data was used (input_keys from blackboard)
    - What was produced (output_key written to blackboard)
    - Why (reasoning/rationale)
    """

    def __init__(self, audit_log_path: str, run_id: str):
        self.path = Path(audit_log_path)
        self.run_id = run_id
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def record(self, agent_name: str, action: str, details: Dict[str, Any],
               input_keys: Optional[list] = None,
               output_key: Optional[str] = None,
               rationale: Optional[str] = None) -> None:
        entry = {
            "run_id": self.run_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "agent": agent_name,
            "action": action,
            "input_keys": input_keys or [],
            "output_key": output_key,
            "rationale": rationale,
            "details": details,
        }
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, default=str) + "\n")
        logger.debug(f"[Audit] {agent_name} -> {action}")

    def get_provenance(self, output_key: str) -> list:
        """
        Trace back which agents contributed to a specific output.
        Returns a provenance chain.
        """
        if not self.path.exists():
            return []
        chain = []
        with open(self.path, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    entry = json.loads(line)
                    if (entry.get("run_id") == self.run_id and
                            entry.get("output_key") == output_key):
                        chain.append(entry)
                except json.JSONDecodeError:
                    continue
        return chain

    def get_full_trace(self) -> list:
        """Get complete trace for this run."""
        if not self.path.exists():
            return []
        trace_entries = []
        with open(self.path, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    entry = json.loads(line)
                    if entry.get("run_id") == self.run_id:
                        trace_entries.append(entry)
                except json.JSONDecodeError:
                    continue
        return trace_entries


class OTelTracer:
    """
    OpenTelemetry-based span tracer for agent operations.
    Falls back gracefully to no-op if OTel not installed.
    """

    def __init__(self, service_name: str = "mas-ecommerce"):
        self.service_name = service_name
        self._tracer = None
        self._exporter = None
        self._spans: list = []

        if OTEL_AVAILABLE:
            try:
                _ensure_provider(service_name)
                # Always report through the shared in-memory exporter so every
                # instance (and every get_spans_summary caller) sees all spans.
                self._exporter = _memory_exporter
                self._tracer = trace.get_tracer(service_name)
                logger.info(f"[OTel] Tracer initialized for {service_name}")
            except Exception as e:
                logger.warning(f"[OTel] Init failed: {e} — using no-op")

    @contextmanager
    def span(self, name: str, attributes: Optional[Dict] = None) -> Generator:
        """Context manager that wraps an operation in an OTel span."""
        if self._tracer and OTEL_AVAILABLE:
            with self._tracer.start_as_current_span(name) as span:
                if attributes:
                    for k, v in attributes.items():
                        try:
                            span.set_attribute(k, str(v))
                        except Exception:
                            pass
                start_time = time.time()
                try:
                    yield span
                except Exception as e:
                    span.set_status(trace.StatusCode.ERROR, str(e))
                    raise
                finally:
                    elapsed = (time.time() - start_time) * 1000
                    try:
                        span.set_attribute("latency_ms", str(round(elapsed, 2)))
                    except Exception:
                        pass
        else:
            # No-op context manager
            start_time = time.time()
            self._spans.append({"name": name, "attributes": attributes or {},
                                  "start_time": datetime.utcnow().isoformat()})
            yield None

    def get_spans_summary(self) -> list:
        """Return exported spans for reporting."""
        if self._exporter and OTEL_AVAILABLE:
            try:
                finished = self._exporter.get_finished_spans()
                return [
                    {
                        "name": s.name,
                        "status": str(s.status),
                        "duration_ms": (s.end_time - s.start_time) / 1_000_000,
                        "attributes": dict(s.attributes or {}),
                    }
                    for s in finished
                ]
            except Exception:
                pass
        return self._spans

    @property
    def otlp_enabled(self) -> bool:
        """True when spans are also being exported over OTLP/HTTP."""
        return bool(_otlp_configured)


def otlp_status() -> Dict[str, Any]:
    """Describe trace export configuration without leaking endpoint secrets."""
    import os

    return {
        "otel_available": OTEL_AVAILABLE,
        "otlp_exporter_available": OTLP_AVAILABLE,
        "otlp_configured": _otlp_configured,
        "endpoint_set": bool(os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()),
        "headers_set": bool(os.environ.get("OTEL_EXPORTER_OTLP_HEADERS", "").strip()),
    }


# ─── Singletons ───────────────────────────────────────────────────────────────
_otel_tracer: Optional[OTelTracer] = None


def get_tracer() -> OTelTracer:
    global _otel_tracer
    if _otel_tracer is None:
        _otel_tracer = OTelTracer("mas-ecommerce-intelligence")
    return _otel_tracer


def get_audit_trail(run_id: str) -> AuditTrail:
    from mas.config import config
    return AuditTrail(config.AUDIT_LOG, run_id)
