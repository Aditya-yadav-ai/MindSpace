# MindSpace API

Python service for the MindSpace agent runtime (Google ADK + CrewAI) and the
HTTP boundary consumed by the TypeScript app. It runs as a **separate
service**; it is not bundled into the Vite build.

## Runtime

CPython **3.12.x** is required (`crewai` does not support 3.14). The validated
interpreter on this machine is the uv-managed 3.12.13. The project venv is
`apps/api/.venv312`; the older `.venv` (3.14) is not used by this service and
must not be modified.

```powershell
# Create the 3.12 environment (already done for this checkout)
& "$env:APPDATA\uv\python\cpython-3.12-windows-x86_64-none\python.exe" -m venv .venv312

# Install runtime + framework dependencies in ONE resolution
.\.venv312\Scripts\python.exe -m pip install -r requirements.txt -r mas\requirements_mas.txt
```

Two manifests exist on purpose:

| File                       | Contents                                                                |
| -------------------------- | ----------------------------------------------------------------------- |
| `requirements.txt`         | Service runtime: FastAPI, uvicorn, pydantic, OpenTelemetry, numpy/scipy |
| `mas/requirements_mas.txt` | Agent frameworks: CrewAI, Google ADK, LiteLLM, langchain-groq, plotting |

**Do not upgrade one pin at a time.** `fastapi==0.144.0` requires
`opentelemetry-api>=1.44.0`, `google-adk==2.13.0` accepts `<=1.44`, and
`crewai 1.x` would require `>=1.45.1`. The pinned combination is the only one
that satisfies all three. Details are in the comments of both manifests.

## Running

```powershell
.\.venv312\Scripts\python.exe -m app.main
```

`PORT` is optional and defaults to **8000**. Invalid values (`""`, `abc`,
`0`, `65536`) fail fast at startup with a validation error instead of binding
a wrong port.

## Endpoints

| Endpoint      | Purpose          | Response                                                                                               |
| ------------- | ---------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /health` | Liveness, no I/O | `{"ok": true}` (unchanged shape)                                                                       |
| `GET /ready`  | Readiness + mode | `status`, `service`, `port`, `mode`, `mock`, `llm_configured`, `offline_requested`, `reason`, `checks` |

## Offline / mock mode

The service never claims to be live without a usable LLM key.

| Situation                                  | Result                                                |
| ------------------------------------------ | ----------------------------------------------------- |
| `GROQ_API_KEY` unset or a placeholder      | `mode: "offline"`, `mock: true`                       |
| `MINDSPACE_OFFLINE=1`                      | `mode: "offline"`, `mock: true`, even with a real key |
| `MINDSPACE_OFFLINE=0` **and** a usable key | `mode: "live"`, `mock: false`                         |
| `MINDSPACE_OFFLINE=0` **without** a key    | falls back to `offline`, reason says so               |

Placeholder detection covers values such as `gsk_placeholder_set_your_key`,
`replace-me-locally`, and `set-in-cloud-console`. Any result produced while
`mock` is true is simulated and must be labelled as such — it is not a live
agent run.

## Tests

```powershell
.\.venv312\Scripts\python.exe -m unittest discover -s tests -v
```

Covers startup port validation, health/ready shapes, key redaction, and every
offline-mode transition.
