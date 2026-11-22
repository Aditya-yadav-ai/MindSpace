# MindSpace Stage 8 — Google Services Integration Matrix & Architecture Guide

> **Scope:** Comprehensive audit and architectural reference for all **14 officially supported Google services** in MindSpace.  
> **Exclusions:** Google Keep and Google Photos are **EXPLICITLY EXCLUDED** from MindSpace architecture, agents, tools, and user interface.

---

## 1. Google Services Integration Matrix

| Service                  | API & Endpoint                                                 | Implemented Operations                                                                                                                                                                                                                                                          | OAuth Scopes / Auth Mode                                                                 | Credentials Required                                                            | Status                                                                                                                          |
| :----------------------- | :------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------ |
| **1. Gmail**             | Gmail REST API v1<br/>`gmail.googleapis.com/gmail/v1`          | • List recent emails<br/>• Search emails by query<br/>• Draft messages (approval gated)<br/>• Read message snippets and headers                                                                                                                                                 | `gmail.readonly`<br/>`gmail.compose`                                                     | `GOOGLE_CLIENT_ID`<br/>`GOOGLE_CLIENT_SECRET`<br/>`GOOGLE_TOKEN_ENCRYPTION_KEY` | **Requires external credentials**<br/>_(Restricted scope; CASA tier-2 / app verification required for public distribution)_     |
| **2. Google Calendar**   | Calendar REST API v3<br/>`calendar.googleapis.com/calendar/v3` | • List upcoming calendar events<br/>• Create scheduled events (approval gated)<br/>• Inspect start/end times and locations                                                                                                                                                      | `calendar.events`                                                                        | `GOOGLE_CLIENT_ID`<br/>`GOOGLE_CLIENT_SECRET`<br/>`GOOGLE_TOKEN_ENCRYPTION_KEY` | **Requires external credentials**<br/>_(Sensitive scope; functional in Test Users mode; fully mock tested)_                     |
| **3. Google Drive**      | Drive REST API v3<br/>`drive.googleapis.com/drive/v3`          | • Search user files<br/>• Save text notes to Drive (approval gated)<br/>• Retrieve file metadata and web links                                                                                                                                                                  | `drive.file`                                                                             | `GOOGLE_CLIENT_ID`<br/>`GOOGLE_CLIENT_SECRET`<br/>`GOOGLE_TOKEN_ENCRYPTION_KEY` | **Requires external credentials**<br/>_(Least-privilege per-file scope; does not require CASA audit)_                           |
| **4. Google Docs**       | Docs REST API v1<br/>`docs.googleapis.com/v1`                  | • Read document text and headings<br/>• Create new documents (approval gated)<br/>• Extract structured outlines                                                                                                                                                                 | `documents`                                                                              | `GOOGLE_CLIENT_ID`<br/>`GOOGLE_CLIENT_SECRET`<br/>`GOOGLE_TOKEN_ENCRYPTION_KEY` | **Requires external credentials**<br/>_(Sensitive scope; fully tested)_                                                         |
| **5. Google Sheets**     | Sheets REST API v4<br/>`sheets.googleapis.com/v4`              | • Read spreadsheet cell ranges<br/>• Create spreadsheets (approval gated)<br/>• Append rows and records (approval gated)                                                                                                                                                        | `spreadsheets`                                                                           | `GOOGLE_CLIENT_ID`<br/>`GOOGLE_CLIENT_SECRET`<br/>`GOOGLE_TOKEN_ENCRYPTION_KEY` | **Requires external credentials**<br/>_(Sensitive scope; fully tested)_                                                         |
| **6. Google Slides**     | Slides REST API v1<br/>`slides.googleapis.com/v1`              | • Read presentation outlines & slide count<br/>• Create presentations (approval gated)<br/>• Draft presentation decks                                                                                                                                                           | `presentations`                                                                          | `GOOGLE_CLIENT_ID`<br/>`GOOGLE_CLIENT_SECRET`<br/>`GOOGLE_TOKEN_ENCRYPTION_KEY` | **Requires external credentials**<br/>_(Sensitive scope; fully tested)_                                                         |
| **7. Google Meet**       | Meet REST API v2<br/>`meet.googleapis.com/v2`                  | • Create meeting spaces (approval gated)<br/>• Generate instant meeting links<br/>• Retrieve meeting space details<br/>• List conference records<br/>• Inspect conference participants                                                                                          | `meetings.space.created`<br/>`meetings.space.readonly`                                   | `GOOGLE_CLIENT_ID`<br/>`GOOGLE_CLIENT_SECRET`<br/>`GOOGLE_TOKEN_ENCRYPTION_KEY` | **Requires external credentials**<br/>_(Requires Workspace edition supporting Meet API v2; fully tested)_                       |
| **8. Google Forms**      | Forms REST API v1<br/>`forms.googleapis.com/v1`                | • Create survey forms (approval gated)<br/>• Retrieve form schema and questions<br/>• List submitted form responses<br/>• Generate response summaries                                                                                                                           | `forms.body`<br/>`forms.responses.readonly`                                              | `GOOGLE_CLIENT_ID`<br/>`GOOGLE_CLIENT_SECRET`<br/>`GOOGLE_TOKEN_ENCRYPTION_KEY` | **Requires external credentials**<br/>_(Sensitive scope; fully tested)_                                                         |
| **9. Google Tasks**      | Tasks REST API v1<br/>`tasks.googleapis.com/tasks/v1`          | • List task lists<br/>• Create task lists (approval gated)<br/>• List pending and completed tasks<br/>• Create tasks with due dates (approval gated)<br/>• Update task details (approval gated)<br/>• Mark tasks completed (approval gated)<br/>• Delete tasks (approval gated) | `tasks`                                                                                  | `GOOGLE_CLIENT_ID`<br/>`GOOGLE_CLIENT_SECRET`<br/>`GOOGLE_TOKEN_ENCRYPTION_KEY` | **Requires external credentials**<br/>_(Sensitive scope; fully tested)_                                                         |
| **10. Google Contacts**  | People REST API v1<br/>`people.googleapis.com/v1`              | • List connections and contacts<br/>• Search contacts by name or email<br/>• Retrieve contact profile details<br/>• Create contacts (approval gated)<br/>• Update contacts (approval gated)<br/>• Delete contacts (approval gated)                                              | `contacts`<br/>`contacts.readonly`                                                       | `GOOGLE_CLIENT_ID`<br/>`GOOGLE_CLIENT_SECRET`<br/>`GOOGLE_TOKEN_ENCRYPTION_KEY` | **Requires external credentials**<br/>_(Sensitive scope; requires app verification for public access; fully tested)_            |
| **11. Google Chat**      | Chat REST API v1<br/>`chat.googleapis.com/v1`                  | • List accessible spaces<br/>• Retrieve space details<br/>• List recent messages<br/>• Send messages (approval gated)<br/>• Create spaces (approval gated)<br/>• Inspect space memberships                                                                                      | `chat.spaces.readonly`<br/>`chat.messages`<br/>`chat.memberships.readonly`               | `GOOGLE_CLIENT_ID`<br/>`GOOGLE_CLIENT_SECRET`<br/>`GOOGLE_TOKEN_ENCRYPTION_KEY` | **Requires Google approval**<br/>_(Requires configuring a Google Cloud Chat App and workspace admin authorization)_             |
| **12. Google Maps**      | Google Maps Platform<br/>`maps.googleapis.com/maps/api`        | • Search places and points of interest<br/>• Retrieve place details and ratings<br/>• Geocode addresses to coordinates<br/>• Reverse geocode coordinates to address<br/>• Calculate distance & travel duration<br/>• Get turn-by-turn route directions                          | None (Server-to-Server Backend Key)                                                      | `GOOGLE_MAPS_API_KEY`                                                           | **Requires external credentials**<br/>_(Backend-controlled API key; never leaked to frontend/side panel; fully tested)_         |
| **13. Google Classroom** | Classroom REST API v1<br/>`classroom.googleapis.com/v1`        | • List active courses<br/>• Retrieve course details<br/>• List coursework & assignments<br/>• List announcements<br/>• Inspect student submissions<br/>• Create announcements (approval gated)<br/>• Create coursework (approval gated)                                         | `classroom.courses.readonly`<br/>`classroom.coursework.me`<br/>`classroom.announcements` | `GOOGLE_CLIENT_ID`<br/>`GOOGLE_CLIENT_SECRET`<br/>`GOOGLE_TOKEN_ENCRYPTION_KEY` | **Requires external credentials**<br/>_(Requires Google Workspace for Education account or test users; fully tested)_           |
| **14. YouTube**          | YouTube Data API v3<br/>`www.googleapis.com/youtube/v3`        | • Search educational videos<br/>• Retrieve video details and statistics<br/>• Inspect channel information<br/>• List playlists and playlist items<br/>• Create playlists (approval gated)                                                                                       | `youtube.readonly`<br/>`youtube`                                                         | `GOOGLE_CLIENT_ID`<br/>`GOOGLE_CLIENT_SECRET`<br/>`GOOGLE_TOKEN_ENCRYPTION_KEY` | **Requires Google approval**<br/>_(Sensitive scope; standard 10,000 unit/day default quota; audit required for quota increase)_ |

---

## 2. Explicit Exclusions

> [!IMPORTANT]
> **Google Keep** and **Google Photos** are **EXPLICITLY EXCLUDED** from MindSpace.
>
> - **Google Keep**: The Enterprise Keep API requires Google Workspace Enterprise editions with domain-wide service delegation. It does not provide standard OAuth 2.0 consumer user endpoints.
> - **Google Photos**: Excluded by design to maintain strict enterprise research focus and avoid photo ingestion overhead.
>
> Automated contract tests in `src/lib/google/__tests__/adapters.test.mjs` explicitly assert that neither service is registered in capabilities, tool registries, or dashboard components.

---

## 3. Architecture & Security Implementation

### 3.1 Cryptographic Token Encryption at Rest

All OAuth access tokens and refresh tokens received from Google are encrypted at rest using **AES-256-GCM** with unique 12-byte initialization vectors (IVs) and 16-byte authentication tags:

- Implementation: `src/lib/google/crypto.server.ts`
- Cipher: `aes-256-gcm`
- Secret Key: 32-byte hex string configured in `GOOGLE_TOKEN_ENCRYPTION_KEY`.
- Storage: Stored strictly in the `google_connections` table accessible solely by backend server functions.

### 3.2 Consequential Action Safety Gates

All mutating and external side-effect operations are strictly flagged with `requiresConfirmation: true`:

- Tool Registry: `src/lib/agents/google-tools.ts` and `src/lib/agents/google-extended-tools.ts`
- Verifier Guard: `src/lib/agents/verifier.ts`
- When an agent or automation pipeline attempts to create a document, send a chat message, schedule a meeting, create a task, or publish an announcement, MindSpace blocks execution until the user explicitly reviews the payload and clicks **Approve** in the Side Panel UI.

### 3.3 Server-Side Google Maps Isolation

Unlike typical web applications that leak `GOOGLE_MAPS_API_KEY` into browser bundle HTML, MindSpace enforces server-side isolation:

- Adapter: `src/lib/google/maps.server.ts`
- The extension and frontend talk exclusively to TanStack server functions or FastAPI proxy endpoints.
- The Maps API key is never serialized or dispatched to client browsers.

### 3.4 Incremental Authorization & Least Privilege

MindSpace supports granular incremental authorization:

- Implementation: `src/lib/google/oauth.server.ts` (`createAuthorizationUrl(userId, customScopes)`)
- Users can authenticate with minimal profile scopes, and authorize individual services (e.g., Tasks, Classroom, YouTube) on-demand through the Connected Accounts dashboard.

---

## 4. Setup Guide for Operators

### Step 1: Google Cloud Project Configuration

1. Navigate to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project named `MindSpace-Assistant`.
3. Enable the required APIs under **APIs & Services > Library**:
   - Google Calendar API
   - Gmail API
   - Google Drive API
   - Google Docs API
   - Google Sheets API
   - Google Slides API
   - Google Meet API
   - Google Forms API
   - Tasks API
   - People API (Google Contacts)
   - Google Chat API
   - Google Classroom API
   - YouTube Data API v3
   - Geocoding API, Places API, Distance Matrix API, Directions API (Google Maps Platform)

### Step 2: OAuth Consent Screen Setup

1. Go to **APIs & Services > OAuth consent screen**.
2. Select **External** (or **Internal** if within a Google Workspace organization).
3. Set App Name to `MindSpace Browser Assistant` and specify support email.
4. **Publishing Status**:
   - For local development and demonstration: Keep in **Testing** status.
   - Add tester Google accounts under **Test users**. While in testing status, only added test users can grant OAuth consent.

### Step 3: OAuth 2.0 Web Application Credentials

1. Go to **APIs & Services > Credentials** > **Create Credentials** > **OAuth client ID**.
2. Select Application type: **Web application**.
3. Configure Authorized JavaScript origins:
   - `http://localhost:8080`
   - `http://localhost:3000`
4. Configure Authorized redirect URIs:
   - `http://localhost:3000/api/google/oauth-callback`
   - `http://localhost:8080/api/google/oauth-callback`
5. Copy the generated **Client ID** and **Client Secret** into your `.env` file:
   ```env
   GOOGLE_CLIENT_ID="xxxx.apps.googleusercontent.com"
   GOOGLE_CLIENT_SECRET="yyyy"
   GOOGLE_REDIRECT_URI="http://localhost:3000/api/google/oauth-callback"
   ```

### Step 4: Google Maps Platform API Key

1. In Credentials, click **Create Credentials > API key**.
2. Click **Edit API key**:
   - Set **Application restrictions** to `IP addresses` (point to your production backend servers).
   - Set **API restrictions** to: _Places API_, _Geocoding API_, _Distance Matrix API_, _Directions API_.
3. Add key to `.env`:
   ```env
   GOOGLE_MAPS_API_KEY="AIzaSy..."
   ```

### Step 5: Token Encryption Key Generation

Generate a cryptographically secure 256-bit AES key:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set in `.env`:

```env
GOOGLE_TOKEN_ENCRYPTION_KEY="<64-hex-character-key>"
```

---

## 5. Google Production Verification Requirements

When moving beyond **Test Users** mode to public distribution:

1. **Restricted Scopes (Gmail `compose`, `readonly`)**:
   - Requires Cloud Application Security Assessment (CASA) Tier-2 review.
   - Requires annual third-party penetration testing and Letter of Assessment (LOA).
2. **Sensitive Scopes (Calendar, Drive, Contacts, Tasks, Docs, Sheets, Classroom, YouTube)**:
   - Requires submission of YouTube video walkthrough demonstrating why each scope is required.
   - Requires publicly accessible Privacy Policy explaining data retention, encryption, and zero-resale policy.
   - Domain verification via Google Search Console.
3. **Google Chat API**:
   - Requires configuring Google Cloud Chat app settings (avatar, display name, interactive commands).
4. **YouTube Data API v3**:
   - Standard quota is 10,000 units/day. Applications requiring larger search volumes must submit the YouTube Quota Extension Audit form.

---

## 6. Offline-First Verification & Fallback Behavior

When external credentials are absent or network is disconnected:

- Every adapter gracefully fails closed with `GoogleNotConnectedError`.
- Side Panel displays standard connection badges with setup instructions and scope definitions.
- Local multi-agent simulations operate using deterministic offline data with transparent `[SIMULATED]` provenance markings.
