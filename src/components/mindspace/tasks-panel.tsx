/**
 * Stage 7 — Tasks view. Manual CRUD over the same `tasks` table the
 * Reminder Agent writes to (agent-created rows show a "from an agent run" tag).
 */
import { useServerFn } from "@tanstack/react-start";
import { Check, ListTodo, LoaderCircle, Plus, Sparkles, Trash2 } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  createTask,
  deleteTask,
  listTasks,
  updateTaskStatus,
  type TaskRecord,
} from "@/lib/tasks.functions";
import { cn } from "@/lib/utils";
import { ViewHeader } from "@/components/mindspace/ui";

export function TasksPanel({ signedIn }: { signedIn: boolean }) {
  const load = useServerFn(listTasks);
  const create = useServerFn(createTask);
  const setStatus = useServerFn(updateTaskStatus);
  const remove = useServerFn(deleteTask);

  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(signedIn);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");

  const refresh = useCallback(async () => {
    try {
      setTasks((await load({})) || []);
      setError(null);
    } catch {
      setError("Your tasks could not be loaded. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    if (signedIn) void refresh();
  }, [signedIn, refresh]);

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-3xl">
        <Header />
        <div className="mt-7 grid min-h-72 place-items-center rounded-lg bg-card p-8 text-center ring-1 ring-border">
          <div>
            <ListTodo className="mx-auto size-6 text-primary" />
            <p className="mt-4 text-sm font-medium">Sign in to keep tasks</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
              Tasks are saved to your account, so this needs a real sign-in rather than the preview.
            </p>
          </div>
        </div>
      </div>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy("create");
    setError(null);
    try {
      await create({ data: { title: title.trim(), notes: "", dueAt: dueAt.trim() || null } });
      setTitle("");
      setDueAt("");
      await refresh();
    } catch {
      setError("Could not save that task. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function toggle(task: TaskRecord) {
    setBusy(task.id);
    try {
      await setStatus({
        data: { taskId: task.id, status: task.status === "done" ? "pending" : "done" },
      });
      await refresh();
    } catch {
      setError("Could not update that task.");
    } finally {
      setBusy(null);
    }
  }

  async function remove_(task: TaskRecord) {
    setBusy(task.id);
    try {
      await remove({ data: { taskId: task.id } });
      await refresh();
    } catch {
      setError("Could not delete that task.");
    } finally {
      setBusy(null);
    }
  }

  const pending = (tasks ?? []).filter((task) => task.status === "pending");
  const done = (tasks ?? []).filter((task) => task.status === "done");

  return (
    <div className="mx-auto max-w-3xl">
      <Header />

      <form
        onSubmit={submit}
        className="mt-6 flex flex-wrap gap-2 rounded-lg bg-card p-4 ring-1 ring-border"
      >
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a task…"
          className="h-9 min-w-[12rem] flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
        <input
          value={dueAt}
          onChange={(event) => setDueAt(event.target.value)}
          placeholder="Due (optional)"
          className="h-9 w-40 rounded-md border border-input bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
        <Button type="submit" size="sm" disabled={busy === "create" || !title.trim()}>
          {busy === "create" ? <LoaderCircle className="animate-spin" /> : <Plus />}
          Add
        </Button>
      </form>
      {error && (
        <p
          role="alert"
          className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      )}

      <div className="mt-5 space-y-4">
        <TaskGroup
          title="Open"
          items={pending}
          loading={loading}
          busy={busy}
          onToggle={(t) => void toggle(t)}
          onRemove={(t) => void remove_(t)}
          empty="Nothing pending — add one above, or ask the Reminder Agent in Agent Activity."
        />
        {(done?.length ?? 0) > 0 && (
          <TaskGroup
            title="Done"
            items={done}
            loading={false}
            busy={busy}
            onToggle={(t) => void toggle(t)}
            onRemove={(t) => void remove_(t)}
            empty=""
          />
        )}
      </div>
    </div>
  );
}

function TaskGroup({
  title,
  items,
  loading,
  busy,
  onToggle,
  onRemove,
  empty,
}: {
  title: string;
  items: TaskRecord[];
  loading: boolean;
  busy: string | null;
  onToggle: (task: TaskRecord) => void;
  onRemove: (task: TaskRecord) => void;
  empty: string;
}) {
  return (
    <div className="rounded-lg bg-card p-4 ring-1 ring-border">
      <h2 className="text-sm font-semibold">
        {title}{" "}
        <span className="ml-1 font-mono text-[11px] font-normal text-muted-foreground">
          {items?.length ?? 0}
        </span>
      </h2>
      <div className="mt-3">
        {loading ? (
          <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
        ) : (items?.length ?? 0) === 0 ? (
          <p className="text-xs leading-5 text-muted-foreground">{empty}</p>
        ) : (
          <ul className="space-y-1.5">
            {(items ?? []).map((task) => (
              <li
                key={task.id}
                className="flex items-center gap-2.5 rounded-md bg-background p-2.5 ring-1 ring-border"
              >
                <button
                  onClick={() => onToggle(task)}
                  disabled={busy === task.id}
                  aria-label={task.status === "done" ? "Mark as not done" : "Mark as done"}
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-full ring-1 transition-colors",
                    task.status === "done"
                      ? "bg-positive/20 text-positive ring-positive/30"
                      : "text-transparent ring-foreground/20 hover:ring-primary/40",
                  )}
                >
                  <Check className="size-3" />
                </button>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate text-sm",
                      task.status === "done" && "text-muted-foreground line-through",
                    )}
                  >
                    {task.title}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                    {task.due_at && <span>Due {task.due_at}</span>}
                    {task.source === "agent" && (
                      <span className="flex items-center gap-1 text-primary/70">
                        <Sparkles className="size-2.5" /> from an agent run
                      </span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => onRemove(task)}
                  disabled={busy === task.id}
                  aria-label="Delete task"
                  className="text-muted-foreground hover:text-destructive"
                >
                  {busy === task.id ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Header() {
  return (
    <ViewHeader
      eyebrow="Tasks"
      title="Tasks"
      description="Real, saved reminders — add them here, or ask the Reminder Agent in Agent Activity to save one from a deadline it finds on a page."
    />
  );
}
