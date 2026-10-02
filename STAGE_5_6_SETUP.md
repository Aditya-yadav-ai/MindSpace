# Stage 5 — Google OAuth setup

MindSpace's Gmail/Calendar/Drive agents need a real Google Cloud OAuth client.
Nothing in this stage works — by design — until these are set:

## 1. Google Cloud project
1. Create (or reuse) a project at console.cloud.google.com.
2. Enable the **Gmail API**, **Google Calendar API** and **Google Drive API**.
3. Configure the OAuth consent screen (External is fine for testing; add your
   own Google account as a test user while the app is unverified).
4. Create an **OAuth 2.0 Client ID** (type: Web application).
   - Authorized redirect URI: `<your-app-origin>/api/google/oauth-callback`
     (e.g. `https://your-app.example.com/api/google/oauth-callback`, or
     `http://localhost:5173/api/google/oauth-callback` for local dev).

## 2. Environment variables
Set these wherever the server runs (never commit them):

| Variable | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | from the OAuth client above |
| `GOOGLE_CLIENT_SECRET` | from the OAuth client above |
| `GOOGLE_REDIRECT_URI` | the exact redirect URI you registered |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | 32 random bytes, base64 or hex — generate with `openssl rand -base64 32` |

If `GOOGLE_TOKEN_ENCRYPTION_KEY` is missing, connecting Google fails loudly
(tokens are never written unencrypted). If the other three are missing,
Connect Google fails with a clear "Missing GOOGLE_..." error.

## 3. Database
Apply `supabase/migrations/20260925050000_google_connections.sql`. It adds
`google_connections` and `google_oauth_states`, both RLS-locked to the
service role only — no user, including the token's own owner, can read them
through the normal Supabase client.

## 4. Scopes requested
`openid email`, `gmail.readonly`, `gmail.compose`, `calendar.events`,
`drive.file` (app-created files only, not the whole Drive).

## 5. Trying it out
Settings → Connected Services → Connect Google → approve on Google's
consent screen → redirected back with a "Google connected" notice. Then in
Agent Activity, try a goal like "Draft an email about this page" or "What's
on my calendar next?" — read actions run immediately; anything that writes
to your real account (a Gmail draft, a calendar event, a Drive file) is
blocked until you tap **Approve & continue**.

This app never asks for or stores your Google password — sign-in happens
entirely on Google's own page.

## Stage 6 — Workspace expansion

Ten services in total now share one Google connection: Gmail, Calendar,
Drive (Stage 5), plus **Docs, Sheets, Slides, Forms, Meet, Classroom, Chat**
(Stage 6). Enable each corresponding API in the same Google Cloud project:

- Google Docs API
- Google Sheets API
- Google Slides API
- Google Forms API
- Google Meet API
- Google Classroom API
- Google Chat API

Re-connect Google after enabling new APIs/scopes (Settings → Connected
Services → Disconnect, then Connect again) so the consent screen grants the
new scopes — Google won't retroactively add them to an existing token.

**Notes on individual services:**
- **Classroom** is read-only in this app on purpose — it never posts
  announcements or grades on the user's behalf. Some Classroom data (e.g.
  courses owned by a school Workspace domain) may be restricted by the
  domain's admin regardless of the scopes granted here.
- **Chat** requires the Chat API to be enabled *and* the calling app to be
  allowed to send messages as the user, which for Google Chat depends on
  how your Cloud project is configured — sending may return a permission
  error even with the scope granted, until that's set up on Google's side.
- **Meet** creates an instant meeting space; there's no "list my past
  meetings" endpoint in the public Meet API, so Meet only ever creates.

Every write in Stage 6 (`docs.create`, `sheets.create`, `sheets.append_row`,
`slides.create`, `forms.create`, `meet.create_space`, `chat.send_message`)
is confirmation-gated the same way Stage 5's were — nothing happens until
the user taps **Approve & continue** in Agent Activity.

## Stage 7 — Research/Product/Reminder agents and cross-service workflows

**No new required environment variables.** `web.fetch_page`, the Product
Agent and the Reminder Agent all work out of the box — `web.fetch_page` is a
real, direct HTTP fetch, and reminders are stored in your own Supabase
database.

**One optional variable:**

| Variable | Value |
| --- | --- |
| `SEARCH_API_KEY` | A Brave Search API key (or compatible). Optional — without it, `web.search` fails with a clear "not configured" message instead of ever returning invented results. `web.fetch_page` (reading a specific URL) works either way. |

### Database
Apply `supabase/migrations/20260928120000_stage7_tasks.sql`. It adds
`tasks`, RLS-locked per user — the same pattern as every earlier table.

### Trying it out
- "Save a reminder about this page" → the Reminder Agent creates a real row
  in **Tasks** (new nav item).
- "Find the product and price at `<url>`" → the Product Agent fetches the
  page for real and extracts a name/price/links; it never invents a product
  when the page can't be reached.
- "Read `<url>`, create a report doc, save it to Drive and add a calendar
  reminder" → the deterministic cross-service chain: Web Reader → Extractor
  → Docs → Drive → Calendar, each step reusing the previous step's real
  output. Docs/Drive/Calendar writes are still held for your approval.
- Research goals that link to a URL now read that page first; goals that
  say "search the web" / "look it up online" use `web.search` when
  configured.

## Stage 8 — History, memory and recurring automations

**No new required environment variables** for History or Memory — both are
plain Supabase-backed CRUD, RLS-scoped to the signed-in user.

Recurring **Automations** need one more variable so the cron worker can
authenticate itself (this mirrors the `cron-auth.ts` helper that already
shipped in earlier stages):

| Variable | Value |
| --- | --- |
| `LOVABLE_CRON_SECRET` | Set this in your deployment's cron/scheduled-task configuration, pointed at `POST /api/cron/automations`, on whatever interval you want checked (every few minutes is reasonable — only automations whose `next_run_at` has passed actually run). |
| `LOVABLE_CRON_SECRET_PREVIOUS` | Optional, used only while rotating the secret. |

Without a cron job calling that endpoint, automations can still always be
run manually from the Automations view ("Run now") — only the *unattended,
scheduled* execution needs the cron trigger wired up.

### Database
Apply `supabase/migrations/20260928121500_stage8_history_memory_automations.sql`.
It adds `agent_runs`, `chat_turns`, `user_memories`, `automations` and
`automation_runs` — all RLS-locked per user (the cron worker reads/writes
`automations`/`automation_runs` with the service-role key only).

### How unattended automations stay safe
An automation only ever pre-approves the exact consequential tools its
owner selected when creating it (`approved_tools`, shown as toggles in the
automation form). Nothing else is ever approved for a scheduled run — if
the saved goal tries a write that wasn't pre-approved, that step is blocked
exactly like it would be for a live chat with no one around to approve it,
and the run's history will show it as blocked rather than silently skipped.

### Trying it out
- **History**: every finished agent run and every chat turn is logged;
  search, review or delete any of them.
- **Memory** (Settings → Memory): short notes you save yourself; pin the
  ones you don't want cleared by "Clear unpinned".
- **Automations**: create one with a name, a goal, a schedule (hourly /
  daily / weekly) and (optionally) pre-approved tools, then either wait for
  the cron worker or tap "Run now" to see it execute immediately with the
  exact same code path.
