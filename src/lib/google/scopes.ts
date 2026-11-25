/**
 * MindSpace Stage 8 — Centralized Google OAuth 2.0 Scope Registry & Policy.
 *
 * Enforces least-privilege access, eliminates mutually incompatible scope combinations,
 * and enables incremental service authorization for all 14 official Google services.
 */

export const BASE_IDENTITY_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
] as const;

/** Exact least-privilege Google scopes mapped to each of the 14 official services. */
export const SERVICE_SCOPES: Record<string, readonly string[]> = {
  gmail: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
  ],
  calendar: [
    "https://www.googleapis.com/auth/calendar.events",
  ],
  drive: [
    "https://www.googleapis.com/auth/drive.file",
  ],
  docs: [
    "https://www.googleapis.com/auth/documents",
  ],
  sheets: [
    "https://www.googleapis.com/auth/spreadsheets",
  ],
  slides: [
    "https://www.googleapis.com/auth/presentations",
  ],
  tasks: [
    "https://www.googleapis.com/auth/tasks",
  ],
  meet: [
    "https://www.googleapis.com/auth/meetings.space.created",
    "https://www.googleapis.com/auth/meetings.space.readonly",
  ],
  forms: [
    "https://www.googleapis.com/auth/forms.body",
    "https://www.googleapis.com/auth/forms.responses.readonly",
  ],
  chat: [
    "https://www.googleapis.com/auth/chat.spaces.readonly",
    "https://www.googleapis.com/auth/chat.messages",
    "https://www.googleapis.com/auth/chat.memberships.readonly",
  ],
  contacts: [
    "https://www.googleapis.com/auth/contacts",
  ],
  classroom: [
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.me",
    "https://www.googleapis.com/auth/classroom.announcements",
  ],
  youtube: [
    "https://www.googleapis.com/auth/youtube.readonly",
  ],
  maps: [], // Authenticated via Google Maps Platform API key
} as const;

/**
 * Mutually compatible Core Google Workspace productivity scopes requested on
 * initial default "Connect Google" action. Excludes YouTube, Classroom, and Chat
 * to prevent Google Error 400 (incompatible scope combination).
 */
export const DEFAULT_WORKSPACE_SCOPES: readonly string[] = [
  ...BASE_IDENTITY_SCOPES,
  ...SERVICE_SCOPES.gmail,
  ...SERVICE_SCOPES.calendar,
  ...SERVICE_SCOPES.drive,
  ...SERVICE_SCOPES.docs,
  ...SERVICE_SCOPES.sheets,
  ...SERVICE_SCOPES.slides,
  ...SERVICE_SCOPES.tasks,
];

/** Shorthand to full URI mapping */
const SHORTHAND_EXPANSIONS: Record<string, string> = {
  "email": "https://www.googleapis.com/auth/userinfo.email",
  "profile": "https://www.googleapis.com/auth/userinfo.profile",
  "gmail.readonly": "https://www.googleapis.com/auth/gmail.readonly",
  "gmail.compose": "https://www.googleapis.com/auth/gmail.compose",
  "calendar.events": "https://www.googleapis.com/auth/calendar.events",
  "drive.file": "https://www.googleapis.com/auth/drive.file",
  "documents": "https://www.googleapis.com/auth/documents",
  "spreadsheets": "https://www.googleapis.com/auth/spreadsheets",
  "presentations": "https://www.googleapis.com/auth/presentations",
  "tasks": "https://www.googleapis.com/auth/tasks",
  "meetings.space.created": "https://www.googleapis.com/auth/meetings.space.created",
  "meetings.space.readonly": "https://www.googleapis.com/auth/meetings.space.readonly",
  "forms.body": "https://www.googleapis.com/auth/forms.body",
  "forms.responses.readonly": "https://www.googleapis.com/auth/forms.responses.readonly",
  "chat.spaces.readonly": "https://www.googleapis.com/auth/chat.spaces.readonly",
  "chat.messages": "https://www.googleapis.com/auth/chat.messages",
  "chat.memberships.readonly": "https://www.googleapis.com/auth/chat.memberships.readonly",
  "contacts": "https://www.googleapis.com/auth/contacts",
  "contacts.readonly": "https://www.googleapis.com/auth/contacts",
  "classroom.courses.readonly": "https://www.googleapis.com/auth/classroom.courses.readonly",
  "classroom.coursework.me": "https://www.googleapis.com/auth/classroom.coursework.me",
  "classroom.announcements": "https://www.googleapis.com/auth/classroom.announcements",
  "youtube.readonly": "https://www.googleapis.com/auth/youtube.readonly",
  "youtube": "https://www.googleapis.com/auth/youtube.readonly",
};

/** Normalize any scope string into its canonical Google OAuth 2.0 URI */
export function normalizeScope(scope: string): string {
  const trimmed = scope.trim();
  if (trimmed === "openid") return "openid";
  if (SHORTHAND_EXPANSIONS[trimmed]) return SHORTHAND_EXPANSIONS[trimmed];
  if (trimmed.startsWith("https://www.googleapis.com/auth/")) return trimmed;
  if (trimmed.startsWith("https://")) return trimmed;
  return `https://www.googleapis.com/auth/${trimmed}`;
}

/**
 * Sanitizes and validates requested scopes for a Google OAuth 2.0 authorization URL.
 * Enforces mutual compatibility rules:
 * 1. Never requests youtube and youtube.readonly together.
 * 2. Never requests youtube.readonly and drive.file in the same authorization prompt (Google Error 400).
 * 3. Never requests contacts and contacts.readonly together.
 * 4. Ensures openid and identity scopes are included.
 */
export function sanitizeScopesForGoogle(requestedScopes?: readonly string[]): string[] {
  if (!requestedScopes || requestedScopes.length === 0) {
    return Array.from(DEFAULT_WORKSPACE_SCOPES);
  }

  // 1. Normalize and deduplicate
  const rawSet = new Set<string>();
  rawSet.add("openid");
  rawSet.add("https://www.googleapis.com/auth/userinfo.email");
  rawSet.add("https://www.googleapis.com/auth/userinfo.profile");

  for (const s of requestedScopes) {
    if (!s) continue;
    rawSet.add(normalizeScope(s));
  }

  let scopes = Array.from(rawSet);

  // 2. Resolve YouTube duplicate/conflict
  const hasYoutubeBroad = scopes.includes("https://www.googleapis.com/auth/youtube");
  const hasYoutubeReadonly = scopes.includes("https://www.googleapis.com/auth/youtube.readonly");
  if (hasYoutubeBroad && hasYoutubeReadonly) {
    // Keep only least-privilege youtube.readonly
    scopes = scopes.filter((s) => s !== "https://www.googleapis.com/auth/youtube");
  }

  // 3. Resolve Contacts duplicate/conflict
  const hasContactsFull = scopes.includes("https://www.googleapis.com/auth/contacts");
  const hasContactsReadonly = scopes.includes("https://www.googleapis.com/auth/contacts.readonly");
  if (hasContactsFull && hasContactsReadonly) {
    scopes = scopes.filter((s) => s !== "https://www.googleapis.com/auth/contacts.readonly");
  }

  // 4. Resolve Drive vs YouTube conflict (Google explicitly disallows requesting drive.file and youtube together)
  const hasYoutube = scopes.some((s) => s.includes("youtube"));
  const hasDrive = scopes.some((s) => s.includes("drive"));

  if (hasYoutube && hasDrive) {
    // If the request was explicitly intended for YouTube, prioritize YouTube and drop Drive
    const requestedLower = requestedScopes.map((s) => s.toLowerCase());
    const isYouTubeTargeted = requestedLower.some((s) => s.includes("youtube"));
    if (isYouTubeTargeted && !requestedLower.some((s) => s.includes("drive"))) {
      scopes = scopes.filter((s) => !s.includes("drive"));
    } else {
      // Default / Workspace targeted: drop YouTube (must be authorized in its own incremental step)
      scopes = scopes.filter((s) => !s.includes("youtube"));
    }
  }

  return scopes;
}

/** Check if granted scopes satisfy the requirements for a given service. */
export function isServiceAuthorized(serviceId: string, grantedScopes: readonly string[]): boolean {
  if (serviceId === "maps") return true; // API key authenticated

  const required = SERVICE_SCOPES[serviceId];
  if (!required || required.length === 0) return true;

  const normalizedGranted = new Set(grantedScopes.map(normalizeScope));

  // Every required scope for this service must be present in the granted set
  return required.every((req) => normalizedGranted.has(normalizeScope(req)));
}

/** Returns list of all service IDs that are authorized under the granted scopes. */
export function getAuthorizedServices(grantedScopes: readonly string[]): string[] {
  const authorized: string[] = [];
  for (const serviceId of Object.keys(SERVICE_SCOPES)) {
    if (isServiceAuthorized(serviceId, grantedScopes)) {
      authorized.push(serviceId);
    }
  }
  return authorized;
}

/** Returns list of all service IDs that still require authorization. */
export function getPendingServices(grantedScopes: readonly string[]): string[] {
  const pending: string[] = [];
  for (const serviceId of Object.keys(SERVICE_SCOPES)) {
    if (!isServiceAuthorized(serviceId, grantedScopes)) {
      pending.push(serviceId);
    }
  }
  return pending;
}
