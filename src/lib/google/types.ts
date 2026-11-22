/** Stage 5 — shared Google-integration types. No tokens ever appear here. */

export type GoogleConnectionStatus =
  | { connected: false }
  | {
      connected: true;
      googleEmail: string | null;
      scope: string[];
      connectedAt: string;
      expiresSoon: boolean;
    };

export type GmailMessageSummary = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: string | null;
};

export type GmailDraftInput = {
  to: string;
  subject: string;
  body: string;
};

export type GmailDraftResult = {
  draftId: string;
  messageId: string;
  webUrl: string;
};

export type CalendarEventSummary = {
  id: string;
  summary: string;
  start: string | null;
  end: string | null;
  location: string | null;
  htmlLink: string | null;
};

export type CalendarEventInput = {
  summary: string;
  description: string;
  /** ISO 8601 date-time (with offset) or plain YYYY-MM-DD for all-day. */
  start: string;
  end: string;
  location: string;
};

export type CalendarEventResult = {
  eventId: string;
  htmlLink: string | null;
};

export type DriveFileSummary = {
  id: string;
  name: string;
  mimeType: string;
  modifiedAt: string | null;
  webViewLink: string | null;
};

export type DriveSaveInput = {
  name: string;
  content: string;
  mimeType: string;
};

export type DriveSaveResult = {
  fileId: string;
  webViewLink: string | null;
};

export class GoogleNotConnectedError extends Error {
  constructor(
    message = "Google is not connected. Connect it under Settings → Connected Services.",
  ) {
    super(message);
    this.name = "GoogleNotConnectedError";
  }
}

export class GoogleApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
  }
}

export class GoogleAuthError extends Error {
  readonly code: string;
  constructor(message: string, code: string = "GOOGLE_AUTH_ERROR") {
    super(message);
    this.name = "GoogleAuthError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Stage 6 — Workspace expansion types                                 */
/* ------------------------------------------------------------------ */

export type DocSummary = { documentId: string; title: string; text: string; webUrl: string };
export type DocCreateInput = { title: string; body: string };
export type DocCreateResult = { documentId: string; webUrl: string };

export type SheetRange = { range: string; values: string[][] };
export type SheetAppendInput = { spreadsheetId: string; range: string; values: string[][] };
export type SheetAppendResult = { updatedRange: string; updatedRows: number };
export type SheetCreateInput = { title: string };
export type SheetCreateResult = { spreadsheetId: string; webUrl: string };

export type SlidesSummary = {
  presentationId: string;
  title: string;
  slideCount: number;
  webUrl: string;
};
export type SlidesCreateInput = { title: string };
export type SlidesCreateResult = { presentationId: string; webUrl: string };

export type FormCreateInput = { title: string; description: string };
export type FormCreateResult = { formId: string; editUrl: string; responderUrl: string };
export type FormResponseSummary = {
  responseId: string;
  submittedAt: string | null;
  answerCount: number;
};
export type FormDetails = {
  formId: string;
  title: string;
  description: string;
  responderUri: string;
};
export type FormQuestion = {
  itemId: string;
  title: string;
  description?: string | undefined;
};
export type FormResponseSummaryStat = {
  formId: string;
  totalResponses: number;
  lastSubmittedTime: string | null;
};

export type MeetSpaceResult = { name: string; meetingUri: string; meetingCode: string };
export type MeetSpaceInfo = {
  name: string;
  meetingUri: string;
  meetingCode: string;
  config?: Record<string, unknown> | undefined;
};
export type ConferenceRecord = {
  name: string;
  startTime: string | null;
  endTime: string | null;
};
export type ConferenceParticipant = {
  name: string;
  earliestStartTime: string | null;
  latestEndTime: string | null;
};

export type ClassroomCourseSummary = {
  id: string;
  name: string;
  section: string | null;
  courseState: string;
};
export type ClassroomCourseWorkSummary = {
  id: string;
  title: string;
  dueDate: string | null;
  state: string;
};
export type ClassroomAnnouncement = {
  id: string;
  text: string;
  state: string;
  updateTime: string;
};
export type StudentSubmission = {
  id: string;
  userId: string;
  state: string;
  assignedGrade?: number | undefined;
};
export type CourseMaterial = {
  id: string;
  title: string;
  link?: string | undefined;
};
export type CourseWorkCreateInput = {
  title: string;
  description?: string | undefined;
  dueTime?: string | undefined;
};

export type ChatSpaceSummary = { name: string; displayName: string; type: string };
export type ChatSpaceDetails = {
  name: string;
  displayName: string;
  spaceType: string;
  description?: string | undefined;
};
export type ChatMessageInput = { space: string; text: string };
export type ChatMessageResult = { name: string; createTime: string };
export type ChatMessageSummary = {
  name: string;
  text: string;
  sender?: string | undefined;
  createTime: string;
};
export type ChatMemberSummary = {
  name: string;
  displayName?: string | undefined;
  state?: string | undefined;
};

/* ------------------------------------------------------------------ */
/* Stage 8 — Google Tasks                                             */
/* ------------------------------------------------------------------ */
export type TaskListSummary = {
  id: string;
  title: string;
  updated: string | null;
};
export type TaskSummary = {
  id: string;
  title: string;
  notes?: string | undefined;
  due?: string | null | undefined;
  status: string;
  completed?: string | null | undefined;
  updated?: string | null | undefined;
};
export type TaskCreateInput = {
  taskListId?: string | undefined;
  title: string;
  notes?: string | undefined;
  due?: string | undefined;
};
export type TaskUpdateInput = {
  taskListId: string;
  taskId: string;
  title?: string | undefined;
  notes?: string | undefined;
  due?: string | undefined;
  status?: string | undefined;
};

/* ------------------------------------------------------------------ */
/* Stage 8 — Google Contacts (People API)                             */
/* ------------------------------------------------------------------ */
export type ContactSummary = {
  resourceName: string;
  displayName: string;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  photoUrl?: string | null | undefined;
};
export type ContactCreateInput = {
  givenName: string;
  familyName?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
};
export type ContactUpdateInput = {
  resourceName: string;
  etag: string;
  givenName?: string | undefined;
  familyName?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
};

/* ------------------------------------------------------------------ */
/* Stage 8 — Google Maps Platform APIs                                */
/* ------------------------------------------------------------------ */
export type PlaceSummary = {
  placeId: string;
  name: string;
  formattedAddress: string;
  location: { lat: number; lng: number };
  rating?: number | undefined;
};
export type PlaceDetails = {
  placeId: string;
  name: string;
  formattedAddress: string;
  phone?: string | undefined;
  website?: string | undefined;
  rating?: number | undefined;
  location: { lat: number; lng: number };
};
export type GeocodeResult = {
  formattedAddress: string;
  location: { lat: number; lng: number };
  placeId: string;
};
export type DistanceResult = {
  origin: string;
  destination: string;
  distanceText: string;
  distanceMeters: number;
  durationText: string;
  durationSeconds: number;
};
export type DirectionRoute = {
  summary: string;
  distanceText: string;
  durationText: string;
  steps: string[];
};

/* ------------------------------------------------------------------ */
/* Stage 8 — YouTube Data API v3                                      */
/* ------------------------------------------------------------------ */
export type YouTubeVideoSummary = {
  id: string;
  title: string;
  description: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl: string;
};
export type YouTubeVideoDetails = {
  id: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  viewCount?: string | undefined;
  likeCount?: string | undefined;
  duration?: string | undefined;
};
export type YouTubeChannelSummary = {
  id: string;
  title: string;
  description: string;
  subscriberCount?: string | undefined;
  videoCount?: string | undefined;
};
export type YouTubePlaylistSummary = {
  id: string;
  title: string;
  description: string;
  itemCount: number;
};
export type YouTubePlaylistItem = {
  id: string;
  videoId: string;
  title: string;
  position: number;
};

export type ServiceCategory = "communication" | "productivity" | "education" | "location";

/** Static capability metadata for the "Capability/status display" — no secrets, safe on the client. */
export type ServiceCapability = {
  id: string;
  label: string;
  category: ServiceCategory;
  reads: boolean;
  writes: boolean;
  scopes: readonly string[];
  operations: readonly string[];
  requiresApiKey?: boolean | undefined;
};
