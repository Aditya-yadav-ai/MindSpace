/**
 * Stage 8 — Google Tasks API service adapter.
 * Uses the official Google Tasks API (v1).
 * Supports listing task lists, creating task lists, retrieving tasks (pending/completed),
 * creating tasks, updating tasks, setting due dates, completing, and deleting tasks.
 */
import { googleApiFetch } from "./api-fetch.server";
import type { TaskCreateInput, TaskListSummary, TaskSummary, TaskUpdateInput } from "./types";

const BASE = "https://tasks.googleapis.com/tasks/v1";

/**
 * Lists the user's task lists.
 */
export async function listTaskLists(
  accessToken: string,
  limit: number = 20,
): Promise<TaskListSummary[]> {
  const result = await googleApiFetch<{
    items?: { id: string; title: string; updated?: string }[];
  }>(accessToken, `${BASE}/users/@me/lists?maxResults=${Math.min(limit, 100)}`);
  return (result.items ?? []).map((list) => ({
    id: list.id,
    title: list.title,
    updated: list.updated ?? null,
  }));
}

/**
 * Creates a new task list.
 * Callers must gate this behind explicit user approval.
 */
export async function createTaskList(accessToken: string, title: string): Promise<TaskListSummary> {
  const result = await googleApiFetch<{ id: string; title: string; updated?: string }>(
    accessToken,
    `${BASE}/users/@me/lists`,
    {
      method: "POST",
      body: JSON.stringify({ title }),
    },
  );
  return {
    id: result.id,
    title: result.title,
    updated: result.updated ?? null,
  };
}

/**
 * Retrieves tasks from a specific task list (defaults to primary '@default').
 */
export async function listTasks(
  accessToken: string,
  taskListId: string = "@default",
  showCompleted: boolean = true,
  limit: number = 20,
): Promise<TaskSummary[]> {
  const listId = encodeURIComponent(taskListId || "@default");
  const url = `${BASE}/lists/${listId}/tasks?maxResults=${Math.min(limit, 100)}&showCompleted=${showCompleted}&showHidden=${showCompleted}`;
  const result = await googleApiFetch<{
    items?: {
      id: string;
      title?: string;
      notes?: string;
      due?: string;
      status: string;
      completed?: string;
      updated?: string;
    }[];
  }>(accessToken, url);

  return (result.items ?? []).map((t) => ({
    id: t.id,
    title: t.title || "(Untitled task)",
    notes: t.notes,
    due: t.due ?? null,
    status: t.status,
    completed: t.completed ?? null,
    updated: t.updated ?? null,
  }));
}

/**
 * Creates a new task in the specified list (or @default).
 * Callers must gate this behind explicit user approval.
 */
export async function createTask(
  accessToken: string,
  input: TaskCreateInput,
): Promise<TaskSummary> {
  const listId = encodeURIComponent(input.taskListId || "@default");
  const payload: Record<string, unknown> = {
    title: input.title,
  };
  if (input.notes) payload["notes"] = input.notes;
  if (input.due) payload["due"] = input.due;

  const result = await googleApiFetch<{
    id: string;
    title: string;
    notes?: string;
    due?: string;
    status: string;
    updated?: string;
  }>(accessToken, `${BASE}/lists/${listId}/tasks`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return {
    id: result.id,
    title: result.title,
    notes: result.notes,
    due: result.due ?? null,
    status: result.status,
    updated: result.updated ?? null,
  };
}

/**
 * Updates an existing task.
 * Callers must gate this behind explicit user approval.
 */
export async function updateTask(
  accessToken: string,
  input: TaskUpdateInput,
): Promise<TaskSummary> {
  const listId = encodeURIComponent(input.taskListId || "@default");
  const taskId = encodeURIComponent(input.taskId);
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch["title"] = input.title;
  if (input.notes !== undefined) patch["notes"] = input.notes;
  if (input.due !== undefined) patch["due"] = input.due;
  if (input.status !== undefined) patch["status"] = input.status;

  const result = await googleApiFetch<{
    id: string;
    title: string;
    notes?: string;
    due?: string;
    status: string;
    completed?: string;
    updated?: string;
  }>(accessToken, `${BASE}/lists/${listId}/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

  return {
    id: result.id,
    title: result.title,
    notes: result.notes,
    due: result.due ?? null,
    status: result.status,
    completed: result.completed ?? null,
    updated: result.updated ?? null,
  };
}

/**
 * Marks a task as completed.
 * Callers must gate this behind explicit user approval.
 */
export async function completeTask(
  accessToken: string,
  taskListId: string = "@default",
  taskId: string,
): Promise<TaskSummary> {
  return updateTask(accessToken, {
    taskListId,
    taskId,
    status: "completed",
  });
}

/**
 * Sets the due date of a task.
 * Callers must gate this behind explicit user approval.
 */
export async function setTaskDueDate(
  accessToken: string,
  taskListId: string = "@default",
  taskId: string,
  dueDate: string,
): Promise<TaskSummary> {
  return updateTask(accessToken, {
    taskListId,
    taskId,
    due: dueDate,
  });
}

/**
 * Deletes a task by ID.
 * Callers must gate this behind explicit user approval.
 */
export async function deleteTask(
  accessToken: string,
  taskListId: string = "@default",
  taskId: string,
): Promise<{ ok: true; taskId: string }> {
  const listId = encodeURIComponent(taskListId || "@default");
  const tId = encodeURIComponent(taskId);
  await googleApiFetch(accessToken, `${BASE}/lists/${listId}/tasks/${tId}`, {
    method: "DELETE",
  });
  return { ok: true, taskId };
}
