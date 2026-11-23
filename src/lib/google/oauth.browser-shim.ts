/**
 * MindSpace Stage 8 — Pure Browser Google OAuth Shim.
 * Provides client-side Google OAuth functions for the Chromium Extension
 * without Node.js dependencies.
 */
import { GoogleAuthError, type GoogleConnectionStatus } from "./types";
export { GoogleAuthError };

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
];

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

export async function createAuthorizationUrl(
  userId: string,
  scopes?: string[],
  userEmail?: string,
): Promise<string> {
  // 1. Primary: Request a real PKCE-backed Google consent URL from the local server
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const params = new URLSearchParams({
      action: "url",
      userId: userId || "local-user",
      email: userEmail || "",
    });
    if (scopes && scopes.length > 0) {
      params.set("scopes", scopes.join(","));
    }
    const res = await fetch(`http://localhost:8080/api/google/oauth-callback?${params.toString()}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data?.url) return data.url;
    }
  } catch {
    // Local server not available; fall back to client construction
  }

  // 2. Secondary fallback: Construct client-side authorization URL with configured environment variables
  const clientId =
    (typeof process !== "undefined" && process.env?.["GOOGLE_CLIENT_ID"]) ||
    "";
  const redirectUri =
    (typeof process !== "undefined" && process.env?.["GOOGLE_REDIRECT_URI"]) ||
    "http://localhost:8080/api/google/oauth-callback";

  const requestedScopes = Array.from(new Set([...GOOGLE_SCOPES, ...(scopes || [])])).join(" ");
  const state = Math.random().toString(36).substring(2);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: requestedScopes,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return `${AUTH_URL}?${params.toString()}`;
}

export async function getConnectionStatus(userId: string): Promise<GoogleConnectionStatus> {
  // 1. Primary: Query the server on port 8080 for live SQLite/Supabase status
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(
      `http://localhost:8080/api/google/oauth-callback?action=status&userId=${encodeURIComponent(userId || "local-user")}`,
      { signal: controller.signal },
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as GoogleConnectionStatus;
      if (data && data.connected) {
        // Cache in localStorage and chrome.storage.local for instantaneous offline access
        if (typeof localStorage !== "undefined") {
          try {
            const raw = localStorage.getItem("mindspace.auth.google_conn.v1") || "{}";
            const conns = JSON.parse(raw);
            conns[userId] = {
              googleEmail: data.googleEmail,
              scopes: data.scope,
              updatedAt: data.connectedAt || new Date().toISOString(),
            };
            conns["local-user"] = conns[userId];
            localStorage.setItem("mindspace.auth.google_conn.v1", JSON.stringify(conns));
          } catch {
            /* ignore */
          }
        }
        if (typeof chrome !== "undefined" && typeof chrome.storage?.local?.set === "function") {
          try {
            await chrome.storage.local.set({
              "mindspace.auth.google_conn.v1": {
                [userId]: {
                  googleEmail: data.googleEmail,
                  scopes: data.scope,
                  updatedAt: data.connectedAt || new Date().toISOString(),
                },
                "local-user": {
                  googleEmail: data.googleEmail,
                  scopes: data.scope,
                  updatedAt: data.connectedAt || new Date().toISOString(),
                },
              },
            });
          } catch {
            /* ignore */
          }
        }
        return data;
      }
    }
  } catch {
    // Server not available
  }

  // 2. Secondary fallback: Check localStorage
  if (typeof localStorage !== "undefined") {
    try {
      const connections = JSON.parse(localStorage.getItem("mindspace.auth.google_conn.v1") || "{}");
      const conn = (connections[userId] ||
        connections["local-user"] ||
        Object.values(connections)[0]) as
        | { googleEmail?: string; scopes?: string[] | string; updatedAt?: string }
        | undefined;
      if (conn && conn.googleEmail) {
        return {
          connected: true,
          googleEmail: conn.googleEmail,
          scope: typeof conn.scopes === "string" ? conn.scopes.split(" ") : conn.scopes || [],
          connectedAt: conn.updatedAt || new Date().toISOString(),
          expiresSoon: false,
        };
      }
    } catch {
      /* ignore storage read error */
    }
  }

  // 3. Tertiary fallback: Check chrome.storage.local
  if (typeof chrome !== "undefined" && typeof chrome.storage?.local?.get === "function") {
    try {
      const stored = await chrome.storage.local.get(["mindspace.auth.google_conn.v1"]);
      const connections = (stored && (stored["mindspace.auth.google_conn.v1"] as Record<string, unknown>)) || {};
      const conn = (connections[userId] ||
        connections["local-user"] ||
        Object.values(connections)[0]) as
        | { googleEmail?: string; scopes?: string[] | string; updatedAt?: string }
        | undefined;
      if (conn && conn.googleEmail) {
        return {
          connected: true,
          googleEmail: conn.googleEmail,
          scope: typeof conn.scopes === "string" ? conn.scopes.split(" ") : conn.scopes || [],
          connectedAt: conn.updatedAt || new Date().toISOString(),
          expiresSoon: false,
        };
      }
    } catch {
      /* ignore */
    }
  }

  return { connected: false };
}

export async function disconnectGoogle(userId: string): Promise<void> {
  try {
    await fetch(
      `http://localhost:8080/api/google/oauth-callback?action=disconnect&userId=${encodeURIComponent(userId || "local-user")}`,
      { method: "GET" },
    );
  } catch {
    /* ignore */
  }

  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem("mindspace.auth.google_conn.v1");
    } catch {
      /* ignore storage write error */
    }
  }
  if (typeof chrome !== "undefined" && typeof chrome.storage?.local?.remove === "function") {
    try {
      await chrome.storage.local.remove(["mindspace.auth.google_conn.v1"]);
    } catch {
      /* ignore */
    }
  }
}

export async function completeAuthorization(
  _code: string,
  _state: string,
): Promise<{ success: boolean; email?: string; error?: string }> {
  return { success: false, error: "OAuth completion is managed by backend flow." };
}

export async function getValidAccessToken(
  _userId: string,
  _scope?: string,
): Promise<string | null> {
  return null;
}

export async function recordAgentRun(
  _userId: string,
  _result: unknown,
  _automationId?: string,
): Promise<void> {
  // Agent history persistence is handled server-side
}

export function createTaskService(_userId?: string) {
  return {
    available: false,
    async create() {
      throw new Error("Tasks persistence is server-only.");
    },
    async list() {
      return [];
    },
    async markDone() {
      return null;
    },
  };
}

export function createGoogleServices(_userId?: string) {
  const fail = () =>
    Promise.reject(
      new GoogleAuthError("Google account not connected in extension context.", "NOT_CONNECTED"),
    );
  return {
    connected: false,
    listRecentEmails: fail,
    createEmailDraft: fail,
    listUpcomingEvents: fail,
    createCalendarEvent: fail,
    searchDriveFiles: fail,
    saveDriveFile: fail,
    readDocument: fail,
    createDocument: fail,
    readSheetRange: fail,
    createSpreadsheet: fail,
    appendSheetValues: fail,
    readPresentation: fail,
    createPresentation: fail,
    createMeetingSpace: fail,
    getMeetingSpace: fail,
    listConferenceRecords: fail,
    listConferenceParticipants: fail,
    createForm: fail,
    getForm: fail,
    getFormQuestions: fail,
    listFormResponses: fail,
    getFormResponseSummary: fail,
    listTasks: fail,
    createTask: fail,
    completeTask: fail,
    searchContacts: fail,
    getContact: fail,
    createContact: fail,
    searchPlaces: fail,
    getPlaceDetails: fail,
    getDirections: fail,
    searchYouTubeVideos: fail,
    getYouTubeVideoDetails: fail,
    listCourses: fail,
    listCourseWork: fail,
    listCourseSubmissions: fail,
    listChatSpaces: fail,
    sendChatMessage: fail,
  };
}
