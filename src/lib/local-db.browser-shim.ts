/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MindSpace Stage 8 — Browser / Extension Client Storage Shim for local-db.server.
 * Implements pure localStorage-backed persistence for tasks, automations, chat turns,
 * and agent runs without requiring Node.js 'node:sqlite' (DatabaseSync) runtime.
 */
import type { AutomationRecord, AutomationRunRecord } from "./automations.functions";
import type { AgentRunDetail, AgentRunSummary, ChatTurnRecord } from "./history.functions";
import type { TaskRecord } from "./tasks.functions";

const TASKS_KEY = "mindspace.local_tasks.v1";
const AUTOMATIONS_KEY = "mindspace.local_automations.v1";
const AUTO_RUNS_KEY = "mindspace.local_automation_runs.v1";
const CHAT_TURNS_KEY = "mindspace.local_chat_turns.v1";
const AGENT_RUNS_KEY = "mindspace.local_agent_runs.v1";

function readStorage<T>(key: string): T[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStorage<T>(key: string, items: T[]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Storage quota or sandboxed
  }
}

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "id-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
}

/* -------------------------------------------------------------------------- */
/* Automations CRUD                                                           */
/* -------------------------------------------------------------------------- */

export function getLocalAutomations(userId: string): AutomationRecord[] {
  const all = readStorage<AutomationRecord & { user_id?: string }>(AUTOMATIONS_KEY);
  return all.filter((a) => !a.user_id || a.user_id === userId);
}

export function createLocalAutomation(
  userId: string,
  data: {
    name: string;
    goal: string;
    schedule_kind?: "hourly" | "daily" | "weekly";
    scheduleKind?: "hourly" | "daily" | "weekly";
    schedule_hour?: number;
    scheduleHour?: number;
    schedule_day_of_week?: number | null;
    scheduleDayOfWeek?: number | null;
    approved_tools?: string[];
    approvedTools?: string[];
    nextRunAt?: string;
    next_run_at?: string;
  },
): AutomationRecord {
  const items = readStorage<AutomationRecord & { user_id: string }>(AUTOMATIONS_KEY);
  const now = new Date().toISOString();
  const kind = data.scheduleKind ?? data.schedule_kind ?? "daily";
  const hour = data.scheduleHour ?? data.schedule_hour ?? 9;
  const dow =
    data.scheduleDayOfWeek !== undefined
      ? data.scheduleDayOfWeek
      : (data.schedule_day_of_week ?? null);
  const tools = data.approvedTools || data.approved_tools || [];
  const nextRun = data.nextRunAt || data.next_run_at || now;

  const record: AutomationRecord & { user_id: string } = {
    id: generateId(),
    user_id: userId,
    name: data.name,
    goal: data.goal,
    schedule_kind: kind,
    schedule_hour: hour,
    schedule_day_of_week: dow,
    approved_tools: tools,
    enabled: true,
    last_run_at: null,
    next_run_at: nextRun,
    created_at: now,
  };
  items.unshift(record);
  writeStorage(AUTOMATIONS_KEY, items);
  return record;
}

export function updateLocalAutomation(
  automationId: string,
  patch: Partial<Omit<AutomationRecord, "id" | "created_at">>,
): void {
  const items = readStorage<AutomationRecord>(AUTOMATIONS_KEY);
  const idx = items.findIndex((a) => a.id === automationId);
  if (idx >= 0 && items[idx]) {
    items[idx] = { ...items[idx], ...patch };
    writeStorage(AUTOMATIONS_KEY, items);
  }
}

export function deleteLocalAutomation(automationId: string): void {
  const items = readStorage<AutomationRecord>(AUTOMATIONS_KEY);
  writeStorage(
    AUTOMATIONS_KEY,
    items.filter((a) => a.id !== automationId),
  );
}

export function getLocalAutomation(automationId: string): AutomationRecord | null {
  const items = readStorage<AutomationRecord>(AUTOMATIONS_KEY);
  return items.find((a) => a.id === automationId) || null;
}

export function getLocalAutomationRuns(automationId: string): AutomationRunRecord[] {
  const runs = readStorage<AutomationRunRecord & { automation_id?: string }>(AUTO_RUNS_KEY);
  return runs.filter((r) => r.automation_id === automationId).slice(0, 20);
}

export function recordLocalAutomationRun(data: {
  automationId: string;
  userId: string;
  agentRunId?: string | null;
  status: "success" | "partial" | "failed" | string;
  summary: string;
  ranAt?: string;
}): void {
  const runs = readStorage<AutomationRunRecord & { automation_id: string; user_id: string }>(
    AUTO_RUNS_KEY,
  );
  runs.unshift({
    id: generateId(),
    automation_id: data.automationId,
    user_id: data.userId,
    agent_run_id: data.agentRunId || null,
    status: data.status,
    summary: data.summary,
    ran_at: data.ranAt || new Date().toISOString(),
  });
  writeStorage(AUTO_RUNS_KEY, runs.slice(0, 100));
}

/* -------------------------------------------------------------------------- */
/* Agent Runs (Task History) CRUD                                             */
/* -------------------------------------------------------------------------- */

export function getLocalAgentRuns(
  userId: string,
  searchOrOptions?: string | { search?: string; status?: string; limit?: number },
  status: string = "all",
  limit: number = 30,
): AgentRunSummary[] {
  const runs = readStorage<AgentRunSummary & { user_id?: string; goal?: string; answer?: string }>(
    AGENT_RUNS_KEY,
  );

  let searchStr = "";
  let statusStr = status;
  let limitNum = limit;

  if (typeof searchOrOptions === "object" && searchOrOptions !== null) {
    searchStr = typeof searchOrOptions.search === "string" ? searchOrOptions.search : "";
    statusStr = searchOrOptions.status || status;
    limitNum = searchOrOptions.limit ?? limit;
  } else if (typeof searchOrOptions === "string") {
    searchStr = searchOrOptions;
  }

  let filtered = runs.filter((r) => !r.user_id || r.user_id === userId);
  if (statusStr && statusStr !== "all") {
    filtered = filtered.filter((r) => r.status === statusStr);
  }
  if (searchStr.trim()) {
    const q = searchStr.trim().toLowerCase();
    filtered = filtered.filter(
      (r) => (r.goal || "").toLowerCase().includes(q) || (r.answer || "").toLowerCase().includes(q),
    );
  }
  return filtered.slice(0, limitNum);
}

export function getLocalAgentRun(runId: string): AgentRunDetail | null {
  const runs = readStorage<AgentRunDetail>(AGENT_RUNS_KEY);
  return runs.find((r) => r.id === runId) || null;
}

export function deleteLocalAgentRun(runId: string): void {
  const runs = readStorage<AgentRunDetail>(AGENT_RUNS_KEY);
  writeStorage(
    AGENT_RUNS_KEY,
    runs.filter((r) => r.id !== runId),
  );
}

export function recordLocalAgentRun(userId: string, data: any): void {
  const runs = readStorage<AgentRunDetail & { user_id: string }>(AGENT_RUNS_KEY);
  const now = new Date().toISOString();
  const id = data.id || data.runId || generateId();
  const detail: AgentRunDetail & { user_id: string } = {
    id,
    user_id: userId,
    goal: data.goal || "Agent Task",
    status: data.status || "verified",
    answer: data.answer || "",
    verification_verdict: data.verificationVerdict ?? data.verification?.verdict ?? null,
    verification_score: data.verificationScore ?? data.verification?.score ?? null,
    step_count: data.stepCount ?? data.step_count ?? data.steps?.length ?? 0,
    failed_count:
      data.failedCount ??
      data.failed_count ??
      (data.steps || []).filter((s: any) => s.status === "failed").length,
    plan: data.plan || { strategy: "", stepGoals: [], notes: [] },
    steps: data.steps || [],
    verification: data.verification || { verdict: "pass", score: 1, summary: "", checks: [] },
    automation_id: data.automationId ?? data.automation_id ?? null,
    created_at: now,
  };
  const filtered = runs.filter((r) => r.id !== id);
  filtered.unshift(detail);
  writeStorage(AGENT_RUNS_KEY, filtered.slice(0, 50));
}

/* -------------------------------------------------------------------------- */
/* Chat Turns CRUD                                                            */
/* -------------------------------------------------------------------------- */

export function getLocalChatTurns(
  userId: string,
  searchOrOptions?: string | { search?: string; limit?: number },
  limit: number = 60,
): ChatTurnRecord[] {
  const turns = readStorage<ChatTurnRecord & { user_id?: string; content?: string }>(
    CHAT_TURNS_KEY,
  );

  let searchStr = "";
  let limitNum = limit;

  if (typeof searchOrOptions === "object" && searchOrOptions !== null) {
    searchStr = typeof searchOrOptions.search === "string" ? searchOrOptions.search : "";
    limitNum = searchOrOptions.limit ?? limit;
  } else if (typeof searchOrOptions === "string") {
    searchStr = searchOrOptions;
  }

  let filtered = turns.filter((t) => !t.user_id || t.user_id === userId);
  if (searchStr.trim()) {
    const q = searchStr.trim().toLowerCase();
    filtered = filtered.filter((t) => (t.content || "").toLowerCase().includes(q));
  }
  return filtered.slice(0, limitNum);
}

export function recordLocalChatTurn(
  userId: string,
  data: { role: string; content: string; pageTitle?: string | null; pageUrl?: string | null },
): ChatTurnRecord {
  const turns = readStorage<ChatTurnRecord & { user_id: string }>(CHAT_TURNS_KEY);
  const record: ChatTurnRecord & { user_id: string } = {
    id: generateId(),
    user_id: userId,
    role: data.role as "user" | "assistant",
    content: data.content,
    page_title: data.pageTitle || null,
    page_url: data.pageUrl || null,
    created_at: new Date().toISOString(),
  };
  turns.unshift(record);
  writeStorage(CHAT_TURNS_KEY, turns.slice(0, 100));
  return record;
}

export function deleteLocalChatTurn(turnId: string): void {
  const turns = readStorage<ChatTurnRecord>(CHAT_TURNS_KEY);
  writeStorage(
    CHAT_TURNS_KEY,
    turns.filter((t) => t.id !== turnId),
  );
}

export function clearLocalChatTurns(userId: string): void {
  const turns = readStorage<ChatTurnRecord & { user_id?: string }>(CHAT_TURNS_KEY);
  writeStorage(
    CHAT_TURNS_KEY,
    turns.filter((t) => t.user_id && t.user_id !== userId),
  );
}

/* -------------------------------------------------------------------------- */
/* Tasks CRUD                                                                 */
/* -------------------------------------------------------------------------- */

export function getLocalTasks(userId: string): TaskRecord[] {
  const tasks = readStorage<TaskRecord & { user_id?: string }>(TASKS_KEY);
  return tasks
    .filter((t) => !t.user_id || t.user_id === userId)
    .map((t) => ({
      id: t.id,
      title: t.title,
      notes: t.notes || "",
      due_at: t.due_at || null,
      status: t.status || "pending",
      source: "manual" as const,
      source_run_id: null,
      created_at: t.created_at,
      updated_at: t.updated_at,
    }));
}

export function createLocalTask(
  userId: string,
  data: { title: string; notes?: string; dueAt?: string | null },
): TaskRecord {
  const tasks = readStorage<TaskRecord & { user_id: string }>(TASKS_KEY);
  const now = new Date().toISOString();
  const record: TaskRecord & { user_id: string } = {
    id: generateId(),
    user_id: userId,
    title: data.title,
    notes: data.notes || "",
    due_at: data.dueAt || null,
    status: "pending",
    source: "manual",
    source_run_id: null,
    created_at: now,
    updated_at: now,
  };
  tasks.unshift(record);
  writeStorage(TASKS_KEY, tasks);
  return record;
}

export function updateLocalTaskStatus(taskId: string, status: "pending" | "done"): void {
  const tasks = readStorage<TaskRecord>(TASKS_KEY);
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx >= 0 && tasks[idx]) {
    tasks[idx].status = status;
    tasks[idx].updated_at = new Date().toISOString();
    writeStorage(TASKS_KEY, tasks);
  }
}

export function deleteLocalTask(taskId: string): void {
  const tasks = readStorage<TaskRecord>(TASKS_KEY);
  writeStorage(
    TASKS_KEY,
    tasks.filter((t) => t.id !== taskId),
  );
}
