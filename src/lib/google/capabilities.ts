/**
 * Stage 6 — static capability metadata for every Google service MindSpace
 * integrates with. No secrets or network calls here — this just describes
 * what each service can do, for the Connected Services "capability/status"
 * display and for anything else that wants to introspect the integration
 * without importing server-only code.
 */
import type { ServiceCapability } from "./types";

export const GOOGLE_SERVICE_CAPABILITIES: ServiceCapability[] = [
  {
    id: "gmail",
    label: "Gmail",
    reads: true,
    writes: true,
    scopes: ["gmail.readonly", "gmail.compose"],
  },
  {
    id: "calendar",
    label: "Calendar",
    reads: true,
    writes: true,
    scopes: ["calendar.events"],
  },
  {
    id: "drive",
    label: "Drive",
    reads: true,
    writes: true,
    scopes: ["drive.file"],
  },
  {
    id: "docs",
    label: "Docs",
    reads: true,
    writes: true,
    scopes: ["documents"],
  },
  {
    id: "sheets",
    label: "Sheets",
    reads: true,
    writes: true,
    scopes: ["spreadsheets"],
  },
  {
    id: "slides",
    label: "Slides",
    reads: true,
    writes: true,
    scopes: ["presentations"],
  },
  {
    id: "forms",
    label: "Forms",
    reads: true,
    writes: true,
    scopes: ["forms.body", "forms.responses.readonly"],
  },
  {
    id: "meet",
    label: "Meet",
    reads: false,
    writes: true,
    scopes: ["meetings.space.created"],
  },
  {
    id: "classroom",
    label: "Classroom",
    reads: true,
    writes: false,
    scopes: ["classroom.courses.readonly", "classroom.coursework.me.readonly"],
  },
  {
    id: "chat",
    label: "Chat",
    reads: true,
    writes: true,
    scopes: ["chat.spaces.readonly", "chat.messages"],
  },
];
