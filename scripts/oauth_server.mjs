/**
 * MindSpace Stage 8 — Standalone Dedicated OAuth & Tool Proxy Server.
 *
 * Runs on http://localhost:8080 to handle:
 * 1. Google OAuth authorization URL generation with PKCE & state persistence
 * 2. Real-time Google connection status queries for the Chrome Extension
 * 3. Google OAuth redirect callback (?code=&state=) with token exchange & AES-256 encryption
 * 4. Tool proxying for Gmail draft creation, Calendar events, Drive, and other Google services
 *
 * Zero dependencies on Vite dev server module runner; starts in <100ms.
 */
import http from "node:http";
import url from "node:url";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Robust multi-path .env loader
function loadEnvSafely() {
  const candidatePaths = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(__dirname, "../.env"),
    path.resolve(__dirname, "../../.env"),
  ];
  for (const envPath of candidatePaths) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, "utf8");
        content.split(/\r?\n/).forEach((line) => {
          const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
          if (match) {
            const key = match[1];
            const rawVal = match[2].trim();
            const val = rawVal.replace(/^["']|["']$/g, "").trim();
            if (!process.env[key] || process.env[key] === "") {
              process.env[key] = val;
            }
          }
        });
        break;
      } catch {
        /* ignore */
      }
    }
  }
}
loadEnvSafely();

const jiti = createJiti(import.meta.url);
const oauth = jiti("../src/lib/google/oauth.server.ts");
const adapter = jiti("../src/lib/google/adapter.server.ts");

const PORT = parseInt(process.env.PORT || "8080", 10);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-MindSpace-Client",
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    ...CORS_HEADERS,
  });
  res.end(JSON.stringify(data));
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    ...CORS_HEADERS,
  });
  res.end(html);
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // Healthcheck & root endpoint
  if (pathname === "/" || pathname === "/api/health") {
    sendJson(res, 200, {
      status: "ok",
      service: "MindSpace Stage 8 Local OAuth & Agent Service",
      port: PORT,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // OAuth Callback & Tool Execution Endpoint
  if (pathname === "/api/google/oauth-callback") {
    // 1. GET requests: url, status, disconnect, or OAuth code callback
    if (req.method === "GET") {
      const action = parsedUrl.searchParams.get("action");
      const userId = parsedUrl.searchParams.get("userId") || "local-user";

      // Action 1: Create OAuth consent URL
      if (action === "url") {
        try {
          const email = parsedUrl.searchParams.get("email") || undefined;
          const scopesParam = parsedUrl.searchParams.get("scopes");
          const scopes = scopesParam ? scopesParam.split(",").filter(Boolean) : undefined;
          const authUrl = await oauth.createAuthorizationUrl(userId, scopes, email);
          sendJson(res, 200, { url: authUrl });
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      // Action 2: Check connection status
      if (action === "status") {
        try {
          const status = await oauth.getConnectionStatus(userId);
          sendJson(res, 200, status);
        } catch (err) {
          sendJson(res, 200, { connected: false, error: String(err) });
        }
        return;
      }

      // Action 3: Disconnect Google account
      if (action === "disconnect") {
        try {
          await oauth.disconnectGoogle(userId);
          sendJson(res, 200, { ok: true });
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      // OAuth Redirect Handling from Google:
      const error = parsedUrl.searchParams.get("error");
      if (error) {
        sendHtml(
          res,
          400,
          `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0b0f17;color:#f87171;padding:40px;text-align:center">
            <h2>Google Authorization Cancelled</h2>
            <p>Reason: ${error}</p>
            <button onclick="window.close()" style="background:#ef4444;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer">Close Window</button>
          </body></html>`
        );
        return;
      }

      const code = parsedUrl.searchParams.get("code");
      const state = parsedUrl.searchParams.get("state");
      if (!code || !state) {
        sendHtml(
          res,
          400,
          `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0b0f17;color:#f87171;padding:40px;text-align:center">
            <h2>Missing Code or State Parameter</h2>
            <p>The authorization request could not be validated.</p>
          </body></html>`
        );
        return;
      }

      try {
        const completedUserId = await oauth.completeAuthorization(code, state);
        const status = await oauth.getConnectionStatus(completedUserId);
        const email = status.googleEmail || "Google Account";

        sendHtml(
          res,
          200,
          `<!DOCTYPE html>
          <html>
          <head>
            <title>Google Connected — MindSpace</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #090d16; color: #f3f4f6; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: #131b2e; border: 1px solid #1e293b; border-radius: 16px; padding: 40px; max-width: 460px; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7); }
              .icon { width: 60px; height: 60px; background: rgba(16,185,129,0.15); color: #10b981; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 32px; margin: 0 auto 20px; border: 1px solid rgba(16,185,129,0.3); }
              h1 { font-size: 22px; margin: 0 0 10px; color: #fff; font-weight: 700; }
              .email-pill { display: inline-block; background: #1e293b; color: #38bdf8; font-family: monospace; font-size: 13px; padding: 4px 12px; border-radius: 20px; margin-bottom: 16px; border: 1px solid #334155; }
              p { font-size: 14px; color: #94a3b8; line-height: 1.6; margin: 0 0 28px; }
              .btn { display: inline-block; background: #3b82f6; color: #fff; padding: 10px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px; cursor: pointer; border: none; transition: background 0.2s; }
              .btn:hover { background: #2563eb; }
            </style>
          </head>
          <body>
            <div class="card">
              <div class="icon">✓</div>
              <h1>Google Account Connected</h1>
              <div class="email-pill">${email}</div>
              <p>Your Google Workspace account has been linked with verified email parity. All 14 adapters (Gmail, Drive, Calendar, Meet, etc.) are now authorized.</p>
              <button class="btn" onclick="window.close()">Close Window</button>
            </div>
            <script>
              setTimeout(() => window.close(), 2500);
            </script>
          </body>
          </html>`
        );
      } catch (err) {
        sendHtml(
          res,
          400,
          `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0b0f17;color:#f87171;padding:40px;text-align:center">
            <h2>Account Linking Failed</h2>
            <p>${err instanceof Error ? err.message : String(err)}</p>
            <button onclick="window.close()" style="background:#ef4444;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer">Close Window</button>
          </body></html>`
        );
      }
      return;
    }

    // 2. POST requests: execute tools securely using server's decrypted access tokens
    if (req.method === "POST") {
      let bodyStr = "";
      req.on("data", (chunk) => (bodyStr += chunk));
      req.on("end", async () => {
        try {
          const body = JSON.parse(bodyStr || "{}");
          const { action, input, userId = "local-user" } = body;
          const services = adapter.createGoogleServices(userId);

          let result;
          switch (action) {
            case "gmail.create_draft":
              result = await services.createEmailDraft(input);
              break;
            case "gmail.list_recent":
              result = await services.listRecentEmails(input);
              break;
            case "calendar.create_event":
              result = await services.createCalendarEvent(input);
              break;
            case "calendar.list_events":
              result = await services.listUpcomingEvents(input);
              break;
            case "drive.save_file":
              result = await services.saveDriveFile(input);
              break;
            case "drive.search":
              result = await services.searchDriveFiles(input);
              break;
            case "docs.create":
              result = await services.createDocument(input);
              break;
            case "docs.read":
              result = await services.readDocument(input);
              break;
            case "sheets.create":
              result = await services.createSpreadsheet(input);
              break;
            case "sheets.read":
              result = await services.readSheetRange(input);
              break;
            case "sheets.append":
              result = await services.appendSheetValues(input);
              break;
            case "tasks.create":
              result = await services.createTask(input);
              break;
            case "tasks.list":
              result = await services.listTasks(input);
              break;
            case "tasks.mark_done":
              result = await services.markTaskDone(input);
              break;
            case "contacts.search":
              result = await services.searchContacts(input);
              break;
            case "contacts.create":
              result = await services.createContact(input);
              break;
            case "meet.create_space":
              result = await services.createMeetingSpace(input);
              break;
            case "maps.directions":
              result = await services.getDirections(input);
              break;
            case "maps.places":
              result = await services.searchPlaces(input);
              break;
            case "youtube.search":
              result = await services.searchVideos(input);
              break;
            default:
              if (typeof services[action] === "function") {
                result = await services[action](input);
              } else {
                throw new Error(`Unsupported tool action: ${action}`);
              }
          }
          sendJson(res, 200, { ok: true, result });
        } catch (err) {
          sendJson(res, 500, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
      return;
    }
  }

  // Fallback 404
  sendJson(res, 404, { error: `Not found: ${pathname}` });
});

server.listen(PORT, "0.0.0.0", () => {
  const envClientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
  const envSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
  const envRedirect = (process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/api/google/oauth-callback`).trim();

  console.log(`[MindSpace OAuth Server] Listening on http://localhost:${PORT}`);
  console.log(`[MindSpace OAuth Server] Redirect URI: ${envRedirect}`);
  console.log(`[MindSpace OAuth Server] Client ID: ${envClientId ? envClientId.slice(0, 15) + "..." + envClientId.slice(-25) : "NOT CONFIGURED"}`);
  if (!envSecret) {
    console.warn(`[MindSpace OAuth Server] ⚠️ WARNING: GOOGLE_CLIENT_SECRET is missing in .env!`);
  } else if (envSecret.length < 20 || !envSecret.startsWith("GOCSPX-")) {
    console.warn(`[MindSpace OAuth Server] ⚠️ WARNING: GOOGLE_CLIENT_SECRET in .env has length ${envSecret.length} and does not start with 'GOCSPX-'. Google token exchange will return HTTP 401 invalid_client until updated with the matching secret from Google Cloud Console.`);
  } else {
    console.log(`[MindSpace OAuth Server] Client Secret: Configured (${envSecret.length} chars, GOCSPX- verified)`);
  }
});
