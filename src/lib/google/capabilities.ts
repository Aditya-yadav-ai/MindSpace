/**
 * Stage 8 — static capability metadata for every Google service MindSpace
 * integrates with. Exactly 14 supported services categorized into
 * Communication, Productivity, Education, and Location.
 * No secrets or network calls here — this describes what each service can do,
 * for the Connected Services dashboard and agent introspection.
 */
import type { ServiceCapability } from "./types";

export const GOOGLE_SERVICE_CAPABILITIES: ServiceCapability[] = [
  // ── Communication ────────────────────────────────────────────────────────
  {
    id: "gmail",
    label: "Gmail",
    category: "communication",
    reads: true,
    writes: true,
    scopes: ["gmail.readonly", "gmail.compose"],
    operations: [
      "List recent emails",
      "Search emails by query",
      "Draft messages (approval gated)",
      "Read message snippets and headers",
    ],
  },
  {
    id: "meet",
    label: "Google Meet",
    category: "communication",
    reads: true,
    writes: true,
    scopes: ["meetings.space.created", "meetings.space.readonly"],
    operations: [
      "Create meeting spaces (approval gated)",
      "Generate instant meeting links",
      "Retrieve meeting-space details",
      "List conference records",
      "Inspect conference participants",
    ],
  },
  {
    id: "chat",
    label: "Google Chat",
    category: "communication",
    reads: true,
    writes: true,
    scopes: ["chat.spaces.readonly", "chat.messages", "chat.memberships.readonly"],
    operations: [
      "List accessible spaces",
      "Retrieve space details",
      "Read recent messages",
      "Send messages to spaces (approval gated)",
      "Create spaces (approval gated)",
      "Inspect space memberships",
    ],
  },

  // ── Productivity ─────────────────────────────────────────────────────────
  {
    id: "drive",
    label: "Google Drive",
    category: "productivity",
    reads: true,
    writes: true,
    scopes: ["drive.file"],
    operations: [
      "Search user files",
      "Save text and notes to Drive (approval gated)",
      "Retrieve file metadata and web links",
    ],
  },
  {
    id: "docs",
    label: "Google Docs",
    category: "productivity",
    reads: true,
    writes: true,
    scopes: ["documents"],
    operations: [
      "Read document text and headings",
      "Create new documents (approval gated)",
      "Extract structured outlines",
    ],
  },
  {
    id: "sheets",
    label: "Google Sheets",
    category: "productivity",
    reads: true,
    writes: true,
    scopes: ["spreadsheets"],
    operations: [
      "Read spreadsheet cell ranges",
      "Create spreadsheets (approval gated)",
      "Append rows and data records (approval gated)",
    ],
  },
  {
    id: "slides",
    label: "Google Slides",
    category: "productivity",
    reads: true,
    writes: true,
    scopes: ["presentations"],
    operations: [
      "Read presentation outlines and slide count",
      "Create presentations (approval gated)",
      "Draft presentation decks",
    ],
  },
  {
    id: "tasks",
    label: "Google Tasks",
    category: "productivity",
    reads: true,
    writes: true,
    scopes: ["tasks"],
    operations: [
      "List task lists",
      "Create task lists (approval gated)",
      "List pending & completed tasks",
      "Create tasks with due dates (approval gated)",
      "Update task details (approval gated)",
      "Mark tasks completed (approval gated)",
      "Delete tasks (approval gated)",
    ],
  },
  {
    id: "calendar",
    label: "Google Calendar",
    category: "productivity",
    reads: true,
    writes: true,
    scopes: ["calendar.events"],
    operations: [
      "List upcoming calendar events",
      "Create scheduled events (approval gated)",
      "Inspect event start/end times and locations",
    ],
  },
  {
    id: "contacts",
    label: "Google Contacts",
    category: "productivity",
    reads: true,
    writes: true,
    scopes: ["contacts"],
    operations: [
      "List connections and contacts",
      "Search contacts by name or email",
      "Retrieve detailed contact information",
      "Create contacts (approval gated)",
      "Update contacts (approval gated)",
      "Delete contacts (approval gated)",
    ],
  },

  // ── Education ────────────────────────────────────────────────────────────
  {
    id: "classroom",
    label: "Google Classroom",
    category: "education",
    reads: true,
    writes: true,
    scopes: ["classroom.courses.readonly", "classroom.coursework.me", "classroom.announcements"],
    operations: [
      "List active courses",
      "Retrieve course details",
      "List coursework and assignments",
      "List course announcements",
      "Inspect student submissions",
      "Create announcements (approval gated)",
      "Create coursework (approval gated)",
    ],
  },
  {
    id: "forms",
    label: "Google Forms",
    category: "education",
    reads: true,
    writes: true,
    scopes: ["forms.body", "forms.responses.readonly"],
    operations: [
      "Create survey forms (approval gated)",
      "Retrieve form schema and questions",
      "List submitted form responses",
      "Generate response summaries",
    ],
  },
  {
    id: "youtube",
    label: "YouTube",
    category: "education",
    reads: true,
    writes: false,
    scopes: ["youtube.readonly"],
    operations: [
      "Search educational videos",
      "Retrieve video details and statistics",
      "Inspect channel information",
      "List playlists and playlist items",
      "Create playlists (approval gated)",
    ],
  },

  // ── Location ─────────────────────────────────────────────────────────────
  {
    id: "maps",
    label: "Google Maps",
    category: "location",
    reads: true,
    writes: false,
    scopes: ["maps.places", "maps.geocoding"],
    operations: [
      "Search places and points of interest",
      "Retrieve place details, ratings, addresses",
      "Geocode addresses to coordinates",
      "Reverse geocode coordinates to addresses",
      "Calculate travel distance and matrix",
      "Get route directions and step-by-step guidance",
    ],
    requiresApiKey: true,
  },
];
