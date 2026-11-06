# MindSpace (Stage 8)

> **Calm Browser-Focused AI Research Workspace & Autonomous Side Panel**

**Project Path:** `C:\Users\aadin\Downloads\Telegram Desktop\mindspace-stage8\mindspace-stage8`

---

## 📖 Overview

**MindSpace** is an advanced AI workspace designed to function as an ambient research assistant and browser companion. It bridges active web browsing with local intelligence, semantic retrieval, and agentic task execution. MindSpace enables readers to capture live webpage context (URL, active DOM text, user selection, and screenshots), produce grounded summaries and fact extractions, maintain a vector-indexed personal knowledge base, draft content in a dedicated writing studio, and automate multi-step background tasks via scheduled agent runs.

---

## 🚀 Key Features & Modules

### 1. 🧭 Workspace Home

- **Active Browser Context**: Ingests title, URL, selections, and screenshot captures directly from the browser side panel or active session.
- **One-Click Page Actions**:
  - `Summarize`: Rapidly condenses complex articles into concise, structured key takeaways.
  - `Explain`: Breaks down technical, legal, or dense concepts with plain-language explanations.
  - `Extract Facts`: Pulls verified claims, data points, dates, and quotes directly from page text without hallucinations.
  - `Ask`: Interactive context-grounded Q&A against the open page.
- **Side Panel Chat**: Open-ended conversational interface with live context streaming and provenance tracking.

### 2. ✍️ Writing Studio

- **Assisted Composition**: Draft new content or transform existing text.
- **Transformation Modes**: `Draft`, `Rewrite`, `Shorten`, and `Expand`.
- **Tone Presets**: `Neutral`, `Friendly`, `Formal`, and `Concise`.
- **Grounded Output**: Strict guardrails preventing hallucinated sources, citations, or synthetic statistics.

### 3. 📚 Knowledge Base (RAG & Semantic Retrieval)

- **Document Ingestion**: Supports direct text entry and PDF parsing via in-browser `pdfjs-dist`.
- **Vector Search**: Automatic chunking, vector embedding generation, and cosine similarity lookup powered by Supabase `pgvector` (`match_document_chunks`).
- **Source Attribution**: Answers cite exact document chunks and similarity scores.

### 4. 🤖 Agent Activity & Verification

- **Goal-Oriented Execution**: Formulates execution plans, performs multi-step task resolution, and monitors tool usage.
- **Verification Engine**: Automated post-run evaluation generating verdict logs and verification scores.

### 5. ⏱️ Automations & Scheduled Runs

- **Recurring Workflows**: Configure daily, weekly, or interval-based goals.
- **Tool Guardrails & Safety**: Granular pre-approval mechanism for consequential tools—unattended runs cannot execute unapproved actions.
- **Cron Worker Integration**: Endpoint at `/api/cron/automations` to trigger due automation jobs.

### 6. 🔗 Connected Services & Google OAuth

- **Secure Token Handling**: Cryptographic token encryption at rest (`google_connections` table) with PKCE OAuth flow (`google_oauth_states`).
- **Google Workspace Capabilities**: Scaffolding for Google Drive, Docs, and Calendar integrations.

### 7. 🧩 Chrome Extension Integration (Manifest V3)

- Scaffolding located in `public/manifest.json`.
- Uses `sidePanel`, `activeTab`, `scripting`, and `storage` permissions to communicate with the local MindSpace server (`http://localhost:8000` / `http://localhost:8080`).

---

## 🛠️ Tech Stack & Architecture

| Layer                       | Technology                                                                                                                      |
| :-------------------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| **Framework**               | [React 19](https://react.dev/), [TanStack Start](https://tanstack.com/start), [TanStack Router](https://tanstack.com/router)    |
| **Build & Bundling**        | [Vite 8](https://vitejs.dev/), Nitro Server Engine                                                                              |
| **Styling & Components**    | [Tailwind CSS v4](https://tailwindcss.com/), [Radix UI](https://www.radix-ui.com/), [Lucide React](https://lucide.dev/), Motion |
| **AI / LLM Orchestration**  | [Vercel AI SDK](https://sdk.vercel.ai/), `@ai-sdk/openai`, Lovable AI Gateway (`openai/gpt-6-astra`)                            |
| **Streaming & Rendering**   | Streamdown (Markdown, Math/KaTeX, Mermaid diagramming, CJK)                                                                     |
| **Database & Vector Store** | [Supabase](https://supabase.com/) (PostgreSQL 14.5+ with `pgvector`, Row Level Security)                                        |
| **Authentication**          | Supabase Auth (Session management, OAuth providers)                                                                             |
| **Browser Extension**       | Chrome Manifest V3 (`sidePanel`, Service Worker)                                                                                |

---

## 📁 Repository Structure

```text
mindspace-stage8/
├── public/
│   ├── manifest.json          # Chrome Extension Manifest V3
│   ├── extension-background.js# Extension service worker
│   └── sidepanel.html         # Extension sidepanel host
├── src/
│   ├── components/
│   │   ├── mindspace/         # Domain components (Workspace, Writing, Knowledge, etc.)
│   │   └── ui/                # Base Radix & Tailwind UI primitives
│   ├── integrations/
│   │   ├── lovable/           # Lovable platform integration
│   │   └── supabase/          # Supabase client and typed DB schema
│   ├── lib/
│   │   ├── agent.functions.ts # Agent server functions & local API bridge
│   │   ├── automations.functions.ts
│   │   ├── google.functions.ts
│   │   ├── knowledge.functions.ts
│   │   ├── writing.functions.ts
│   │   └── ai-gateway.server.ts
│   ├── routes/
│   │   ├── __root.tsx         # TanStack Start root layout & providers
│   │   ├── index.tsx          # MindSpace main SPA shell & view switcher
│   │   └── api/
│   │       ├── chat.ts        # Streaming chat endpoint
│   │       ├── cron/automations.ts
│   │       └── google/oauth-callback.ts
│   ├── routeTree.gen.ts       # Generated type-safe route tree
│   └── router.tsx             # TanStack Router initialization
├── supabase/
│   └── migrations/            # SQL schemas, RLS policies & pgvector setups
├── package.json               # Node.js dependencies and scripts
├── tsconfig.json              # TypeScript compilation config
├── vite.config.ts             # Vite & TanStack Start build configuration
└── README.md                  # Comprehensive project documentation
```

---

## ⚙️ Environment Variables

Create `.env.local` inside the project root:

```env
# Supabase Configuration
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_key

# Lovable AI Gateway
LOVABLE_API_KEY=your_lovable_api_key

# Google OAuth Integration
GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:8080/api/google/oauth-callback

# Optional Local Python Agent Bridge
MINDSPACE_API_URL=http://127.0.0.1:8000
```

---

## 🚀 Getting Started

### 1. Prerequisites

- **Node.js** (v20+ recommended)
- **npm** or **pnpm**
- **Supabase Project** (with `pgvector` extension enabled)
- _(Optional)_ **Python 3.10+** (if running the companion local agent server)

### 2. Installation

```bash
npm install
```

### 3. Setup Environment Files

```bash
cp .env.example .env.local
# Populate .env.local with your real keys
```

### 4. Run Development Server

```bash
npm run dev -- --host 0.0.0.0
```

Open [http://localhost:8080](http://localhost:8080) in your browser.

### 5. Running the Chrome Extension

1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** in the top right.
3. Click **Load unpacked**.
4. Select the `public` directory (or the folder containing `manifest.json`).
5. Open Chrome's Side Panel to test MindSpace alongside live web browsing.

---

## 🔒 Security & Privacy Architecture

- **Server Functions Only for Credentials**: API keys (`LOVABLE_API_KEY`, `GOOGLE_CLIENT_SECRET`) are strictly kept server-side inside TanStack Start server functions and Nitro handlers.
- **Safe Agent Sandboxing**: Unattended automation runs require explicit user consent and whitelisting of consequential tools.
- **Zero-Storage Reasoning**: Model responses disable OpenAI reasoning retention (`store: false`) where applicable to maintain strict user privacy.
