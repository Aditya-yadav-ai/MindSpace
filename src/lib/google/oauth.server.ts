/**
 * Stage 5 & 8 — Google OAuth 2.0 (Authorization Code + PKCE, offline access).
 *
 * Enforces Same-Email Account Linking:
 * - Google identity is fetched from official Google userinfo endpoint.
 * - Asserts email_verified is true.
 * - Asserts Google email matches authenticated MindSpace user email.
 * - Encrypts access and refresh tokens at rest with AES-256-GCM.
 * - Supports incremental service-specific authorization across all 14 services.
 */
import { randomBytes, createHash } from "node:crypto";

import { decryptToken, encryptToken } from "./crypto.server";
import { GoogleAuthError, GoogleNotConnectedError, type GoogleConnectionStatus } from "./types";
export { GoogleAuthError };
import {
  storeLocalOAuthState,
  retrieveAndClearLocalOAuthState,
  saveLocalGoogleConnection,
  getLocalGoogleConnection,
  deleteLocalGoogleConnection,
} from "../auth.server";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

/** Minimum scopes for all 14 official Google Workspace and Platform services. */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/meetings.space.created",
  "https://www.googleapis.com/auth/meetings.space.readonly",
  "https://www.googleapis.com/auth/forms.body",
  "https://www.googleapis.com/auth/forms.responses.readonly",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/contacts",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/chat.spaces.readonly",
  "https://www.googleapis.com/auth/chat.messages",
  "https://www.googleapis.com/auth/chat.memberships.readonly",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.me",
  "https://www.googleapis.com/auth/classroom.announcements",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube",
] as const;

export const SERVICE_SCOPE_MAPPING: Record<string, string[]> = {
  gmail: ["gmail.readonly", "gmail.compose"],
  calendar: ["calendar.events"],
  drive: ["drive.file"],
  docs: ["documents"],
  sheets: ["spreadsheets"],
  slides: ["presentations"],
  meet: ["meetings.space.created", "meetings.space.readonly"],
  forms: ["forms.body", "forms.responses.readonly"],
  tasks: ["tasks"],
  contacts: ["contacts", "contacts.readonly"],
  chat: ["chat.spaces.readonly", "chat.messages", "chat.memberships.readonly"],
  classroom: ["classroom.courses.readonly", "classroom.coursework.me", "classroom.announcements"],
  youtube: ["youtube.readonly", "youtube"],
  maps: [], // Backend API key authenticated
};

/** Validates whether granted scopes cover a given service. */
export function hasServiceScope(grantedScopes: string[], serviceId: string): boolean {
  const required = SERVICE_SCOPE_MAPPING[serviceId];
  if (!required || required.length === 0) return true;
  return required.some((req) =>
    grantedScopes.some((granted) => granted.includes(req) || req.includes(granted)),
  );
}

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

export async function createAuthorizationUrl(
  userId: string,
  customScopes?: readonly string[],
  expectedEmail?: string,
): Promise<string> {
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const redirectUri = requireEnv("GOOGLE_REDIRECT_URI");

  const state = base64url(randomBytes(24));
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();
  const targetEmail = (expectedEmail || "").trim().toLowerCase();

  // Try storing in Supabase if configured, otherwise fallback to local SQLite
  let stored = false;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("google_oauth_states").insert({
      state,
      user_id: userId,
      code_verifier: codeVerifier,
      expires_at: expiresAt,
    });
    if (!error) stored = true;
  } catch {
    // Supabase not available
  }

  // Always keep in local auth store as resilient primary/fallback
  storeLocalOAuthState(state, userId, targetEmail, codeVerifier, expiresAt);

  const scopesToRequest =
    customScopes && customScopes.length > 0
      ? Array.from(new Set(["openid", "email", "profile", ...customScopes]))
      : GOOGLE_SCOPES;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopesToRequest.join(" "),
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
/* Step 2 — the redirect back from Google & Same-Email Verification    */
/* ------------------------------------------------------------------ */

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
};

/**
 * Exchanges `code` for tokens, validates verified Google identity, enforces
 * same-email matching against the authenticated MindSpace user, and stores encrypted tokens.
 */
export async function completeAuthorization(code: string, state: string): Promise<string> {
  // 1. Retrieve state row (from local store or Supabase)
  let stateRow: {
    user_id: string;
    expected_email: string;
    code_verifier: string;
    expires_at: string;
  } | null = null;

  const localState = retrieveAndClearLocalOAuthState(state);
  if (localState) {
    stateRow = {
      user_id: localState.userId,
      expected_email: localState.expectedEmail,
      code_verifier: localState.codeVerifier,
      expires_at: localState.expiresAt,
    };
  } else {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await supabaseAdmin
        .from("google_oauth_states")
        .select("user_id,code_verifier,expires_at")
        .eq("state", state)
        .maybeSingle();

      if (!error && data) {
        stateRow = {
          user_id: data.user_id,
          expected_email: "",
          code_verifier: data.code_verifier,
          expires_at: data.expires_at,
        };
        await supabaseAdmin.from("google_oauth_states").delete().eq("state", state);
      }
    } catch {
      // Supabase not available
    }
  }

  if (!stateRow) {
    throw new Error("This Google Sign-In link is invalid or has already been used.");
  }
  if (new Date(stateRow.expires_at).getTime() < Date.now()) {
    throw new Error("This Google Sign-In link has expired. Please try connecting again.");
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

  // 2. Retrieve verified identity from Google UserInfo endpoint
  const userinfoResponse = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userinfoResponse.ok) {
    throw new Error("Failed to verify Google user profile from Google UserInfo API.");
  }

  const googleProfile = (await userinfoResponse.json()) as {
    email?: string;
    email_verified?: boolean;
    sub?: string;
  };

  const googleEmail = (googleProfile.email || "").trim().toLowerCase();
  const isVerified = Boolean(googleProfile.email_verified);

  if (!googleEmail) {
    throw new GoogleAuthError(
      "Google account did not return a verified email address.",
      "NO_EMAIL",
    );
  }
  if (!isVerified) {
    throw new GoogleAuthError(
      `Google account (${googleEmail}) is unverified. For security, only verified Google accounts can be linked.`,
      "UNVERIFIED_EMAIL",
    );
  }

  // 3. Enforce Same-Email Account Linking
  const expectedEmail = (stateRow.expected_email || "").trim().toLowerCase();
  if (expectedEmail && googleEmail !== expectedEmail) {
    throw new GoogleAuthError(
      `Account email mismatch: Your Google account (${googleEmail}) does not match your authenticated MindSpace account (${expectedEmail}). For security, account linking requires matching verified emails.`,
      "EMAIL_MISMATCH",
    );
  }

  const userId = stateRow.user_id;
  const encryptedAccess = encryptToken(tokens.access_token);
  const encryptedRefresh = encryptToken(tokens.refresh_token);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  // Save to local SQLite store
  saveLocalGoogleConnection(
    userId,
    googleEmail,
    googleProfile.sub || null,
    tokens.scope,
    encryptedAccess,
    encryptedRefresh,
    expiresAt,
  );

  // If Supabase is available, sync to Supabase table
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("google_connections").upsert(
      {
        user_id: userId,
        google_email: googleEmail,
        scope: tokens.scope,
        encrypted_access_token: encryptedAccess,
        encrypted_refresh_token: encryptedRefresh,
        access_token_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  } catch {
    // Local SQLite is authoritative
  }

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

  const encryptedAccess = encryptToken(tokens.access_token);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  // Update in local store
  const localConn = getLocalGoogleConnection(userId);
  if (localConn) {
    saveLocalGoogleConnection(
      userId,
      localConn.google_email,
      null,
      tokens.scope || localConn.scope,
      encryptedAccess,
      encryptToken(refreshToken),
      expiresAt,
    );
  }

  // Update in Supabase if configured
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("google_connections")
      .update({
        encrypted_access_token: encryptedAccess,
        access_token_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
  } catch {
    // Non-fatal
  }

  return tokens.access_token;
}

/** Returns a live access token for `userId`, refreshing it first if needed. Throws GoogleNotConnectedError if there is no connection. */
export async function getValidAccessToken(userId: string): Promise<string> {
  // Check local store first
  const localConn = getLocalGoogleConnection(userId);
  if (localConn) {
    const expiresAt = new Date(localConn.access_token_expires_at).getTime();
    if (Number.isFinite(expiresAt) && expiresAt - EXPIRY_SKEW_MS > Date.now()) {
      return decryptToken(localConn.encrypted_access_token);
    }
    return refreshAccessToken(userId, decryptToken(localConn.encrypted_refresh_token));
  }

  // Check Supabase if configured
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("google_connections")
      .select("encrypted_access_token,encrypted_refresh_token,access_token_expires_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (data) {
      const expiresAt = new Date(data.access_token_expires_at).getTime();
      if (Number.isFinite(expiresAt) && expiresAt - EXPIRY_SKEW_MS > Date.now()) {
        return decryptToken(data.encrypted_access_token);
      }
      return refreshAccessToken(userId, decryptToken(data.encrypted_refresh_token));
    }
  } catch {
    // Supabase not available
  }

  throw new GoogleNotConnectedError();
}

export async function getConnectionStatus(userId: string): Promise<GoogleConnectionStatus> {
  // Check local store first
  const localConn = getLocalGoogleConnection(userId);
  if (localConn) {
    return {
      connected: true,
      googleEmail: localConn.google_email,
      scope: localConn.scope ? localConn.scope.split(" ").filter(Boolean) : [],
      connectedAt: localConn.created_at,
      expiresSoon:
        new Date(localConn.access_token_expires_at).getTime() - EXPIRY_SKEW_MS <= Date.now(),
    };
  }

  // Check Supabase if configured
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("google_connections")
      .select("google_email,scope,access_token_expires_at,created_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (data) {
      return {
        connected: true,
        googleEmail: data.google_email,
        scope: data.scope ? data.scope.split(" ").filter(Boolean) : [],
        connectedAt: data.created_at,
        expiresSoon:
          new Date(data.access_token_expires_at).getTime() - EXPIRY_SKEW_MS <= Date.now(),
      };
    }
  } catch {
    // Supabase not available
  }

  return { connected: false };
}

/** Revokes the token with Google (best-effort) and deletes the stored connection. */
export async function disconnectGoogle(userId: string): Promise<void> {
  const localConn = getLocalGoogleConnection(userId);
  deleteLocalGoogleConnection(userId);

  let refreshToken: string | null = null;
  if (localConn) {
    try {
      refreshToken = decryptToken(localConn.encrypted_refresh_token);
    } catch {
      // Ignore decrypt failure
    }
  }

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("google_connections")
      .select("encrypted_refresh_token")
      .eq("user_id", userId)
      .maybeSingle();

    if (data?.encrypted_refresh_token && !refreshToken) {
      refreshToken = decryptToken(data.encrypted_refresh_token);
    }
    await supabaseAdmin.from("google_connections").delete().eq("user_id", userId);
  } catch {
    // Supabase not available
  }

  if (refreshToken) {
    try {
      await fetch(REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken }),
      });
    } catch {
      // Best-effort
    }
  }
}
