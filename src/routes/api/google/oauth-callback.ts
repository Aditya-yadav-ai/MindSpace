/**
 * Stage 5 — Google's OAuth redirect target. This is a plain GET the
 * browser navigates to, so it carries no Authorization header; the
 * `state` value (created and stored server-side in `createAuthorizationUrl`)
 * is what ties the request back to the user who started the flow — the
 * standard OAuth pattern, not a bearer-token check.
 */
import { createFileRoute } from "@tanstack/react-router";

function redirectToApp(status: "connected" | "error", detail?: string) {
  const params = new URLSearchParams({ view: "accounts", google: status });
  if (detail) params.set("detail", detail.slice(0, 300));
  return new Response(null, { status: 302, headers: { Location: `/?${params.toString()}` } });
}

export const Route = createFileRoute("/api/google/oauth-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
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
