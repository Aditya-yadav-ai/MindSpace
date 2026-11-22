/**
 * MindSpace Stage 8 — Pure Browser Authentication Shim.
 *
 * Implements client-side authentication for the Chromium Extension sidepanel
 * and standalone web client without requiring Node.js runtime APIs (no node:sqlite,
 * no node:fs, no node:url, no node:crypto).
 */

export class AuthError extends Error {
  code: string;
  constructor(message: string, code: string = "AUTH_ERROR") {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: string;
  created_at: string;
}

export interface MindSpaceSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  token_type: "bearer";
  user: UserProfile;
}

export interface JwtTokenPayload {
  sub: string;
  email: string;
  role: string;
  tenant_id: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

const EXT_USERS_KEY = "mindspace.auth.users.v1";
const EXT_RESET_TOKENS_KEY = "mindspace.auth.resets.v1";
const EXT_OAUTH_STATE_KEY = "mindspace.auth.oauth_state.v1";
const EXT_GOOGLE_CONN_KEY = "mindspace.auth.google_conn.v1";

interface StoredUser {
  id: string;
  email: string;
  fullName: string;
  passwordHash: string;
  salt: string;
  role: string;
  createdAt: string;
}

function base64UrlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): string {
  let m = str.replace(/-/g, "+").replace(/_/g, "/");
  while (m.length % 4) m += "=";
  const binary = atob(m);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function getRandomHex(bytesCount: number): string {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const arr = new Uint8Array(bytesCount);
    crypto.getRandomValues(arr);
    return Array.from(arr)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return Math.random().toString(16).substring(2) + Math.random().toString(16).substring(2);
}

function getStoredUsers(): Record<string, StoredUser> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(EXT_USERS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStoredUsers(users: Record<string, StoredUser>) {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(EXT_USERS_KEY, JSON.stringify(users));
    } catch {
      /* ignore storage write error */
    }
  }
}

export function hashPassword(
  password: string,
  existingSalt?: string,
): { hash: string; salt: string } {
  const salt = existingSalt || getRandomHex(16);
  // Simple deterministic client hash for local extension persistence
  let h1 = 0xdeadbeef ^ password.length;
  let h2 = 0x41c6ce57 ^ salt.length;
  const combined = password + ":" + salt;
  for (let i = 0; i < combined.length; i++) {
    const ch = combined.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
  return { hash, salt };
}

export function verifyPassword(password: string, storedHash: string, salt: string): boolean {
  if (!password || !storedHash || !salt) return false;
  const computed = hashPassword(password, salt);
  return computed.hash === storedHash;
}

export function signJwt(
  payload: Omit<JwtTokenPayload, "iat" | "exp">,
  expiresInSeconds: number = 3600,
): string {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtTokenPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };
  const header = { alg: "HS256", typ: "JWT" };
  const hEnc = base64UrlEncode(JSON.stringify(header));
  const pEnc = base64UrlEncode(JSON.stringify(fullPayload));
  const sEnc = base64UrlEncode(getRandomHex(16));
  return `${hEnc}.${pEnc}.${sEnc}`;
}

export function verifyJwt(token: string): JwtTokenPayload {
  if (!token || typeof token !== "string") {
    throw new AuthError("Token missing", "INVALID_TOKEN");
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new AuthError("Malformed JWT structure", "INVALID_TOKEN");
  }
  try {
    const payload: JwtTokenPayload = JSON.parse(base64UrlDecode(parts[1]));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      throw new AuthError("Token has expired", "TOKEN_EXPIRED");
    }
    return payload;
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new AuthError("Invalid token payload", "INVALID_TOKEN");
  }
}

export async function getUserById(id: string): Promise<UserProfile | null> {
  const users = getStoredUsers();
  const u = Object.values(users).find((x) => x.id === id);
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    full_name: u.fullName,
    role: u.role,
    created_at: u.createdAt,
  };
}

export function createSessionForUser(
  user: UserProfile,
  _rememberMe: boolean = true,
): MindSpaceSession {
  const access_token = signJwt(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenant_id: user.id,
      iss: "mindspace-auth-v1",
      aud: "mindspace-enterprise",
    },
    3600,
  );
  const refresh_token = "rt_" + getRandomHex(24);
  return {
    access_token,
    refresh_token,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  };
}

export async function signUpUser(
  email: string,
  password: string,
  fullName: string = "",
): Promise<MindSpaceSession> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes("@")) {
    throw new AuthError("A valid email address is required.", "INVALID_INPUT");
  }
  if (!password || password.length < 8) {
    throw new AuthError("Password must be at least 8 characters.", "WEAK_PASSWORD");
  }

  const users = getStoredUsers();
  if (users[cleanEmail]) {
    throw new AuthError("An account with this email address already exists.", "EMAIL_EXISTS");
  }

  const { hash, salt } = hashPassword(password);
  const id = "usr_" + getRandomHex(12);
  const user: StoredUser = {
    id,
    email: cleanEmail,
    fullName: fullName.trim() || cleanEmail.split("@")[0] || "User",
    passwordHash: hash,
    salt,
    role: "authenticated",
    createdAt: new Date().toISOString(),
  };

  users[cleanEmail] = user;
  saveStoredUsers(users);

  return createSessionForUser({
    id: user.id,
    email: user.email,
    full_name: user.fullName,
    role: user.role,
    created_at: user.createdAt,
  });
}

export async function signInUser(
  email: string,
  password: string,
  rememberMe: boolean = true,
): Promise<MindSpaceSession> {
  const cleanEmail = email.trim().toLowerCase();
  const users = getStoredUsers();
  const user = users[cleanEmail];

  if (!user || !verifyPassword(password, user.passwordHash, user.salt)) {
    throw new AuthError("Invalid email or password.", "INVALID_CREDENTIALS");
  }

  return createSessionForUser(
    {
      id: user.id,
      email: user.email,
      full_name: user.fullName,
      role: user.role,
      created_at: user.createdAt,
    },
    rememberMe,
  );
}

export async function refreshUserSession(refreshToken: string): Promise<MindSpaceSession> {
  if (!refreshToken) {
    throw new AuthError("Refresh token is required.", "INVALID_INPUT");
  }
  const defaultUser: UserProfile = {
    id: "usr_active_session",
    email: "user@mindspace.local",
    full_name: "MindSpace User",
    role: "authenticated",
    created_at: new Date().toISOString(),
  };
  return createSessionForUser(defaultUser);
}

export async function signOutSession(_refreshToken?: string): Promise<void> {
  // Session revocation in browser handled via clearClientSession()
}

export async function requestPasswordReset(
  email: string,
): Promise<{ success: boolean; message: string }> {
  const cleanEmail = email.trim().toLowerCase();
  const token = "rst_" + getRandomHex(20);
  if (typeof localStorage !== "undefined") {
    try {
      const existing = JSON.parse(localStorage.getItem(EXT_RESET_TOKENS_KEY) || "{}");
      existing[token] = { email: cleanEmail, expiresAt: Date.now() + 3600_000 };
      localStorage.setItem(EXT_RESET_TOKENS_KEY, JSON.stringify(existing));
    } catch {
      /* ignore storage write error */
    }
  }
  return {
    success: true,
    message: `A password reset link has been simulated for ${cleanEmail}. Token: ${token}`,
  };
}

export async function resetPasswordWithToken(
  token: string,
  newPassword: string,
): Promise<{ success: boolean; message: string }> {
  if (!newPassword || newPassword.length < 8) {
    throw new AuthError("Password must be at least 8 characters.", "WEAK_PASSWORD");
  }
  let email: string | null = null;
  if (typeof localStorage !== "undefined") {
    try {
      const existing = JSON.parse(localStorage.getItem(EXT_RESET_TOKENS_KEY) || "{}");
      const record = existing[token];
      if (record && record.expiresAt > Date.now()) {
        email = record.email;
        delete existing[token];
        localStorage.setItem(EXT_RESET_TOKENS_KEY, JSON.stringify(existing));
      }
    } catch {
      /* ignore storage error */
    }
  }

  if (!email) {
    throw new AuthError("Invalid or expired password reset token.", "INVALID_TOKEN");
  }

  const users = getStoredUsers();
  if (users[email]) {
    const { hash, salt } = hashPassword(newPassword);
    users[email].passwordHash = hash;
    users[email].salt = salt;
    saveStoredUsers(users);
  }

  return { success: true, message: "Password has been successfully updated." };
}

export async function storeLocalOAuthState(state: string, email: string): Promise<void> {
  if (typeof localStorage !== "undefined") {
    try {
      const records = JSON.parse(localStorage.getItem(EXT_OAUTH_STATE_KEY) || "{}");
      records[state] = { email, expiresAt: Date.now() + 10 * 60 * 1000 };
      localStorage.setItem(EXT_OAUTH_STATE_KEY, JSON.stringify(records));
    } catch {
      /* ignore storage write error */
    }
  }
}

export async function retrieveAndClearLocalOAuthState(
  state: string,
): Promise<{ email: string } | null> {
  if (typeof localStorage === "undefined") return null;
  try {
    const records = JSON.parse(localStorage.getItem(EXT_OAUTH_STATE_KEY) || "{}");
    const found = records[state];
    if (found) {
      delete records[state];
      localStorage.setItem(EXT_OAUTH_STATE_KEY, JSON.stringify(records));
      return { email: found.email };
    }
  } catch {
    /* ignore storage error */
  }
  return null;
}

export async function saveLocalGoogleConnection(
  userId: string,
  googleEmail: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: number,
  scopes: string,
): Promise<void> {
  if (typeof localStorage !== "undefined") {
    try {
      const connections = JSON.parse(localStorage.getItem(EXT_GOOGLE_CONN_KEY) || "{}");
      connections[userId] = {
        googleEmail,
        accessToken,
        refreshToken,
        expiresAt,
        scopes,
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(EXT_GOOGLE_CONN_KEY, JSON.stringify(connections));
    } catch {
      /* ignore storage write error */
    }
  }
}

export async function getLocalGoogleConnection(userId: string) {
  if (typeof localStorage === "undefined") return null;
  try {
    const connections = JSON.parse(localStorage.getItem(EXT_GOOGLE_CONN_KEY) || "{}");
    return connections[userId] || null;
  } catch {
    return null;
  }
}

export async function deleteLocalGoogleConnection(userId: string): Promise<void> {
  if (typeof localStorage !== "undefined") {
    try {
      const connections = JSON.parse(localStorage.getItem(EXT_GOOGLE_CONN_KEY) || "{}");
      delete connections[userId];
      localStorage.setItem(EXT_GOOGLE_CONN_KEY, JSON.stringify(connections));
    } catch {
      /* ignore storage write error */
    }
  }
}
