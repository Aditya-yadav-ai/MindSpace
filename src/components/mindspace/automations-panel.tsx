/**
 * Stage 8 — Automations view. A saved goal run on a schedule by the cron
 * worker (`src/routes/api/cron/automations.ts`). Unattended runs can only
 * use consequential tools the user pre-approves right here at creation
 * time — nothing else is approved for those runs, ever.
 */
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, LoaderCircle, Play, Plus, Repeat, Trash2 } from "lucide-react";
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

export function AutomationsPanel({ signedIn }: { signedIn: boolean }) {
  const load = useServerFn(listAutomations);
  const create = useServerFn(createAutomation);
  const update = useServerFn(updateAutomation);
  const remove = useServerFn(deleteAutomation);
  const runNow = useServerFn(runAutomationNow);

  const [items, setItems] = useState<AutomationRecord[]>([]);
  const [loading, setLoading] = useState(signedIn);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [kind, setKind] = useState<ScheduleKind>("daily");
  const [hour, setHour] = useState(9);
  const [approved, setApproved] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    try {
      setItems(await load({}));
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
        <div className="mt-7 grid min-h-72 place-items-center rounded-lg bg-panel/60 p-8 text-center ring-1 ring-foreground/5">
          <div>
            <Repeat className="mx-auto size-6 text-primary" />
            <p className="mt-4 text-sm font-medium">Sign in to set up automations</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-foreground/50">
              Automations run under your account on a schedule, so this needs a real sign-in.
            </p>
          </div>
        </div>
      </div>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !goal.trim()) return;
    setBusy("create");
    try {
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
      setName("");
      setGoal("");
      setApproved([]);
      setShowForm(false);
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function toggle(item: AutomationRecord) {
    setBusy(item.id);
    try {
      await update({ data: { automationId: item.id, enabled: !item.enabled } });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove_(item: AutomationRecord) {
    setBusy(item.id);
    try {
      await remove({ data: { automationId: item.id } });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function runNow_(item: AutomationRecord) {
    setBusy(item.id);
    try {
      await runNow({ data: { automationId: item.id } });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Header />
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus /> New automation
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={submit}
          className="mt-5 space-y-3 rounded-lg bg-panel/60 p-4 ring-1 ring-foreground/5"
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={'Name (e.g. "Monday research digest")'}
            className="h-9 w-full rounded-md border border-input bg-background/70 px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
          <textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="Goal the agent should run each time…"
            rows={2}
            className="w-full resize-none rounded-md border border-input bg-background/70 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
          <div className="flex flex-wrap gap-2">
            {(["hourly", "daily", "weekly"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs capitalize ring-1 transition-colors",
                  kind === k
                    ? "bg-primary text-primary-foreground ring-primary"
                    : "text-foreground/55 ring-foreground/15 hover:text-foreground",
                )}
              >
                {k}
              </button>
            ))}
            {kind !== "hourly" && (
              <label className="flex items-center gap-1.5 text-xs text-foreground/55">
                Hour (UTC)
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={hour}
                  onChange={(event) => setHour(Number(event.target.value))}
                  className="h-7 w-16 rounded-md border border-input bg-background/70 px-2 text-xs outline-none"
                />
              </label>
            )}
          </div>
          <div>
            <p className="text-[11px] font-medium text-foreground/60">
              Pre-approve for unattended runs (optional — everything else stays blocked until you
              review it):
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
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
                    "rounded-full px-2.5 py-1 font-mono text-[10px] ring-1 transition-colors",
                    approved.includes(tool)
                      ? "bg-caution/20 text-caution ring-caution/40"
                      : "text-foreground/45 ring-foreground/15 hover:text-foreground/70",
                  )}
                >
                  {tool}
                </button>
              ))}
            </div>
          </div>
          <Button
            type="submit"
            size="sm"
            disabled={busy === "create" || !name.trim() || !goal.trim()}
          >
            {busy === "create" ? <LoaderCircle className="animate-spin" /> : <Plus />}
            Create automation
          </Button>
        </form>
      )}

      <div className="mt-5 space-y-2.5">
        {loading ? (
          <LoaderCircle className="size-4 animate-spin text-foreground/40" />
        ) : items.length === 0 ? (
          <p className="text-xs text-foreground/45">No automations yet — create one above.</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="rounded-lg bg-panel/60 p-4 ring-1 ring-foreground/5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold">{item.name}</p>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px]",
                        item.enabled
                          ? "bg-positive/15 text-positive"
                          : "bg-foreground/10 text-foreground/40",
                      )}
                    >
                      {item.enabled ? "On" : "Off"}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-foreground/55">{item.goal}</p>
                  <p className="mt-1.5 text-[10.5px] text-foreground/40">
                    {describeSchedule({
                      kind: item.schedule_kind,
                      hour: item.schedule_hour,
                      dayOfWeek: item.schedule_day_of_week,
                    })}
                    {item.last_run_at &&
                      ` · last ran ${new Date(item.last_run_at).toLocaleString()}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton
                    label="Run now"
                    onClick={() => void runNow_(item)}
                    busy={busy === item.id}
                    icon={Play}
                  />
                  <IconButton
                    label={item.enabled ? "Turn off" : "Turn on"}
                    onClick={() => void toggle(item)}
                    busy={busy === item.id}
                    icon={Repeat}
                  />
                  <IconButton
                    label="History"
                    onClick={() => setOpen(open === item.id ? null : item.id)}
                    icon={ChevronDown}
                  />
                  <IconButton
                    label="Delete"
                    onClick={() => void remove_(item)}
                    busy={busy === item.id}
                    icon={Trash2}
                    destructive
                  />
                </div>
              </div>
              {open === item.id && <AutomationRuns automationId={item.id} />}
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

  useEffect(() => {
    void load({ data: { automationId } }).then(setRuns);
  }, [automationId, load]);

  return (
    <div className="mt-3 space-y-1.5 border-t border-foreground/5 pt-3">
      {runs === null ? (
        <LoaderCircle className="size-3.5 animate-spin text-foreground/40" />
      ) : runs.length === 0 ? (
        <p className="text-[11px] text-foreground/40">No runs yet.</p>
      ) : (
        runs.map((run) => (
          <div key={run.id} className="flex items-center justify-between gap-2 text-[11px]">
            <span className={cn(run.status === "verified" ? "text-positive" : "text-caution")}>
              {run.status}
            </span>
            <span className="flex-1 truncate text-foreground/55">{run.summary}</span>
            <span className="shrink-0 text-foreground/35">
              {new Date(run.ran_at).toLocaleString()}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  icon: Icon,
  busy = false,
  destructive = false,
}: {
  label: string;
  onClick: () => void;
  icon: typeof Play;
  busy?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      title={label}
      className={cn(
        "rounded-md p-1.5 text-foreground/45 hover:bg-foreground/5 hover:text-foreground",
        destructive && "hover:text-destructive",
      )}
    >
      {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
    </button>
  );
}

function Header() {
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary">MindSpace</p>
      <h1 className="mt-2 font-display text-3xl font-medium">Automations</h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-foreground/60">
        Run a saved goal on a schedule. Unattended runs only use the tools you pre-approve here.
      </p>
    </div>
  );
}
