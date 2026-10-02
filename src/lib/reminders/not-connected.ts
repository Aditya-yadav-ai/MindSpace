/**
 * Stage 7 — default task service when no signed-in user is available.
 * Plain module (no server-only imports), same reasoning as
 * `google/not-connected.ts`: the agent framework (manager.ts, agent.ts,
 * tools.ts) can import this at the top level without pulling in the
 * service-role Supabase client.
 */
import type { TaskService } from "./types";
import { TaskServiceUnavailableError } from "./types";

const fail = () => Promise.reject(new TaskServiceUnavailableError());

export const notConnectedTaskService: TaskService = {
  available: false,
  create: fail,
  list: fail,
  complete: fail,
  remove: fail,
};
