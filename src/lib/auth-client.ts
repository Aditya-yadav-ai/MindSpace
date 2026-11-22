/**
 * MindSpace Stage 8 — Client-side Session and Identity Manager.
 *
 * Coordinates authentication state across:
 * - Web Browser Application (localStorage & in-memory cache)
 * - Chromium Extension Side Panel (chrome.storage.local synchronization)
 * - Automated bearer header injection for serverFn RPCs and MAS API calls
 */
import type { MindSpaceSession, UserProfile } from "./auth.server";

const SESSION_STORAGE_KEY = "mindspace.auth.session.v1";
const REMEMBER_KEY = "mindspace.auth.remember.v1";

type AuthListener = (session: MindSpaceSession | null) => void;
const listeners = new Set<AuthListener>();

let inMemorySession: MindSpaceSession | null = null;
let initialized = false;

export function onAuthChange(listener: AuthListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(session: MindSpaceSession | null) {
  inMemorySession = session;
  for (const listener of listeners) {
    try {
      listener(session);
    } catch (e) {
      console.error("[AuthClient] Listener error:", e);
    }
  }
}

/** Check if running inside a Chrome Extension context */
export function isChromeExtension(): boolean {
  return (
    typeof window !== "undefined" && typeof chrome !== "undefined" && Boolean(chrome?.runtime?.id)
  );
}

/**
 * Loads the active session from localStorage or chrome.storage.local.
 */
export async function loadClientSession(): Promise<MindSpaceSession | null> {
  if (typeof window === "undefined") return null;

  // 1. In extension context, try chrome.storage.local first
  if (isChromeExtension() && typeof chrome.storage?.local?.get === "function") {
    try {
      const data = await chrome.storage.local.get([SESSION_STORAGE_KEY]);
      if (data && data[SESSION_STORAGE_KEY]) {
        const session = data[SESSION_STORAGE_KEY] as MindSpaceSession;
        if (isValidSession(session)) {
          inMemorySession = session;
          initialized = true;
          return session;
        }
      }
    } catch {
      // Fallback to localStorage
    }
  }

  // 2. Read from localStorage
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (raw) {
      const session = JSON.parse(raw) as MindSpaceSession;
      if (isValidSession(session)) {
        inMemorySession = session;
        initialized = true;
        return session;
      } else {
        localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    }
  } catch {
    // Ignore storage parse errors
  }

  inMemorySession = null;
  initialized = true;
  return null;
}

/** Check if session has not expired */
export function isValidSession(session: MindSpaceSession | null): boolean {
  if (!session || !session.access_token || !session.user) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return session.expires_at > nowSec;
}

/** Get current synchronous cached session */
export function getClientSession(): MindSpaceSession | null {
  return inMemorySession;
}

/** Save an active session across local and extension storage */
export async function setClientSession(
  session: MindSpaceSession,
  rememberMe: boolean = true,
): Promise<void> {
  inMemorySession = session;

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      localStorage.setItem(REMEMBER_KEY, rememberMe ? "1" : "0");
    } catch {
      // Ignore localStorage quotas
    }

    if (isChromeExtension() && typeof chrome.storage?.local?.set === "function") {
      try {
        await chrome.storage.local.set({ [SESSION_STORAGE_KEY]: session });
      } catch (e) {
        console.warn("[AuthClient] Extension storage sync failed:", e);
      }
    }
  }

  notify(session);
}

/** Remove session and notify all subscribers */
export async function clearClientSession(): Promise<void> {
  inMemorySession = null;

  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      localStorage.removeItem(REMEMBER_KEY);
    } catch {
      // Ignore
    }

    if (isChromeExtension() && typeof chrome.storage?.local?.remove === "function") {
      try {
        await chrome.storage.local.remove([SESSION_STORAGE_KEY]);
      } catch {
        // Ignore
      }
    }
  }

  notify(null);
}

/** Returns the active access token for API headers, if valid */
export function getActiveBearerToken(): string | null {
  if (inMemorySession && isValidSession(inMemorySession)) {
    return inMemorySession.access_token;
  }
  return null;
}
