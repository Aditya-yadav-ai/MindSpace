# MindSpace Browser Extension Setup & Verification Guide

This guide walks through loading, testing, and operating the MindSpace Manifest V3 browser extension in Google Chrome or Microsoft Edge.

---

## 1. Prerequisites

1. **Google Chrome** (v116+ required for Chrome Side Panel API; v130+ recommended).
2. **MindSpace Python Service**:
   ```bash
   cd apps/api
   .\.venv312\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
   ```
   _Verify service readiness:_ `curl http://127.0.0.1:8000/ready`
3. **MindSpace Frontend App** (optional for standalone web dashboard):
   ```bash
   npm run build
   # or dev mode: npm run dev
   ```

---

## 2. Load Unpacked Extension in Chrome

1. Open Google Chrome.
2. Navigate to `chrome://extensions` in the omnibox.
3. Toggle **Developer mode** ON (switch in the top-right corner).
4. Click the **Load unpacked** button in the top-left toolbar.
5. In the file picker, select the `public` directory inside the project:
   ```text
   C:\Users\aadin\Downloads\Telegram Desktop\mindspace-stage8\mindspace-stage8\public
   ```
6. Confirm **MindSpace** (v0.3.0) appears in your extensions list with:
   - Manifest V3 badge
   - Permissions: `sidePanel`, `storage`, `activeTab`, `scripting`
   - Host permissions: `http://127.0.0.1:8000/*`, `http://localhost:8000/*`
   - Background service worker: `extension-background.js` (inspectable via "Inspect views: service worker")

---

## 3. Verify Keyboard Shortcut (`Alt+B`)

1. Open `chrome://extensions/shortcuts` in Chrome.
2. Locate the **MindSpace** section.
3. Verify that **"Capture screen and activate MindSpace AI assistant"** is bound to `Alt+B`.
   _(You can customize this shortcut here if desired)._

---

## 4. End-to-End Functional Test

1. Navigate to any standard website (e.g., `https://news.ycombinator.com` or `https://docs.github.com`).
   _(Note: Browser-internal pages such as `chrome://`, `about:`, and `edge://` are restricted by browser security policies and will safely notify the user without throwing exceptions)._
2. Press **Alt+B** on your keyboard:
   - The MindSpace Side Panel opens automatically on the right-hand side.
   - The current tab's visible viewport is captured via `chrome.tabs.captureVisibleTab`.
   - The screenshot preview appears immediately in `#screenshotPreview` / `#screenshotImg`.
   - The captured payload is securely sent to `http://127.0.0.1:8000/v1/screenshot`.
   - The **Vision Agent** inspects the image (dimensions, theme, luminance, layout topology) and multimodal semantics.
   - The detected layout badge updates (e.g. `workspace_document`, `article`, `calendar_schedule`).
3. In the side panel:
   - Click **Summarize** to generate an extractive or model-backed summary of the captured context.
   - Click **Extract** to extract dates, emails, amounts, and URLs.
   - Click **Explain** to receive an analysis of the page's thesis.

---

## 5. Google Workspace Integration Setup

To connect real Google Workspace services (Calendar, Gmail, Drive, Docs, Sheets, Slides, Forms, Meet, Classroom, Chat):

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Create an **OAuth 2.0 Client ID** (Web application).
3. Add Authorized Redirect URI:
   ```text
   http://localhost:3000/api/google/oauth-callback
   ```
4. Enable the relevant Google Workspace APIs in your GCP project.
5. Generate a 32-byte encryption key for token protection at rest:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
6. Copy `.env.example` to `.env` and fill in:
   ```env
   GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
   GOOGLE_CLIENT_SECRET="your-client-secret"
   GOOGLE_REDIRECT_URI="http://localhost:3000/api/google/oauth-callback"
   GOOGLE_TOKEN_ENCRYPTION_KEY="your-64-character-hex-key"
   ```
7. Start the MindSpace web server and connect your Google account in **Connected Accounts**.
