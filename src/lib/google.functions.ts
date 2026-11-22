/**
 * Stage 5 — Connected Services server functions.
 * `getGoogleAuthUrl` starts the OAuth flow; the browser is sent to Google
 * directly (`window.location.href = url`), and Google redirects back to the
 * `/api/google/oauth-callback` route (see that file), not through this
 * function. Status and disconnect never touch tokens — only metadata.
 */
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { GoogleConnectionStatus } from "@/lib/google/types";

export const getGoogleAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { scopes?: string[] } | undefined) => d ?? {})
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const { createAuthorizationUrl } = await import("@/lib/google/oauth.server");
    return { url: await createAuthorizationUrl(context.userId, data?.scopes, context.email) };
  });

export const getGoogleStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GoogleConnectionStatus> => {
    const { getConnectionStatus } = await import("@/lib/google/oauth.server");
    return getConnectionStatus(context.userId);
  });

export const disconnectGoogleAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    const { disconnectGoogle } = await import("@/lib/google/oauth.server");
    await disconnectGoogle(context.userId);
    return { ok: true };
  });
