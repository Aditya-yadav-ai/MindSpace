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
  _userId: string,
  scopes?: string[],
  _userEmail?: string,
): Promise<string> {
  const clientId =
    (typeof process !== "undefined" && process.env?.GOOGLE_CLIENT_ID) ||
    "mindspace-extension-client-id";
  const redirectUri =
    (typeof chrome !== "undefined" &&
      typeof chrome.identity?.getRedirectURL === "function" &&
      chrome.identity.getRedirectURL()) ||
    (typeof window !== "undefined" && `${window.location.origin}/api/google/oauth-callback`) ||
    "http://127.0.0.1:8010/api/google/oauth-callback";

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

export async function getConnectionStatus(_userId: string): Promise<GoogleConnectionStatus> {
  if (typeof localStorage !== "undefined") {
    try {
      const connections = JSON.parse(localStorage.getItem("mindspace.auth.google_conn.v1") || "{}");
      const conn = connections[_userId];
      if (conn && conn.googleEmail) {
        return {
          connected: true,
          email: conn.googleEmail,
          scopes: typeof conn.scopes === "string" ? conn.scopes.split(" ") : conn.scopes,
          connectedAt: conn.updatedAt || new Date().toISOString(),
        };
      }
    } catch {
      /* ignore storage read error */
    }
  }
  return { connected: false };
}

export async function disconnectGoogle(_userId: string): Promise<void> {
  if (typeof localStorage !== "undefined") {
    try {
      const connections = JSON.parse(localStorage.getItem("mindspace.auth.google_conn.v1") || "{}");
      delete connections[_userId];
      localStorage.setItem("mindspace.auth.google_conn.v1", JSON.stringify(connections));
    } catch {
      /* ignore storage write error */
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
