/**
 * Stage 5 & 8 — Google's OAuth redirect target and extension coordination endpoint.
 *
 * Handles:
 * 1. GET with ?action=url: returns server PKCE-backed Google consent URL.
 * 2. GET with ?action=status: returns current Google connection status.
 * 3. GET with ?action=disconnect: disconnects Google and revokes tokens.
 * 4. GET with ?code=&state=: completes OAuth authorization code exchange.
 * 5. OPTIONS: responds with CORS headers for extension client access.
 */
import { createFileRoute } from "@tanstack/react-router";

function redirectToApp(status: "connected" | "error", detail?: string) {
  const params = new URLSearchParams({ view: "accounts", google: status });
  if (detail) params.set("detail", detail.slice(0, 300));
  return new Response(null, { status: 302, headers: { Location: `/?${params.toString()}` } });
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

export const Route = createFileRoute("/api/google/oauth-callback")({
  server: {
    handlers: {
      OPTIONS: async () => {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      },
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const action = url.searchParams.get("action");

        // Action 1: Extension or client requests a Google Auth URL
        if (action === "url") {
          try {
            const userId = url.searchParams.get("userId") || "local-user";
            const email = url.searchParams.get("email") || undefined;
            const scopesParam = url.searchParams.get("scopes");
            const scopes = scopesParam ? scopesParam.split(",").filter(Boolean) : undefined;
            const { createAuthorizationUrl } = await import("@/lib/google/oauth.server");
            const authUrl = await createAuthorizationUrl(userId, scopes, email);
            return new Response(JSON.stringify({ url: authUrl }), {
              status: 200,
              headers: { "Content-Type": "application/json", ...CORS_HEADERS },
            });
          } catch (err) {
            return new Response(
              JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
              { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
            );
          }
        }

        // Action 2: Extension or client requests connection status
        if (action === "status") {
          try {
            const userId = url.searchParams.get("userId") || "local-user";
            const { getConnectionStatus } = await import("@/lib/google/oauth.server");
            const status = await getConnectionStatus(userId);
            return new Response(JSON.stringify(status), {
              status: 200,
              headers: { "Content-Type": "application/json", ...CORS_HEADERS },
            });
          } catch (err) {
            return new Response(
              JSON.stringify({
                connected: false,
                error: err instanceof Error ? err.message : String(err),
              }),
              { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
            );
          }
        }

        // Action 3: Extension or client requests disconnect
        if (action === "disconnect") {
          try {
            const userId = url.searchParams.get("userId") || "local-user";
            const { disconnectGoogle } = await import("@/lib/google/oauth.server");
            await disconnectGoogle(userId);
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { "Content-Type": "application/json", ...CORS_HEADERS },
            });
          } catch (err) {
            return new Response(
              JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
              { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
            );
          }
        }

        // Standard Google OAuth Callback:
        const error = url.searchParams.get("error");
        if (error) return redirectToApp("error", error);

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) return redirectToApp("error", "missing_code_or_state");

        try {
          const { completeAuthorization } = await import("@/lib/google/oauth.server");
          await completeAuthorization(code, state);
          return redirectToApp("connected");
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "unknown_error";
          return redirectToApp("error", message);
        }
      },
    },
  },
});
