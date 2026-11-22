/**
 * Stage 8 — Google adapter for the agent framework.
 * One place that turns "an authenticated user" into the set of Google
 * operations the 14 service agents are allowed to call. Every method
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
import * as tasks from "./tasks.server";
import * as contacts from "./contacts.server";
import * as maps from "./maps.server";
import * as youtube from "./youtube.server";
import type {
  CalendarEventInput,
  CalendarEventResult,
  CalendarEventSummary,
  ChatMemberSummary,
  ChatMessageInput,
  ChatMessageResult,
  ChatMessageSummary,
  ChatSpaceDetails,
  ChatSpaceSummary,
  ClassroomAnnouncement,
  ClassroomCourseSummary,
  ClassroomCourseWorkSummary,
  ConferenceParticipant,
  ConferenceRecord,
  ContactCreateInput,
  ContactSummary,
  ContactUpdateInput,
  CourseMaterial,
  CourseWorkCreateInput,
  DirectionRoute,
  DistanceResult,
  DocCreateInput,
  DocCreateResult,
  DocSummary,
  DriveFileSummary,
  DriveSaveInput,
  DriveSaveResult,
  FormCreateInput,
  FormCreateResult,
  FormDetails,
  FormQuestion,
  FormResponseSummary,
  FormResponseSummaryStat,
  GeocodeResult,
  GmailDraftInput,
  GmailDraftResult,
  GmailMessageSummary,
  MeetSpaceInfo,
  MeetSpaceResult,
  PlaceDetails,
  PlaceSummary,
  SheetAppendInput,
  SheetAppendResult,
  SheetCreateInput,
  SheetCreateResult,
  SheetRange,
  SlidesCreateInput,
  SlidesCreateResult,
  SlidesSummary,
  StudentSubmission,
  TaskCreateInput,
  TaskListSummary,
  TaskSummary,
  TaskUpdateInput,
  YouTubeChannelSummary,
  YouTubePlaylistItem,
  YouTubePlaylistSummary,
  YouTubeVideoDetails,
  YouTubeVideoSummary,
} from "./types";

/** The surface the agent framework depends on. See `not-connected.ts` for the offline stand-in used when no account is connected. */
export interface GoogleServices {
  readonly connected: boolean;

  // 1. Gmail
  listRecentEmails(input: { query: string; limit: number }): Promise<GmailMessageSummary[]>;
  createEmailDraft(input: GmailDraftInput): Promise<GmailDraftResult>;

  // 2. Google Calendar
  listUpcomingEvents(input: { maxResults: number }): Promise<CalendarEventSummary[]>;
  createCalendarEvent(input: CalendarEventInput): Promise<CalendarEventResult>;

  // 3. Google Drive
  searchDriveFiles(input: { query: string; limit: number }): Promise<DriveFileSummary[]>;
  saveDriveFile(input: DriveSaveInput): Promise<DriveSaveResult>;

  // 4. Google Docs
  readDocument(documentId: string): Promise<DocSummary>;
  createDocument(input: DocCreateInput): Promise<DocCreateResult>;

  // 5. Google Sheets
  readSheetRange(spreadsheetId: string, range: string): Promise<SheetRange>;
  createSpreadsheet(input: SheetCreateInput): Promise<SheetCreateResult>;
  appendSheetValues(input: SheetAppendInput): Promise<SheetAppendResult>;

  // 6. Google Slides
  readPresentation(presentationId: string): Promise<SlidesSummary>;
  createPresentation(input: SlidesCreateInput): Promise<SlidesCreateResult>;

  // 7. Google Meet
  createMeetingSpace(input?: { topic?: string }): Promise<MeetSpaceResult>;
  getMeetingSpace(spaceName: string): Promise<MeetSpaceInfo>;
  listConferenceRecords(limit?: number): Promise<ConferenceRecord[]>;
  listConferenceParticipants(
    conferenceRecord: string,
    limit?: number,
  ): Promise<ConferenceParticipant[]>;

  // 8. Google Forms
  createForm(input: FormCreateInput): Promise<FormCreateResult>;
  getForm(formId: string): Promise<FormDetails>;
  getFormQuestions(formId: string): Promise<FormQuestion[]>;
  listFormResponses(formId: string, limit?: number): Promise<FormResponseSummary[]>;
  getFormResponseSummary(formId: string): Promise<FormResponseSummaryStat>;

  // 9. Google Tasks
  listTaskLists(limit?: number): Promise<TaskListSummary[]>;
  createTaskList(title: string): Promise<TaskListSummary>;
  listTasks(taskListId?: string, showCompleted?: boolean, limit?: number): Promise<TaskSummary[]>;
  createTask(input: TaskCreateInput): Promise<TaskSummary>;
  updateTask(input: TaskUpdateInput): Promise<TaskSummary>;
  completeTask(taskListId: string, taskId: string): Promise<TaskSummary>;
  deleteTask(taskListId: string, taskId: string): Promise<{ ok: true; taskId: string }>;
  setTaskDueDate(taskListId: string, taskId: string, dueDate: string): Promise<TaskSummary>;

  // 10. Google Contacts
  listContacts(limit?: number): Promise<ContactSummary[]>;
  searchContacts(query: string, limit?: number): Promise<ContactSummary[]>;
  getContact(resourceName: string): Promise<ContactSummary>;
  createContact(input: ContactCreateInput): Promise<ContactSummary>;
  updateContact(input: ContactUpdateInput): Promise<ContactSummary>;
  deleteContact(resourceName: string): Promise<{ ok: true; resourceName: string }>;

  // 11. Google Chat
  listChatSpaces(limit?: number): Promise<ChatSpaceSummary[]>;
  getChatSpace(spaceName: string): Promise<ChatSpaceDetails>;
  listChatMessages(spaceName: string, limit?: number): Promise<ChatMessageSummary[]>;
  sendChatMessage(input: ChatMessageInput): Promise<ChatMessageResult>;
  createChatSpace(displayName: string): Promise<ChatSpaceDetails>;
  listChatMembers(spaceName: string, limit?: number): Promise<ChatMemberSummary[]>;

  // 12. Google Maps
  searchPlaces(query: string): Promise<PlaceSummary[]>;
  getPlaceDetails(placeId: string): Promise<PlaceDetails>;
  geocode(address: string): Promise<GeocodeResult[]>;
  reverseGeocode(lat: number, lng: number): Promise<GeocodeResult[]>;
  calculateDistance(origins: string[], destinations: string[]): Promise<DistanceResult[]>;
  getDirections(origin: string, destination: string): Promise<DirectionRoute[]>;

  // 13. Google Classroom
  listClassroomCourses(limit?: number): Promise<ClassroomCourseSummary[]>;
  getClassroomCourse(courseId: string): Promise<ClassroomCourseSummary>;
  listClassroomCourseWork(courseId: string, limit?: number): Promise<ClassroomCourseWorkSummary[]>;
  listClassroomAnnouncements(courseId: string, limit?: number): Promise<ClassroomAnnouncement[]>;
  listStudentSubmissions(
    courseId: string,
    courseWorkId: string,
    limit?: number,
  ): Promise<StudentSubmission[]>;
  getClassroomMaterials(courseId: string): Promise<CourseMaterial[]>;
  createClassroomAnnouncement(courseId: string, text: string): Promise<ClassroomAnnouncement>;
  createClassroomCourseWork(
    courseId: string,
    input: CourseWorkCreateInput,
  ): Promise<ClassroomCourseWorkSummary>;

  // 14. YouTube
  searchYouTubeVideos(query: string, limit?: number): Promise<YouTubeVideoSummary[]>;
  getYouTubeVideoDetails(videoId: string): Promise<YouTubeVideoDetails>;
  getYouTubeChannelDetails(channelId: string): Promise<YouTubeChannelSummary>;
  listYouTubePlaylists(channelId?: string, limit?: number): Promise<YouTubePlaylistSummary[]>;
  listYouTubePlaylistItems(playlistId: string, limit?: number): Promise<YouTubePlaylistItem[]>;
  createYouTubePlaylist(title: string, description?: string): Promise<YouTubePlaylistSummary>;
}

/** Real, per-request Google services for `userId`. Every call re-resolves a valid token first. */
export function createGoogleServices(userId: string): GoogleServices {
  const token = () => getValidAccessToken(userId);
  return {
    connected: true,

    // 1. Gmail
    async listRecentEmails(input) {
      return gmail.listRecentMessages(await token(), input);
    },
    async createEmailDraft(input) {
      return gmail.createDraft(await token(), input);
    },

    // 2. Calendar
    async listUpcomingEvents(input) {
      return calendar.listUpcomingEvents(await token(), input);
    },
    async createCalendarEvent(input) {
      return calendar.createEvent(await token(), input);
    },

    // 3. Drive
    async searchDriveFiles(input) {
      return drive.searchFiles(await token(), input);
    },
    async saveDriveFile(input) {
      return drive.saveTextFile(await token(), input);
    },

    // 4. Docs
    async readDocument(documentId) {
      return docs.readDocument(await token(), documentId);
    },
    async createDocument(input) {
      return docs.createDocument(await token(), input);
    },

    // 5. Sheets
    async readSheetRange(spreadsheetId, range) {
      return sheets.readRange(await token(), spreadsheetId, range);
    },
    async createSpreadsheet(input) {
      return sheets.createSpreadsheet(await token(), input);
    },
    async appendSheetValues(input) {
      return sheets.appendValues(await token(), input);
    },

    // 6. Slides
    async readPresentation(presentationId) {
      return slides.readPresentation(await token(), presentationId);
    },
    async createPresentation(input) {
      return slides.createPresentation(await token(), input);
    },

    // 7. Meet
    async createMeetingSpace(input) {
      return meet.createMeetingSpace(await token(), input);
    },
    async getMeetingSpace(spaceName) {
      return meet.getMeetingSpace(await token(), spaceName);
    },
    async listConferenceRecords(limit) {
      return meet.listConferenceRecords(await token(), limit);
    },
    async listConferenceParticipants(conferenceRecord, limit) {
      return meet.listConferenceParticipants(await token(), conferenceRecord, limit);
    },

    // 8. Forms
    async createForm(input) {
      return forms.createForm(await token(), input);
    },
    async getForm(formId) {
      return forms.getForm(await token(), formId);
    },
    async getFormQuestions(formId) {
      return forms.getFormQuestions(await token(), formId);
    },
    async listFormResponses(formId, limit) {
      return forms.listResponses(await token(), formId, limit);
    },
    async getFormResponseSummary(formId) {
      return forms.getFormResponseSummary(await token(), formId);
    },

    // 9. Tasks
    async listTaskLists(limit) {
      return tasks.listTaskLists(await token(), limit);
    },
    async createTaskList(title) {
      return tasks.createTaskList(await token(), title);
    },
    async listTasks(taskListId, showCompleted, limit) {
      return tasks.listTasks(await token(), taskListId, showCompleted, limit);
    },
    async createTask(input) {
      return tasks.createTask(await token(), input);
    },
    async updateTask(input) {
      return tasks.updateTask(await token(), input);
    },
    async completeTask(taskListId, taskId) {
      return tasks.completeTask(await token(), taskListId, taskId);
    },
    async deleteTask(taskListId, taskId) {
      return tasks.deleteTask(await token(), taskListId, taskId);
    },
    async setTaskDueDate(taskListId, taskId, dueDate) {
      return tasks.setTaskDueDate(await token(), taskListId, taskId, dueDate);
    },

    // 10. Contacts
    async listContacts(limit) {
      return contacts.listContacts(await token(), limit);
    },
    async searchContacts(query, limit) {
      return contacts.searchContacts(await token(), query, limit);
    },
    async getContact(resourceName) {
      return contacts.getContact(await token(), resourceName);
    },
    async createContact(input) {
      return contacts.createContact(await token(), input);
    },
    async updateContact(input) {
      return contacts.updateContact(await token(), input);
    },
    async deleteContact(resourceName) {
      return contacts.deleteContact(await token(), resourceName);
    },

    // 11. Chat
    async listChatSpaces(limit) {
      return chat.listSpaces(await token(), limit);
    },
    async getChatSpace(spaceName) {
      return chat.getSpace(await token(), spaceName);
    },
    async listChatMessages(spaceName, limit) {
      return chat.listMessages(await token(), spaceName, limit);
    },
    async sendChatMessage(input) {
      return chat.sendMessage(await token(), input);
    },
    async createChatSpace(displayName) {
      return chat.createSpace(await token(), displayName);
    },
    async listChatMembers(spaceName, limit) {
      return chat.listMembers(await token(), spaceName, limit);
    },

    // 12. Maps (Platform API key backend)
    async searchPlaces(query) {
      return maps.searchPlaces(query);
    },
    async getPlaceDetails(placeId) {
      return maps.getPlaceDetails(placeId);
    },
    async geocode(address) {
      return maps.geocode(address);
    },
    async reverseGeocode(lat, lng) {
      return maps.reverseGeocode(lat, lng);
    },
    async calculateDistance(origins, destinations) {
      return maps.calculateDistance(origins, destinations);
    },
    async getDirections(origin, destination) {
      return maps.getDirections(origin, destination);
    },

    // 13. Classroom
    async listClassroomCourses(limit) {
      return classroom.listCourses(await token(), limit);
    },
    async getClassroomCourse(courseId) {
      return classroom.getCourse(await token(), courseId);
    },
    async listClassroomCourseWork(courseId, limit) {
      return classroom.listCourseWork(await token(), courseId, limit);
    },
    async listClassroomAnnouncements(courseId, limit) {
      return classroom.listAnnouncements(await token(), courseId, limit);
    },
    async listStudentSubmissions(courseId, courseWorkId, limit) {
      return classroom.listStudentSubmissions(await token(), courseId, courseWorkId, limit);
    },
    async getClassroomMaterials(courseId) {
      return classroom.getCourseMaterials(await token(), courseId);
    },
    async createClassroomAnnouncement(courseId, text) {
      return classroom.createAnnouncement(await token(), courseId, text);
    },
    async createClassroomCourseWork(courseId, input) {
      return classroom.createCourseWork(await token(), courseId, input);
    },

    // 14. YouTube
    async searchYouTubeVideos(query, limit) {
      return youtube.searchVideos(await token(), query, limit);
    },
    async getYouTubeVideoDetails(videoId) {
      return youtube.getVideoDetails(await token(), videoId);
    },
    async getYouTubeChannelDetails(channelId) {
      return youtube.getChannelDetails(await token(), channelId);
    },
    async listYouTubePlaylists(channelId, limit) {
      return youtube.listPlaylists(await token(), channelId, limit);
    },
    async listYouTubePlaylistItems(playlistId, limit) {
      return youtube.listPlaylistItems(await token(), playlistId, limit);
    },
    async createYouTubePlaylist(title, description) {
      return youtube.createPlaylist(await token(), title, description);
    },
  };
}
