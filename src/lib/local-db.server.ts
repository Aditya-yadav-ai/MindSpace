/**
 * MindSpace Stage 8 — Resilient Native SQLite Persistence Engine.
 *
 * Provides persistent SQLite fallback storage when Supabase is not configured
 * or offline. Shared across Automations, Agent Task History, Tasks, and Chat.
 * Uses Node.js native `DatabaseSync` in WAL mode with multi-tenant isolation.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AutomationRecord, AutomationRunRecord } from "./automations.functions";
import type { AgentRunDetail, AgentRunSummary, ChatTurnRecord } from "./history.functions";
import type { TaskRecord } from "./tasks.functions";

let _db: DatabaseSync | null = null;

function getDbPath(): string {
  if (process.env.MINDSPACE_AUTH_DB_PATH) {
    return process.env.MINDSPACE_AUTH_DB_PATH;
  }
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "apps/api/mas/outputs"))) {
    return path.join(cwd, "apps/api/mas/outputs/mindspace_auth.db");
  }
  if (fs.existsSync(path.join(cwd, "mindspace-stage8/apps/api/mas/outputs"))) {
    return path.join(cwd, "mindspace-stage8/apps/api/mas/outputs/mindspace_auth.db");
  }
  return path.resolve(cwd, "apps/api/mas/outputs/mindspace_auth.db");
}

function getDb(): DatabaseSync {
  if (!_db) {
    const dbPath = getDbPath();
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    _db = new DatabaseSync(dbPath);
    _db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS local_automations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        goal TEXT NOT NULL,
        schedule_kind TEXT NOT NULL,
        schedule_hour INTEGER NOT NULL,
        schedule_day_of_week INTEGER,
        approved_tools TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run_at TEXT,
        next_run_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_automations_user ON local_automations(user_id);

      CREATE TABLE IF NOT EXISTS local_automation_runs (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        agent_run_id TEXT,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        ran_at TEXT NOT NULL,
        FOREIGN KEY (automation_id) REFERENCES local_automations(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_autoruns_auto ON local_automation_runs(automation_id);

      CREATE TABLE IF NOT EXISTS local_agent_runs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        answer TEXT NOT NULL,
        verification_verdict TEXT,
        verification_score REAL,
        step_count INTEGER NOT NULL,
        failed_count INTEGER NOT NULL,
        plan_json TEXT NOT NULL,
        steps_json TEXT NOT NULL,
        verification_json TEXT NOT NULL,
        automation_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON local_agent_runs(user_id);

      CREATE TABLE IF NOT EXISTS local_chat_turns (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        page_title TEXT,
        page_url TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_turns_user ON local_chat_turns(user_id);

      CREATE TABLE IF NOT EXISTS local_tasks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        due_at TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_user ON local_tasks(user_id);
    `);
  }
  return _db;
}

/* -------------------------------------------------------------------------- */
/* Automations CRUD                                                           */
/* -------------------------------------------------------------------------- */

export function getLocalAutomations(userId: string): AutomationRecord[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, name, goal, schedule_kind, schedule_hour, schedule_day_of_week,
           approved_tools, enabled, last_run_at, next_run_at, created_at
    FROM local_automations
    WHERE user_id = ?
    ORDER BY created_at DESC
  `);
  const rows = stmt.all(userId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r["id"]),
    name: String(r["name"]),
    goal: String(r["goal"]),
    schedule_kind: r["schedule_kind"] as "hourly" | "daily" | "weekly",
    schedule_hour: Number(r["schedule_hour"]),
    schedule_day_of_week:
      r["schedule_day_of_week"] !== null && r["schedule_day_of_week"] !== undefined
        ? Number(r["schedule_day_of_week"])
        : null,
    approved_tools: JSON.parse((r["approved_tools"] as string) || "[]") as string[],
    enabled: Boolean(r["enabled"]),
    last_run_at: (r["last_run_at"] as string | null) || null,
    next_run_at: (r["next_run_at"] as string | null) || null,
    created_at: String(r["created_at"]),
  }));
}

export function createLocalAutomation(
  userId: string,
  data: {
    name: string;
    goal: string;
    scheduleKind: "hourly" | "daily" | "weekly";
    scheduleHour: number;
    scheduleDayOfWeek: number | null;
    approvedTools: string[];
    nextRunAt: string;
  },
): AutomationRecord {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO local_automations (
      id, user_id, name, goal, schedule_kind, schedule_hour, schedule_day_of_week,
      approved_tools, enabled, last_run_at, next_run_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)
  `);
  stmt.run(
    id,
    userId,
    data.name,
    data.goal,
    data.scheduleKind,
    data.scheduleHour,
    data.scheduleDayOfWeek,
    JSON.stringify(data.approvedTools || []),
    data.nextRunAt,
    now,
  );

  return {
    id,
    name: data.name,
    goal: data.goal,
    schedule_kind: data.scheduleKind,
    schedule_hour: data.scheduleHour,
    schedule_day_of_week: data.scheduleDayOfWeek,
    approved_tools: data.approvedTools,
    enabled: true,
    last_run_at: null,
    next_run_at: data.nextRunAt,
    created_at: now,
  };
}

export function updateLocalAutomation(
  automationId: string,
  patch: { enabled?: boolean; name?: string; goal?: string },
): void {
  const db = getDb();
  const updates: string[] = [];
  const params: (string | number)[] = [];
  if (patch.enabled !== undefined) {
    updates.push("enabled = ?");
    params.push(patch.enabled ? 1 : 0);
  }
  if (patch.name !== undefined) {
    updates.push("name = ?");
    params.push(patch.name);
  }
  if (patch.goal !== undefined) {
    updates.push("goal = ?");
    params.push(patch.goal);
  }
  if (updates.length === 0) return;

  params.push(automationId);
  db.prepare(`UPDATE local_automations SET ${updates.join(", ")} WHERE id = ?`).run(...params);
}

export function deleteLocalAutomation(automationId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM local_automation_runs WHERE automation_id = ?").run(automationId);
  db.prepare("DELETE FROM local_automations WHERE id = ?").run(automationId);
}

export function getLocalAutomation(automationId: string): AutomationRecord | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM local_automations WHERE id = ?").get(automationId) as
    Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row["id"]),
    name: String(row["name"]),
    goal: String(row["goal"]),
    schedule_kind: row["schedule_kind"] as "hourly" | "daily" | "weekly",
    schedule_hour: Number(row["schedule_hour"]),
    schedule_day_of_week:
      row["schedule_day_of_week"] !== null && row["schedule_day_of_week"] !== undefined
        ? Number(row["schedule_day_of_week"])
        : null,
    approved_tools: JSON.parse((row["approved_tools"] as string) || "[]") as string[],
    enabled: Boolean(row["enabled"]),
    last_run_at: (row["last_run_at"] as string | null) || null,
    next_run_at: (row["next_run_at"] as string | null) || null,
    created_at: String(row["created_at"]),
  };
}

export function getLocalAutomationRuns(automationId: string): AutomationRunRecord[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, agent_run_id, status, summary, ran_at
    FROM local_automation_runs
    WHERE automation_id = ?
    ORDER BY ran_at DESC
    LIMIT 20
  `);
  return stmt.all(automationId) as AutomationRunRecord[];
}

export function recordLocalAutomationRun(data: {
  automationId: string;
  userId: string;
  agentRunId: string | null;
  status: string;
  summary: string;
  ranAt?: string;
}): void {
  const db = getDb();
  const id = randomUUID();
  const ranAt = data.ranAt || new Date().toISOString();
  db.prepare(
    `
    INSERT INTO local_automation_runs (id, automation_id, user_id, agent_run_id, status, summary, ran_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(id, data.automationId, data.userId, data.agentRunId, data.status, data.summary, ranAt);

  db.prepare(
    `
    UPDATE local_automations SET last_run_at = ? WHERE id = ?
  `,
  ).run(ranAt, data.automationId);
}

/* -------------------------------------------------------------------------- */
/* Agent Runs (Task History) CRUD                                            */
/* -------------------------------------------------------------------------- */

export function getLocalAgentRuns(
  userId: string,
  search: string = "",
  status: string = "all",
  limit: number = 30,
): AgentRunSummary[] {
  const db = getDb();
  let query = `
    SELECT id, goal, status, answer, verification_verdict, verification_score,
           step_count, failed_count, automation_id, created_at
    FROM local_agent_runs
    WHERE user_id = ?
  `;
  const params: (string | number)[] = [userId];

  if (status && status !== "all") {
    query += " AND status = ?";
    params.push(status);
  }
  if (search && search.trim()) {
    query += " AND (goal LIKE ? OR answer LIKE ?)";
    params.push(`%${search.trim()}%`, `%${search.trim()}%`);
  }
  query += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  return db.prepare(query).all(...params) as AgentRunSummary[];
}

export function getLocalAgentRun(runId: string): AgentRunDetail | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM local_agent_runs WHERE id = ?").get(runId) as
    Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row["id"]),
    goal: String(row["goal"]),
    status: row["status"] as "verified" | "partial" | "failed",
    answer: String(row["answer"] || ""),
    verification_verdict: (row["verification_verdict"] as string | null) || null,
    verification_score:
      row["verification_score"] !== null && row["verification_score"] !== undefined
        ? Number(row["verification_score"])
        : null,
    step_count: Number(row["step_count"]),
    failed_count: Number(row["failed_count"]),
    automation_id: (row["automation_id"] as string | null) || null,
    created_at: String(row["created_at"]),
    plan: JSON.parse((row["plan_json"] as string) || "{}"),
    steps: JSON.parse((row["steps_json"] as string) || "[]"),
    verification: JSON.parse((row["verification_json"] as string) || "{}"),
  };
}

export function deleteLocalAgentRun(runId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM local_agent_runs WHERE id = ?").run(runId);
}

export function recordLocalAgentRun(
  userId: string,
  data: {
    id: string;
    goal: string;
    status: string;
    answer: string;
    verificationVerdict?: string | null;
    verificationScore?: number | null;
    stepCount: number;
    failedCount: number;
    plan: unknown;
    steps: unknown[];
    verification: unknown;
    automationId?: string | null;
  },
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT OR REPLACE INTO local_agent_runs (
      id, user_id, goal, status, answer, verification_verdict, verification_score,
      step_count, failed_count, plan_json, steps_json, verification_json, automation_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    data.id,
    userId,
    data.goal,
    data.status,
    data.answer,
    data.verificationVerdict || null,
    data.verificationScore !== undefined ? data.verificationScore : null,
    data.stepCount,
    data.failedCount,
    JSON.stringify(data.plan || {}),
    JSON.stringify(data.steps || []),
    JSON.stringify(data.verification || {}),
    data.automationId || null,
    now,
  );
}

/* -------------------------------------------------------------------------- */
/* Chat Turns CRUD                                                            */
/* -------------------------------------------------------------------------- */

export function getLocalChatTurns(
  userId: string,
  search: string = "",
  limit: number = 60,
): ChatTurnRecord[] {
  const db = getDb();
  let query = `
    SELECT id, role, content, page_title, page_url, created_at
    FROM local_chat_turns
    WHERE user_id = ?
  `;
  const params: (string | number)[] = [userId];
  if (search && search.trim()) {
    query += " AND content LIKE ?";
    params.push(`%${search.trim()}%`);
  }
  query += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  return db.prepare(query).all(...params) as ChatTurnRecord[];
}

export function recordLocalChatTurn(
  userId: string,
  data: {
    role: "user" | "assistant";
    content: string;
    pageTitle?: string | null;
    pageUrl?: string | null;
  },
): void {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO local_chat_turns (id, user_id, role, content, page_title, page_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(id, userId, data.role, data.content, data.pageTitle || null, data.pageUrl || null, now);
}

export function deleteLocalChatTurn(turnId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM local_chat_turns WHERE id = ?").run(turnId);
}

export function clearLocalChatTurns(userId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM local_chat_turns WHERE user_id = ?").run(userId);
}

/* -------------------------------------------------------------------------- */
/* Tasks CRUD                                                                 */
/* -------------------------------------------------------------------------- */

export function getLocalTasks(userId: string): TaskRecord[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, title, notes, due_at, status, created_at, updated_at
    FROM local_tasks
    WHERE user_id = ?
    ORDER BY created_at DESC
  `);
  return stmt.all(userId) as TaskRecord[];
}

export function createLocalTask(
  userId: string,
  data: { title: string; notes?: string; dueAt?: string | null },
): TaskRecord {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO local_tasks (id, user_id, title, notes, due_at, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `,
  ).run(id, userId, data.title, data.notes || "", data.dueAt || null, now, now);

  return {
    id,
    title: data.title,
    notes: data.notes || "",
    due_at: data.dueAt || null,
    status: "pending",
    created_at: now,
    updated_at: now,
  };
}

export function updateLocalTaskStatus(
  taskId: string,
  status: "pending" | "done" | "cancelled",
): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE local_tasks SET status = ?, updated_at = ? WHERE id = ?
  `,
  ).run(status, now, taskId);
}

export function deleteLocalTask(taskId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM local_tasks WHERE id = ?").run(taskId);
}
