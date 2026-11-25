/**
 * MindSpace Stage 8 — Pure Browser Google OAuth Shim.
 * Provides client-side Google OAuth functions for the Chromium Extension
 * without Node.js dependencies.
 */
import { GoogleAuthError, type GoogleConnectionStatus } from "./types";
export { GoogleAuthError };
import {
  SERVICE_SCOPES,
  DEFAULT_WORKSPACE_SCOPES,
  sanitizeScopesForGoogle,
  isServiceAuthorized,
  getAuthorizedServices,
  getPendingServices,
} from "./scopes";
export {
  SERVICE_SCOPES,
  DEFAULT_WORKSPACE_SCOPES,
  sanitizeScopesForGoogle,
  isServiceAuthorized,
  getAuthorizedServices,
  getPendingServices,
};

export const GOOGLE_SCOPES = DEFAULT_WORKSPACE_SCOPES;

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

  // 2. Secondary fallback: Construct client-side authorization URL with sanitized scopes
  const clientId =
    (typeof process !== "undefined" && process.env?.["GOOGLE_CLIENT_ID"]) ||
    "";
  const redirectUri =
    (typeof process !== "undefined" && process.env?.["GOOGLE_REDIRECT_URI"]) ||
    "http://localhost:8080/api/google/oauth-callback";

  const sanitized = sanitizeScopesForGoogle(scopes);
  const requestedScopes = sanitized.join(" ");
  const state = Math.random().toString(36).substring(2);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: requestedScopes,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
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
        const grantedScopes = Array.isArray(data.scope)
          ? data.scope
          : typeof data.scope === "string"
            ? (data.scope as string).split(" ").filter(Boolean)
            : [];
        const result: GoogleConnectionStatus = {
          ...data,
          scope: grantedScopes,
          authorizedServices: data.authorizedServices || getAuthorizedServices(grantedScopes),
          pendingServices: data.pendingServices || getPendingServices(grantedScopes),
        };
        // Cache in localStorage and chrome.storage.local for instantaneous offline access
        if (typeof localStorage !== "undefined") {
          try {
            const raw = localStorage.getItem("mindspace.auth.google_conn.v1") || "{}";
            const conns = JSON.parse(raw);
            conns[userId] = {
              googleEmail: data.googleEmail,
              scopes: grantedScopes,
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
                  scopes: grantedScopes,
                  updatedAt: data.connectedAt || new Date().toISOString(),
                },
                "local-user": {
                  googleEmail: data.googleEmail,
                  scopes: grantedScopes,
                  updatedAt: data.connectedAt || new Date().toISOString(),
                },
              },
            });
          } catch {
            /* ignore */
          }
        }
        return result;
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
        const grantedScopes =
          typeof conn.scopes === "string"
            ? conn.scopes.split(" ").filter(Boolean)
            : Array.isArray(conn.scopes)
              ? conn.scopes
              : [];
        return {
          connected: true,
          googleEmail: conn.googleEmail,
          scope: grantedScopes,
          connectedAt: conn.updatedAt || new Date().toISOString(),
          expiresSoon: false,
          authorizedServices: getAuthorizedServices(grantedScopes),
          pendingServices: getPendingServices(grantedScopes),
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
        const grantedScopes =
          typeof conn.scopes === "string"
            ? conn.scopes.split(" ").filter(Boolean)
            : Array.isArray(conn.scopes)
              ? conn.scopes
              : [];
        return {
          connected: true,
          googleEmail: conn.googleEmail,
          scope: grantedScopes,
          connectedAt: conn.updatedAt || new Date().toISOString(),
          expiresSoon: false,
          authorizedServices: getAuthorizedServices(grantedScopes),
          pendingServices: getPendingServices(grantedScopes),
        };
      }
    } catch {
      /* ignore */
    }
  }

  return {
    connected: false,
    authorizedServices: [],
    pendingServices: Object.keys(SERVICE_SCOPES),
  };
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

export function createGoogleServices(userId: string = "local-user") {
  async function proxyTool<T>(action: string, input: unknown): Promise<T> {
    try {
      const res = await fetch("http://localhost:8080/api/google/oauth-callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, input, userId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Tool call failed for ${action}`);
      }
      return data.result as T;
    } catch (err) {
      if (err instanceof Error && (err.message.includes("fetch") || err.message.includes("Failed to fetch"))) {
        throw new GoogleAuthError(
          "Local MindSpace server on http://localhost:8080 is not running. Start the backend service to execute Google Workspace tools.",
          "SERVER_OFFLINE",
        );
      }
      throw err;
    }
  }

  return {
    connected: true,
    listRecentEmails: (input: any) => proxyTool("gmail.list_recent", input),
    createEmailDraft: (input: any) => proxyTool("gmail.create_draft", input),
    listUpcomingEvents: (input: any) => proxyTool("calendar.list_events", input),
    createCalendarEvent: (input: any) => proxyTool("calendar.create_event", input),
    searchDriveFiles: (input: any) => proxyTool("drive.search", input),
    saveDriveFile: (input: any) => proxyTool("drive.save_file", input),
    readDocument: (input: any) => proxyTool("docs.read", input),
    createDocument: (input: any) => proxyTool("docs.create", input),
    readSheetRange: (input: any) => proxyTool("sheets.read", input),
    createSpreadsheet: (input: any) => proxyTool("sheets.create", input),
    appendSheetValues: (input: any) => proxyTool("sheets.append", input),
    readPresentation: (input: any) => proxyTool("slides.read", input),
    createPresentation: (input: any) => proxyTool("slides.create", input),
    createMeetingSpace: (input: any) => proxyTool("meet.create_space", input),
    getMeetingSpace: (input: any) => proxyTool("meet.get_space", input),
    listConferenceRecords: (input: any) => proxyTool("meet.list_records", input),
    listConferenceParticipants: (input: any) => proxyTool("meet.list_participants", input),
    createForm: (input: any) => proxyTool("forms.create", input),
    getForm: (input: any) => proxyTool("forms.get", input),
    getFormQuestions: (input: any) => proxyTool("forms.questions", input),
    listFormResponses: (input: any) => proxyTool("forms.responses", input),
    getFormResponseSummary: (input: any) => proxyTool("forms.summary", input),
    listTasks: (input: any) => proxyTool("tasks.list", input),
    createTask: (input: any) => proxyTool("tasks.create", input),
    completeTask: (input: any) => proxyTool("tasks.mark_done", input),
    searchContacts: (input: any) => proxyTool("contacts.search", input),
    getContact: (input: any) => proxyTool("contacts.get", input),
    createContact: (input: any) => proxyTool("contacts.create", input),
    searchPlaces: (input: any) => proxyTool("maps.places", input),
    getPlaceDetails: (input: any) => proxyTool("maps.details", input),
    getDirections: (input: any) => proxyTool("maps.directions", input),
    searchYouTubeVideos: (input: any) => proxyTool("youtube.search", input),
    getYouTubeVideoDetails: (input: any) => proxyTool("youtube.details", input),
    listCourses: (input: any) => proxyTool("classroom.courses", input),
    listCourseWork: (input: any) => proxyTool("classroom.coursework", input),
    listCourseSubmissions: (input: any) => proxyTool("classroom.submissions", input),
    listChatSpaces: (input: any) => proxyTool("chat.spaces", input),
    sendChatMessage: (input: any) => proxyTool("chat.send", input),
  };
}
