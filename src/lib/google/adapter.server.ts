/**
 * Stage 5/6 — Google adapter for the agent framework.
 * One place that turns "an authenticated user" into the set of Google
 * operations the ten service agents are allowed to call. Every method
 * resolves a fresh access token per call (cheap: cached per-connection,
 * refreshed only near expiry) so a long-running workflow never uses a stale
 * token.
 */
import { getValidAccessToken } from "./oauth.server";
import * as gmail from "./gmail.server";
import * as calendar from "./calendar.server";
import * as drive from "./drive.server";
import * as docs from "./docs.server";
import * as sheets from "./sheets.server";
import * as slides from "./slides.server";
import * as forms from "./forms.server";
import * as meet from "./meet.server";
import * as classroom from "./classroom.server";
import * as chat from "./chat.server";
import type {
  CalendarEventInput,
  CalendarEventResult,
  CalendarEventSummary,
  ChatMessageInput,
  ChatMessageResult,
  ChatSpaceSummary,
  ClassroomCourseSummary,
  ClassroomCourseWorkSummary,
  DocCreateInput,
  DocCreateResult,
  DocSummary,
  DriveFileSummary,
  DriveSaveInput,
  DriveSaveResult,
  FormCreateInput,
  FormCreateResult,
  FormResponseSummary,
  GmailDraftInput,
  GmailDraftResult,
  GmailMessageSummary,
  MeetSpaceResult,
  SheetAppendInput,
  SheetAppendResult,
  SheetCreateInput,
  SheetCreateResult,
  SheetRange,
  SlidesCreateInput,
  SlidesCreateResult,
  SlidesSummary,
} from "./types";

/** The surface the agent framework depends on. See `not-connected.ts` for the offline stand-in used when no account is connected. */
export interface GoogleServices {
  readonly connected: boolean;
  listRecentEmails(input: { query: string; limit: number }): Promise<GmailMessageSummary[]>;
  createEmailDraft(input: GmailDraftInput): Promise<GmailDraftResult>;
  listUpcomingEvents(input: { maxResults: number }): Promise<CalendarEventSummary[]>;
  createCalendarEvent(input: CalendarEventInput): Promise<CalendarEventResult>;
  searchDriveFiles(input: { query: string; limit: number }): Promise<DriveFileSummary[]>;
  saveDriveFile(input: DriveSaveInput): Promise<DriveSaveResult>;
  readDocument(documentId: string): Promise<DocSummary>;
  createDocument(input: DocCreateInput): Promise<DocCreateResult>;
  readSheetRange(spreadsheetId: string, range: string): Promise<SheetRange>;
  createSpreadsheet(input: SheetCreateInput): Promise<SheetCreateResult>;
  appendSheetValues(input: SheetAppendInput): Promise<SheetAppendResult>;
  readPresentation(presentationId: string): Promise<SlidesSummary>;
  createPresentation(input: SlidesCreateInput): Promise<SlidesCreateResult>;
  createForm(input: FormCreateInput): Promise<FormCreateResult>;
  listFormResponses(formId: string, limit: number): Promise<FormResponseSummary[]>;
  createMeetingSpace(): Promise<MeetSpaceResult>;
  listClassroomCourses(limit: number): Promise<ClassroomCourseSummary[]>;
  listClassroomCourseWork(courseId: string, limit: number): Promise<ClassroomCourseWorkSummary[]>;
  listChatSpaces(limit: number): Promise<ChatSpaceSummary[]>;
  sendChatMessage(input: ChatMessageInput): Promise<ChatMessageResult>;
}

/** Real, per-request Google services for `userId`. Every call re-resolves a valid token first. */
export function createGoogleServices(userId: string): GoogleServices {
  const token = () => getValidAccessToken(userId);
  return {
    connected: true,
    async listRecentEmails(input) {
      return gmail.listRecentMessages(await token(), input);
    },
    async createEmailDraft(input) {
      return gmail.createDraft(await token(), input);
    },
    async listUpcomingEvents(input) {
      return calendar.listUpcomingEvents(await token(), input);
    },
    async createCalendarEvent(input) {
      return calendar.createEvent(await token(), input);
    },
    async searchDriveFiles(input) {
      return drive.searchFiles(await token(), input);
    },
    async saveDriveFile(input) {
      return drive.saveTextFile(await token(), input);
    },
    async readDocument(documentId) {
      return docs.readDocument(await token(), documentId);
    },
    async createDocument(input) {
      return docs.createDocument(await token(), input);
    },
    async readSheetRange(spreadsheetId, range) {
      return sheets.readRange(await token(), spreadsheetId, range);
    },
    async createSpreadsheet(input) {
      return sheets.createSpreadsheet(await token(), input);
    },
    async appendSheetValues(input) {
      return sheets.appendValues(await token(), input);
    },
    async readPresentation(presentationId) {
      return slides.readPresentation(await token(), presentationId);
    },
    async createPresentation(input) {
      return slides.createPresentation(await token(), input);
    },
    async createForm(input) {
      return forms.createForm(await token(), input);
    },
    async listFormResponses(formId, limit) {
      return forms.listResponses(await token(), formId, limit);
    },
    async createMeetingSpace() {
      return meet.createMeetingSpace(await token());
    },
    async listClassroomCourses(limit) {
      return classroom.listCourses(await token(), limit);
    },
    async listClassroomCourseWork(courseId, limit) {
      return classroom.listCourseWork(await token(), courseId, limit);
    },
    async listChatSpaces(limit) {
      return chat.listSpaces(await token(), limit);
    },
    async sendChatMessage(input) {
      return chat.sendMessage(await token(), input);
    },
  };
}
