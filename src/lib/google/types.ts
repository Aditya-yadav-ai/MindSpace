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

export type MeetSpaceResult = { name: string; meetingUri: string; meetingCode: string };

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

export type ChatSpaceSummary = { name: string; displayName: string; type: string };
export type ChatMessageInput = { space: string; text: string };
export type ChatMessageResult = { name: string; createTime: string };

/** Static capability metadata for the "Capability/status display" — no secrets, safe on the client. */
export type ServiceCapability = {
  id: string;
  label: string;
  reads: boolean;
  writes: boolean;
  scopes: readonly string[];
};
