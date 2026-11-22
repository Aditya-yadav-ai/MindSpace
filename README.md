# MindSpace (Stage 8)

> **Intelligent Multi-Agent AI Browser Assistant & Calm Research Workspace**

---

## Overview

**MindSpace** is an AI-powered browser companion that bridges active web browsing with local intelligence, semantic retrieval, and agentic task execution. It runs as a **Chromium Manifest V3 side-panel extension** backed by a **React 19 / TanStack Start** web application and a **FastAPI multi-agent** Python backend.

Core capabilities:

- Capture browser tab context (URL, title, selected text, screenshots).
- Summarize webpages, PDFs, articles, emails, and research papers.
- Answer contextual questions grounded in page content.
- Perform multi-agent research using a Manager Agent and specialized sub-agents.
- Use RAG for retrieval-augmented knowledge-grounded responses.
- Coordinate 14 Google Workspace services with encrypted OAuth tokens.
- Full offline/demo mode — no paid API keys required for local testing.

---

## Quick Start (Local Development)

### Prerequisites

| Tool              | Required Version                      |
| ----------------- | ------------------------------------- |
| **Node.js**       | v20+                                  |
| **npm**           | v10+ (ships with Node 20)             |
| **Python**        | 3.12                                  |
| **Google Chrome** | Latest stable (for extension loading) |

### 1. Install Dependencies

```powershell
cd mindspace-stage8
npm install
```

### 2. Create the Python Virtual Environment (one-time)

```powershell
cd apps/api
python -m venv .venv312
.\.venv312\Scripts\pip install -r requirements.txt
cd ../..
```

### 3. Initialize the Database

```powershell
$env:PYTHONPATH = "apps/api"
.\apps\api\.venv312\Scripts\python.exe apps/api/scripts/db_admin.py migrate
.\apps\api\.venv312\Scripts\python.exe apps/api/scripts/db_admin.py seed
```

### 4. Start the FastAPI Backend (port 8010)

```powershell
$env:PORT = "8010"
$env:PYTHONPATH = "apps/api"
.\apps\api\.venv312\Scripts\python.exe -m app.main
```

Expected output:

```
WARNING: Starting in OFFLINE/MOCK mode: no usable GROQ_API_KEY. Produced results are simulated.
INFO:    Listening on 127.0.0.1:8010
INFO:    Uvicorn running on http://127.0.0.1:8010
```

Verify: `curl http://127.0.0.1:8010/health` → `{"ok":true}`

### 5. Start the Web UI (port 8080)

In a **second terminal**:

```powershell
cd mindspace-stage8
npm run dev
```

Open [http://localhost:8080](http://localhost:8080) in your browser.

### 6. Load the Chrome Extension

```powershell
npm run build:extension
```

Then in Chrome:

1. Navigate to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `dist-extension/` directory
5. Press **Alt+B** on any webpage to capture context and open MindSpace

---

## Environment Variables

Create `.env.local` in the project root (optional — the app runs in offline mode without any keys):

```env
# ─── FastAPI Backend ───
PORT=8010                                    # Backend port (default: 8000)
GROQ_API_KEY=gsk_...                         # Optional: enables live LLM inference
MINDSPACE_ENV=development                    # development | production | test
RATE_LIMIT_PER_MINUTE=60                     # Per-user API rate limit

# ─── Frontend / Supabase (optional) ───
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_key

# ─── Google OAuth (optional) ───
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:8080/api/google/oauth-callback
GOOGLE_TOKEN_ENCRYPTION_KEY=<64-hex-chars>   # Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Ports & Services

| Service          | URL                          | Description                                      |
| ---------------- | ---------------------------- | ------------------------------------------------ |
| FastAPI Backend  | `http://127.0.0.1:8010`      | Multi-agent API, context store, assist, research |
| Backend API Docs | `http://127.0.0.1:8010/docs` | Interactive Swagger documentation                |
| Web Dashboard    | `http://localhost:8080`      | React 19 / TanStack Start SPA                    |
| Chrome Extension | Side Panel (Alt+B)           | Loaded from `dist-extension/`                    |

---

## Running Tests

```powershell
# All frontend tests (auth, pdf, google adapters, extension)
npm run test:all

# Individual test suites
npm run test:auth          # 13 tests: login, JWT, session, Google linking
npm run test:pdf           # 4 tests:  standard fonts, CMap, PDF extraction
npm run test:google        # 19 tests: 14 service adapters, encryption, dispatch
npm run test:extension     # 11 tests: MV3 manifest, runtime, real Chrome load

# Backend pytest suite
$env:PYTHONPATH = "apps/api"
.\apps\api\.venv312\Scripts\python.exe -m pytest apps/api/tests -v
```

---

## Key Features & Modules

### 1. Workspace Home

- **Active Browser Context**: Ingests title, URL, selections, and screenshots.
- **One-Click Actions**: `Summarize`, `Explain`, `Extract Facts`, `Ask`.
- **Side Panel Chat**: Context-grounded Q&A with provenance tracking.

### 2. Writing Studio

- **Transformation Modes**: Draft, Rewrite, Shorten, Expand.
- **Tone Presets**: Neutral, Friendly, Formal, Concise.
- **Grounded Output**: Strict guardrails preventing hallucinated sources.

### 3. Knowledge Base (RAG)

- **Document Ingestion**: Text and PDF parsing via in-browser `pdfjs-dist`.
- **Vector Search**: Chunking, embedding, and cosine similarity lookup.
- **Source Attribution**: Answers cite exact document chunks and scores.

### 4. Agent Activity & Verification

- Goal-oriented multi-step execution with tool usage monitoring.
- Automated post-run verification generating verdict logs.

### 5. Automations & Scheduled Runs

- Recurring workflows with cron-based scheduling.
- Granular pre-approval for consequential tools.

### 6. Connected Google Services (14 total)

| Category      | Services                                               |
| ------------- | ------------------------------------------------------ |
| Communication | Gmail, Google Meet, Google Chat                        |
| Productivity  | Drive, Docs, Sheets, Slides, Tasks, Calendar, Contacts |
| Education     | Classroom, Forms, YouTube                              |
| Location      | Maps Platform (Places, Geocoding, Directions)          |

> Google Keep and Google Photos are explicitly excluded.

### 7. Chrome Extension (Manifest V3)

- Side Panel with `Alt+B` shortcut for capture.
- Handles restricted pages (`chrome://`, `edge://`, `about:`) gracefully.
- Zero runtime errors — no `fileURLToPath` or PDF font warnings.

---

## Tech Stack

| Layer         | Technology                                                     |
| ------------- | -------------------------------------------------------------- |
| **Framework** | React 19, TanStack Start, TanStack Router                      |
| **Build**     | Vite 8, Nitro Server Engine                                    |
| **Styling**   | Tailwind CSS v4, Radix UI, Lucide React, Motion                |
| **AI / LLM**  | FastAPI, LiteLLM, CrewAI, Google ADK, MCP, A2A                 |
| **Streaming** | Streamdown (Markdown, Math/KaTeX, Mermaid, CJK)                |
| **Database**  | PostgreSQL 16 with SQLite fallback, compound key multi-tenancy |
| **Auth**      | PyJWT (HS256/RS256), AES-256-GCM token encryption              |
| **Extension** | Chrome Manifest V3 Side Panel                                  |

---

## Repository Structure

```
mindspace-stage8/
├── public/                 # Static assets, extension manifest, service worker
├── src/
│   ├── components/
│   │   ├── mindspace/      # Domain components (Workspace, Writing, Knowledge)
│   │   └── ui/             # Radix & Tailwind UI primitives
│   ├── lib/                # Server functions, agent bridge, Google adapters
│   └── routes/             # TanStack Router pages and API handlers
├── apps/api/               # FastAPI backend
│   ├── app/                # Core application (main, config, auth, guardrails)
│   ├── mas/                # Multi-Agent System (agents, workflows, MCP, A2A)
│   └── tests/              # Pytest test suite
├── tests/                  # Frontend test suites
├── scripts/                # Build, run, and admin scripts
├── dist-extension/         # Built Chrome extension (generated)
├── .github/workflows/      # CI/CD pipeline
└── docs/                   # Service matrix, architecture docs
```

---

## Database Administration

```powershell
npm run db:status    # Show migration and connectivity status
npm run db:migrate   # Apply schema migrations
npm run db:seed      # Seed demo records
npm run db:backup    # Create point-in-time backup
npm run db:reset     # Reset database (destructive)
```

---

## Security Notes

- API keys and secrets are strictly server-side only.
- All untrusted DOM content is sanitized and injection-scanned.
- MCP research client enforces socket-level SSRF blocking.
- Rate limiting protects all authenticated endpoints (60 req/min default).
- Never commit `.env`, `.env.local`, or real credentials.

---

## CI/CD

GitHub Actions automatically runs on push/PR to `main`, `master`, or `develop`:

- **Frontend**: Lint → Auth tests → PDF tests → Google tests → Extension build → Extension runtime tests → Web build.
- **Backend**: Python dependency install → DB migration → Pytest suite.
- **Security**: `npm audit` and conflict marker detection.

---

## License

Licensed under the **Apache License, Version 2.0**. See [LICENSE](LICENSE).
Third-party attributions in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
