/**
 * Stage 5/6 — the default Google adapter when no account is connected (or no
 * authenticated user is available at all, e.g. a local script). Every method
 * throws the same typed error so tools can turn it into one clear, uniform
 * message instead of ten different ones.
 */
import type { GoogleServices } from "./adapter.server";
import { GoogleNotConnectedError } from "./types";

const fail = () => Promise.reject(new GoogleNotConnectedError());

export const notConnectedGoogleServices: GoogleServices = {
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
  createForm: fail,
  listFormResponses: fail,
  createMeetingSpace: fail,
  listClassroomCourses: fail,
  listClassroomCourseWork: fail,
  listChatSpaces: fail,
  sendChatMessage: fail,
};
