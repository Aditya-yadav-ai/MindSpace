/**
 * Stage 5 — Google OAuth 2.0 (Authorization Code + PKCE, offline access).
 *
 * No Google password ever reaches this app — the whole point of OAuth is
 * that the user authenticates with Google directly and we only ever handle
 * short-lived codes and long-lived tokens, both encrypted at rest
 * (see crypto.server.ts) and stored in tables only the service role can
 * read (see the Stage 5 migration). Client ID/secret come from environment
 * variables and are never hard-coded.
 */
import { randomBytes, createHash } from "node:crypto";

import { decryptToken, encryptToken } from "./crypto.server";
import { GoogleNotConnectedError, type GoogleConnectionStatus } from "./types";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

/** Minimum scopes for the three Stage 5 agents, plus identity to show which account is connected. */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/forms.body",
  "https://www.googleapis.com/auth/forms.responses.readonly",
  "https://www.googleapis.com/auth/meetings.space.created",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
  "https://www.googleapis.com/auth/chat.spaces.readonly",
  "https://www.googleapis.com/auth/chat.messages",
] as const;

const STATE_TTL_MS = 10 * 60 * 1000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Set it before using Google Sign-In.`);
  return value;
}

function base64url(buffer: Buffer) {
  return buffer.toString("base64url");
}

/* ------------------------------------------------------------------ */
/* Step 1 — build the consent URL and stash PKCE state server-side      */
/* ------------------------------------------------------------------ */

export async function createAuthorizationUrl(userId: string): Promise<string> {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const redirectUri = requireEnv("GOOGLE_REDIRECT_URI");

  const state = base64url(randomBytes(24));
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("google_oauth_states").insert({
    state,
    user_id: userId,
    code_verifier: codeVerifier,
    expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });
  if (error) throw new Error(`Could not start Google Sign-In: ${error.message}`);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/* ------------------------------------------------------------------ */
/* Step 2 — the redirect back from Google                              */
/* ------------------------------------------------------------------ */

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
};

/** Exchanges `code` for tokens and stores them. Returns the user id the flow belongs to. */
export async function completeAuthorization(code: string, state: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: stateRow, error: stateError } = await supabaseAdmin
    .from("google_oauth_states")
    .select("user_id,code_verifier,expires_at")
    .eq("state", state)
    .maybeSingle();
  if (stateError) throw new Error(`Could not verify Google Sign-In state: ${stateError.message}`);
  if (!stateRow) throw new Error("This Google Sign-In link is invalid or was already used.");
  if (new Date(stateRow.expires_at).getTime() < Date.now()) {
    await supabaseAdmin.from("google_oauth_states").delete().eq("state", state);
    throw new Error("This Google Sign-In link expired. Please try connecting again.");
  }

  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
  const redirectUri = requireEnv("GOOGLE_REDIRECT_URI");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: stateRow.code_verifier,
    }),
  });

  await supabaseAdmin.from("google_oauth_states").delete().eq("state", state);

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Google rejected the sign-in (${response.status}). ${detail.slice(0, 300)}`);
  }
  const tokens = (await response.json()) as TokenResponse;
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Remove MindSpace's access at myaccount.google.com/permissions and try connecting again.",
    );
  }

  let googleEmail: string | null = null;
  try {
    const info = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (info.ok) googleEmail = ((await info.json()) as { email?: string }).email ?? null;
  } catch {
    // Non-fatal — the connection still works without a displayed email.
  }

  const userId = stateRow.user_id as string;
  const { error: upsertError } = await supabaseAdmin.from("google_connections").upsert(
    {
      user_id: userId,
      google_email: googleEmail,
      scope: tokens.scope,
      encrypted_access_token: encryptToken(tokens.access_token),
      encrypted_refresh_token: encryptToken(tokens.refresh_token),
      access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (upsertError) throw new Error(`Could not save the Google connection: ${upsertError.message}`);

  return userId;
}

/* ------------------------------------------------------------------ */
/* Step 3 — using and refreshing the connection                        */
/* ------------------------------------------------------------------ */

const EXPIRY_SKEW_MS = 60_000;

async function refreshAccessToken(userId: string, refreshToken: string) {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Could not refresh the Google connection (${response.status}). ${detail.slice(0, 300)}`,
    );
  }
  const tokens = (await response.json()) as Omit<TokenResponse, "refresh_token">;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("google_connections")
    .update({
      encrypted_access_token: encryptToken(tokens.access_token),
      access_token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) throw new Error(`Could not save the refreshed Google token: ${error.message}`);

  return tokens.access_token;
}

/** Returns a live access token for `userId`, refreshing it first if needed. Throws GoogleNotConnectedError if there is no connection. */
export async function getValidAccessToken(userId: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("google_connections")
    .select("encrypted_access_token,encrypted_refresh_token,access_token_expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the Google connection: ${error.message}`);
  if (!data) throw new GoogleNotConnectedError();

  const expiresAt = new Date(data.access_token_expires_at).getTime();
  if (Number.isFinite(expiresAt) && expiresAt - EXPIRY_SKEW_MS > Date.now()) {
    return decryptToken(data.encrypted_access_token);
  }
  return refreshAccessToken(userId, decryptToken(data.encrypted_refresh_token));
}

export async function getConnectionStatus(userId: string): Promise<GoogleConnectionStatus> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("google_connections")
    .select("google_email,scope,access_token_expires_at,created_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the Google connection: ${error.message}`);
  if (!data) return { connected: false };
  return {
    connected: true,
    googleEmail: data.google_email,
    scope: data.scope ? data.scope.split(" ").filter(Boolean) : [],
    connectedAt: data.created_at,
    expiresSoon: new Date(data.access_token_expires_at).getTime() - EXPIRY_SKEW_MS <= Date.now(),
  };
}

/** Revokes the token with Google (best-effort) and deletes the stored connection. */
export async function disconnectGoogle(userId: string): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("google_connections")
    .select("encrypted_refresh_token")
    .eq("user_id", userId)
    .maybeSingle();

  if (data?.encrypted_refresh_token) {
    try {
      await fetch(REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: decryptToken(data.encrypted_refresh_token) }),
      });
    } catch {
      // Best-effort — we still remove our own copy below even if Google's
      // revoke endpoint is unreachable.
    }
  }

  const { error } = await supabaseAdmin.from("google_connections").delete().eq("user_id", userId);
  if (error) throw new Error(`Could not disconnect Google: ${error.message}`);
}
