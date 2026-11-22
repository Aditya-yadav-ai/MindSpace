/**
 * Stage 8 — Automations view. A saved goal run on a schedule by the cron
 * worker (`src/routes/api/cron/automations.ts`) or on-demand via `runAutomationNow`.
 * Unattended runs can only use consequential tools the user pre-approves at
 * creation/edit time — nothing else is approved for those runs, ever.
 */
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Edit2,
  LoaderCircle,
  Play,
  Plus,
  Repeat,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  APPROVABLE_AUTOMATION_TOOLS,
  createAutomation,
  deleteAutomation,
  listAutomationRuns,
  listAutomations,
  runAutomationNow,
  updateAutomation,
  type AutomationRecord,
  type AutomationRunRecord,
} from "@/lib/automations.functions";
import { describeSchedule, type ScheduleKind } from "@/lib/automations-schedule";
import { cn } from "@/lib/utils";
import { ViewHeader } from "@/components/mindspace/ui";

export function AutomationsPanel({ signedIn }: { signedIn: boolean }) {
  const load = useServerFn(listAutomations);
  const create = useServerFn(createAutomation);
  const update = useServerFn(updateAutomation);
  const remove = useServerFn(deleteAutomation);
  const runNow = useServerFn(runAutomationNow);

  const [items, setItems] = useState<AutomationRecord[]>([]);
  const [loading, setLoading] = useState(signedIn);
  const [openHistoryId, setOpenHistoryId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Form states (used for both Create and Edit)
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [kind, setKind] = useState<ScheduleKind>("daily");
  const [hour, setHour] = useState(9);
  const [approved, setApproved] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await load({});
      setItems(res || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load automations.");
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    if (signedIn) void refresh();
  }, [signedIn, refresh]);

  function startCreate() {
    setEditingId(null);
    setName("");
    setGoal("");
    setKind("daily");
    setHour(9);
    setApproved([]);
    setShowForm(true);
  }

  function startEdit(item: AutomationRecord) {
    setEditingId(item.id);
    setName(item.name);
    setGoal(item.goal);
    setKind(item.schedule_kind);
    setHour(item.schedule_hour);
    setApproved(item.approved_tools || []);
    setShowForm(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !goal.trim()) return;
    setBusy("form");
    setError(null);
    setSuccessMsg(null);

    try {
      if (editingId) {
        await update({
          data: {
            automationId: editingId,
            name: name.trim(),
            goal: goal.trim(),
          },
        });
        setSuccessMsg(`Automation "${name.trim()}" updated successfully.`);
      } else {
        await create({
          data: {
            name: name.trim(),
            goal: goal.trim(),
            scheduleKind: kind,
            scheduleHour: hour,
            scheduleDayOfWeek: kind === "weekly" ? 1 : null,
            approvedTools: approved,
          },
        });
        setSuccessMsg(`Automation "${name.trim()}" created successfully.`);
      }
      setShowForm(false);
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save automation.");
    } finally {
      setBusy(null);
    }
  }

  async function toggle(item: AutomationRecord) {
    setBusy(item.id);
    setError(null);
    try {
      await update({ data: { automationId: item.id, enabled: !item.enabled } });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle status.");
    } finally {
      setBusy(null);
    }
  }

  async function remove_(item: AutomationRecord) {
    setBusy(item.id);
    setError(null);
    try {
      await remove({ data: { automationId: item.id } });
      setConfirmDeleteId(null);
      setSuccessMsg(`Automation "${item.name}" deleted.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete automation.");
    } finally {
      setBusy(null);
    }
  }

  async function runNow_(item: AutomationRecord) {
    setBusy(item.id);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await runNow({ data: { automationId: item.id } });
      setSuccessMsg(`Execution finished with status: ${res.status}`);
      setOpenHistoryId(item.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Execution failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Header />
        <Button size="sm" onClick={() => (showForm ? setShowForm(false) : startCreate())}>
          {showForm ? <X className="size-4 mr-1" /> : <Plus className="size-4 mr-1" />}
          {showForm ? "Cancel" : "New automation"}
        </Button>
      </div>

      {/* Notifications / Errors */}
      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3.5 text-xs text-destructive flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError(null)} className="hover:opacity-75">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3.5 text-xs text-emerald-600 dark:text-emerald-400 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button type="button" onClick={() => setSuccessMsg(null)} className="hover:opacity-75">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Create / Edit Form */}
      {showForm && (
        <form
          onSubmit={submit}
          className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm"
        >
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <h3 className="text-sm font-semibold text-foreground">
              {editingId ? "Edit Automation" : "Create New Automation"}
            </h3>
            <span className="text-[11px] text-muted-foreground">
              {editingId ? "Update configuration" : "Schedule autonomous tasks"}
            </span>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Automation Name
              </label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={'Name (e.g. "Monday Morning Research Digest")'}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Goal Description
              </label>
              <textarea
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="Describe the research objective or workflow the agent should execute..."
                rows={3}
                className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                required
              />
            </div>

            {!editingId && (
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Schedule Frequency
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  {(["hourly", "daily", "weekly"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      className={cn(
                        "rounded-lg px-3 py-1.5 text-xs font-medium capitalize border transition-all",
                        kind === k
                          ? "border-primary bg-primary/10 text-primary shadow-xs"
                          : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {k}
                    </button>
                  ))}
                  {kind !== "hourly" && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground ml-2">
                      <span>Hour (UTC):</span>
                      <input
                        type="number"
                        min={0}
                        max={23}
                        value={hour}
                        onChange={(event) => setHour(Number(event.target.value))}
                        className="h-8 w-16 rounded-md border border-input bg-background px-2 text-xs outline-none"
                      />
                    </label>
                  )}
                </div>
              </div>
            )}

            {!editingId && (
              <div className="pt-2 border-t border-border/40">
                <p className="text-[11.5px] font-medium text-foreground">
                  Pre-approve Consequential Tools (Optional)
                </p>
                <p className="text-[10.5px] text-muted-foreground mb-2">
                  Pre-approved tools can execute without interactive confirmation during unattended
                  runs:
                </p>
                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1">
                  {APPROVABLE_AUTOMATION_TOOLS.map((tool) => (
                    <button
                      key={tool}
                      type="button"
                      onClick={() =>
                        setApproved((prev) =>
                          prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool],
                        )
                      }
                      className={cn(
                        "rounded-md px-2 py-1 font-mono text-[10px] border transition-colors",
                        approved.includes(tool)
                          ? "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold"
                          : "border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {tool}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={busy === "form" || !name.trim() || !goal.trim()}
            >
              {busy === "form" ? (
                <LoaderCircle className="size-4 animate-spin mr-1" />
              ) : (
                <CheckCircle2 className="size-4 mr-1" />
              )}
              {editingId ? "Save Changes" : "Create Automation"}
            </Button>
          </div>
        </form>
      )}

      {/* Automations Listing */}
      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center p-12 text-muted-foreground">
            <LoaderCircle className="size-6 animate-spin text-primary mr-2" />
            <span className="text-xs">Loading automations...</span>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center space-y-3 bg-muted/20">
            <Repeat className="mx-auto size-8 text-muted-foreground/60" />
            <p className="text-sm font-semibold text-foreground">No automations configured</p>
            <p className="max-w-md mx-auto text-xs text-muted-foreground leading-relaxed">
              Automations allow MindSpace to execute recurring research, digests, and multi-agent
              tasks on a scheduled cadence. Click "New automation" above to create your first rule.
            </p>
            <Button size="sm" onClick={startCreate} className="mt-2 text-xs">
              <Plus className="size-3.5 mr-1" /> Create Automation
            </Button>
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-border bg-card p-4 space-y-3 transition-colors hover:border-primary/30"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-bold text-foreground">{item.name}</p>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        item.enabled
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                          : "bg-muted text-muted-foreground border border-border",
                      )}
                    >
                      {item.enabled ? "Active" : "Paused"}
                    </span>
                    <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground">
                      {item.schedule_kind}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{item.goal}</p>
                  <p className="text-[11px] text-muted-foreground flex flex-wrap gap-2 pt-0.5">
                    <span>
                      Schedule:{" "}
                      {describeSchedule({
                        kind: item.schedule_kind,
                        hour: item.schedule_hour,
                        dayOfWeek: item.schedule_day_of_week,
                      })}
                    </span>
                    {item.last_run_at && (
                      <span>· Last ran: {new Date(item.last_run_at).toLocaleString()}</span>
                    )}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1"
                    disabled={busy === item.id}
                    onClick={() => void runNow_(item)}
                    title="Trigger immediate execution"
                  >
                    {busy === item.id ? (
                      <LoaderCircle className="size-3 animate-spin" />
                    ) : (
                      <Play className="size-3 text-primary" />
                    )}
                    <span>Run Now</span>
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    onClick={() => startEdit(item)}
                    title="Edit automation"
                  >
                    <Edit2 className="size-3.5" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={cn(
                      "h-8 w-8",
                      item.enabled
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground",
                    )}
                    onClick={() => void toggle(item)}
                    title={item.enabled ? "Pause schedule" : "Resume schedule"}
                  >
                    <Repeat className="size-3.5" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="h-8 w-8 text-muted-foreground"
                    onClick={() => setOpenHistoryId(openHistoryId === item.id ? null : item.id)}
                    title="View execution history"
                  >
                    {openHistoryId === item.id ? (
                      <ChevronUp className="size-3.5" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => setConfirmDeleteId(item.id)}
                    title="Delete automation"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>

              {/* Delete confirmation banner */}
              {confirmDeleteId === item.id && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs flex items-center justify-between text-destructive">
                  <span>Are you sure you want to delete this automation?</span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-7 text-[11px]"
                      disabled={busy === item.id}
                      onClick={() => void remove_(item)}
                    >
                      {busy === item.id ? (
                        <LoaderCircle className="size-3 animate-spin mr-1" />
                      ) : (
                        <Trash2 className="size-3 mr-1" />
                      )}
                      Confirm Delete
                    </Button>
                  </div>
                </div>
              )}

              {/* Expandable Execution History */}
              {openHistoryId === item.id && <AutomationRuns automationId={item.id} />}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AutomationRuns({ automationId }: { automationId: string }) {
  const load = useServerFn(listAutomationRuns);
  const [runs, setRuns] = useState<AutomationRunRecord[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void load({ data: { automationId } })
      .then((res) => setRuns(res || []))
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, [automationId, load]);

  return (
    <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-foreground">Execution History</h4>
        <span className="text-[10px] text-muted-foreground">Most recent runs</span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <LoaderCircle className="size-3 animate-spin text-primary" />
          <span>Fetching run records...</span>
        </div>
      ) : !runs || runs.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic py-1">
          No execution runs recorded yet. Click "Run Now" to trigger an initial execution.
        </p>
      ) : (
        <div className="space-y-1.5">
          {runs.map((run) => (
            <div
              key={run.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-muted/30 px-3 py-2 text-[11.5px]"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                    run.status === "verified" || run.status === "completed"
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                  )}
                >
                  {run.status}
                </span>
                <span className="truncate text-foreground/80">{run.summary}</span>
              </div>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {new Date(run.ran_at).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Header() {
  return (
    <ViewHeader
      eyebrow="Automations"
      title="Automations"
      description="Schedule autonomous multi-agent workflows. Unattended runs only execute tools you explicitly pre-approve."
    />
  );
}
