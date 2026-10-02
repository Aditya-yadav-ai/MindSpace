/** Stage 7 — plain types for the Reminder Agent's storage. No server imports here, mirroring `google/types.ts`. */

export type TaskServiceRecord = {
  id: string;
  title: string;
  notes: string;
  dueAt: string | null;
  status: "pending" | "done";
};

export interface TaskService {
  readonly available: boolean;
  create(input: {
    title: string;
    notes: string;
    dueAt: string | null;
    runId: string;
  }): Promise<TaskServiceRecord>;
  list(input: { limit: number; status: "pending" | "done" | "all" }): Promise<TaskServiceRecord[]>;
  complete(taskId: string): Promise<TaskServiceRecord>;
  remove(taskId: string): Promise<{ deleted: true }>;
}

export class TaskServiceUnavailableError extends Error {
  constructor(message = "Tasks need a signed-in user; none is available for this run.") {
    super(message);
    this.name = "TaskServiceUnavailableError";
  }
}
