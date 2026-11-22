/**
 * Stage 8 — Default Google adapter when no account is connected.
 * Every method rejects with GoogleNotConnectedError so agents and tools
 * return uniform, user-friendly connection guidance instead of raw network failures.
 */
import type { GoogleServices } from "./adapter.server";
import { GoogleNotConnectedError } from "./types";

const fail = () => Promise.reject(new GoogleNotConnectedError());

export const notConnectedGoogleServices: GoogleServices = {
  connected: false,

  // 1. Gmail
  listRecentEmails: fail,
  createEmailDraft: fail,

  // 2. Calendar
  listUpcomingEvents: fail,
  createCalendarEvent: fail,

  // 3. Drive
  searchDriveFiles: fail,
  saveDriveFile: fail,

  // 4. Docs
  readDocument: fail,
  createDocument: fail,

  // 5. Sheets
  readSheetRange: fail,
  createSpreadsheet: fail,
  appendSheetValues: fail,

  // 6. Slides
  readPresentation: fail,
  createPresentation: fail,

  // 7. Meet
  createMeetingSpace: fail,
  getMeetingSpace: fail,
  listConferenceRecords: fail,
  listConferenceParticipants: fail,

  // 8. Forms
  createForm: fail,
  getForm: fail,
  getFormQuestions: fail,
  listFormResponses: fail,
  getFormResponseSummary: fail,

  // 9. Tasks
  listTaskLists: fail,
  createTaskList: fail,
  listTasks: fail,
  createTask: fail,
  updateTask: fail,
  completeTask: fail,
  deleteTask: fail,
  setTaskDueDate: fail,

  // 10. Contacts
  listContacts: fail,
  searchContacts: fail,
  getContact: fail,
  createContact: fail,
  updateContact: fail,
  deleteContact: fail,

  // 11. Chat
  listChatSpaces: fail,
  getChatSpace: fail,
  listChatMessages: fail,
  sendChatMessage: fail,
  createChatSpace: fail,
  listChatMembers: fail,

  // 12. Maps
  searchPlaces: fail,
  getPlaceDetails: fail,
  geocode: fail,
  reverseGeocode: fail,
  calculateDistance: fail,
  getDirections: fail,

  // 13. Classroom
  listClassroomCourses: fail,
  getClassroomCourse: fail,
  listClassroomCourseWork: fail,
  listClassroomAnnouncements: fail,
  listStudentSubmissions: fail,
  getClassroomMaterials: fail,
  createClassroomAnnouncement: fail,
  createClassroomCourseWork: fail,

  // 14. YouTube
  searchYouTubeVideos: fail,
  getYouTubeVideoDetails: fail,
  getYouTubeChannelDetails: fail,
  listYouTubePlaylists: fail,
  listYouTubePlaylistItems: fail,
  createYouTubePlaylist: fail,
};
