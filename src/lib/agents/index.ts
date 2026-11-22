/** Stage 8 — public entry point for the MindSpace agent framework. */
export * from "./types";
export { RunTracer } from "./tracer";
export {
  ToolRegistry,
  ToolError,
  defineTool,
  createBuiltinTools,
  createMockKbBackend,
} from "./tools";
export type { ToolContext, ToolDefinition, ToolDescriptor, KbBackend, KbHit } from "./tools";
export { BaseAgent, AgentRegistry, MessageBus, createMessage } from "./agent";
export type { Agent, AgentContext, AgentOutput, AgentTools, AgentDescriptor } from "./agent";
export { ExtractorAgent, SummarizerAgent, KnowledgeAgent, TaskDraftAgent } from "./worker-agents";

// 1. Gmail, Calendar, Drive agents
export {
  GmailAgent,
  CalendarAgent,
  DriveAgent,
  GoogleGmailAgent,
  GoogleCalendarAgent,
  GoogleDriveAgent,
} from "./google-agents";
export { createGoogleTools, CONSEQUENTIAL_GOOGLE_TOOLS } from "./google-tools";

// 2. Docs, Sheets, Slides, Forms, Meet, Classroom, Chat agents
export {
  DocsAgent,
  SheetsAgent,
  SlidesAgent,
  FormsAgent,
  MeetAgent,
  ClassroomAgent,
  ChatAgent,
  GoogleDocsAgent,
  GoogleSheetsAgent,
  GoogleSlidesAgent,
  GoogleFormsAgent,
  GoogleMeetAgent,
  GoogleClassroomAgent,
  GoogleChatAgent,
} from "./google-workspace-agents";
export {
  createGoogleWorkspaceTools,
  CONSEQUENTIAL_WORKSPACE_TOOLS,
} from "./google-workspace-tools";

// 3. Tasks, Contacts, Maps, YouTube agents
export {
  GoogleTasksAgent,
  TasksAgent,
  GoogleContactsAgent,
  ContactsAgent,
  GoogleMapsAgent,
  MapsAgent,
  YouTubeAgent,
  GoogleYouTubeAgent,
} from "./google-extended-agents";
export { createGoogleExtendedTools, CONSEQUENTIAL_EXTENDED_TOOLS } from "./google-extended-tools";

// 4. Research & general agents
export { ResearchAgent, HeuristicReasoner } from "./research-agent";
export type { Reasoner, ReactState, ReactStep, ReactDecision } from "./research-agent";
export { createWebTools, fetchPage, webSearch, extractProduct } from "./web-tools";
export type { FetchedPage, WebSearchHit, ProductCandidate } from "./web-tools";
export { createReminderTools, CONSEQUENTIAL_REMINDER_TOOLS } from "./reminder-tools";
export { WebReaderAgent } from "./web-reader-agent";
export { ProductAgent } from "./product-agent";
export { ReminderAgent } from "./reminder-agent";
export { planGoal, newRunId } from "./planner";
export { verifyWorkflow } from "./verifier";
export { buildMindSpaceAgents, runWorkflow } from "./manager";
export type { RunWorkflowOptions } from "./manager";
