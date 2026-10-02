/**
 * Stage 8 — History view. Two tabs over the durable logs in
 * `history.functions.ts`: finished agent runs (goal, verdict, step counts)
 * and conversation turns. Both support search and delete.
 */
import { useServerFn } from "@tanstack/react-start";
import { Clock3, LoaderCircle, Search, ShieldCheck, ShieldAlert, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  deleteAgentRun,
  deleteChatTurn,
  listAgentRuns,
  listChatHistory,
  type AgentRunSummary,
  type ChatTurnRecord,
} from "@/lib/history.functions";
import { cn } from "@/lib/utils";

type Tab = "runs" | "chat";

export function HistoryPanel({ signedIn }: { signedIn: boolean }) {
  const [tab, setTab] = useState<Tab>("runs");

  if (!signedIn) {
    return (
      <div className="mx-auto max-w-3xl">
        <Header />
        <div className="mt-7 grid min-h-72 place-items-center rounded-lg bg-panel/60 p-8 text-center ring-1 ring-foreground/5">
          <div>
            <Clock3 className="mx-auto size-6 text-primary" />
            <p className="mt-4 text-sm font-medium">Sign in to see your history</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-foreground/50">
              Past agent runs and chat turns are saved to your account, so this needs a real
              sign-in.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Header />
      <div className="mt-5 flex gap-1.5 rounded-lg bg-panel/50 p-1 ring-1 ring-foreground/5">
        {(["runs", "chat"] as const).map((id) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex-1 rounded-md py-1.5 text-xs font-medium transition-colors",
              tab === id
                ? "bg-background text-foreground shadow-sm"
                : "text-foreground/50 hover:text-foreground/80",
            )}
          >
            {id === "runs" ? "Agent runs" : "Conversation"}
          </button>
        ))}
      </div>
      <div className="mt-5">{tab === "runs" ? <RunsTab /> : <ChatTab />}</div>
    </div>
  );
}

function RunsTab() {
  const load = useServerFn(listAgentRuns);
  const remove = useServerFn(deleteAgentRun);
  const [search, setSearch] = useState("");
  const [runs, setRuns] = useState<AgentRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(
    async (query: string) => {
      setLoading(true);
      try {
        setRuns(await load({ data: { search: query, status: "all", limit: 30 } }));
      } finally {
        setLoading(false);
      }
    },
    [load],
  );

  useEffect(() => {
    const timer = setTimeout(() => void refresh(search), 250);
    return () => clearTimeout(timer);
  }, [search, refresh]);

  async function remove_(id: string) {
    setBusy(id);
    try {
      await remove({ data: { runId: id } });
      await refresh(search);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <SearchBox value={search} onChange={setSearch} placeholder="Search past goals…" />
      <div className="mt-3 space-y-2">
        {loading ? (
          <LoaderCircle className="size-4 animate-spin text-foreground/40" />
        ) : runs.length === 0 ? (
          <p className="text-xs text-foreground/45">
            No runs yet — try something in Agent Activity.
          </p>
        ) : (
          runs.map((run) => (
            <div key={run.id} className="rounded-lg bg-panel/60 p-3.5 ring-1 ring-foreground/5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{run.goal}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10.5px] text-foreground/45">
                    <VerdictBadge status={run.status} />
                    <span>{run.step_count} step(s)</span>
                    {run.failed_count > 0 && (
                      <span className="text-destructive/80">{run.failed_count} failed</span>
                    )}
                    <span>{new Date(run.created_at).toLocaleString()}</span>
                  </div>
                  {run.answer && (
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-foreground/60">
                      {run.answer}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => void remove_(run.id)}
                  disabled={busy === run.id}
                  aria-label="Delete run"
                  className="shrink-0 text-foreground/30 hover:text-destructive"
                >
                  {busy === run.id ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ChatTab() {
  const load = useServerFn(listChatHistory);
  const remove = useServerFn(deleteChatTurn);
  const [search, setSearch] = useState("");
  const [turns, setTurns] = useState<ChatTurnRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(
    async (query: string) => {
      setLoading(true);
      try {
        setTurns(await load({ data: { search: query, limit: 60 } }));
      } finally {
        setLoading(false);
      }
    },
    [load],
  );

  useEffect(() => {
    const timer = setTimeout(() => void refresh(search), 250);
    return () => clearTimeout(timer);
  }, [search, refresh]);

  async function remove_(id: string) {
    setBusy(id);
    try {
      await remove({ data: { turnId: id } });
      await refresh(search);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <SearchBox value={search} onChange={setSearch} placeholder="Search past messages…" />
      <div className="mt-3 space-y-1.5">
        {loading ? (
          <LoaderCircle className="size-4 animate-spin text-foreground/40" />
        ) : turns.length === 0 ? (
          <p className="text-xs text-foreground/45">No saved chat turns yet.</p>
        ) : (
          turns.map((turn) => (
            <div
              key={turn.id}
              className="flex items-start gap-2.5 rounded-md bg-panel/55 p-3 ring-1 ring-foreground/5"
            >
              <span
                className={cn(
                  "mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[9.5px] uppercase",
                  turn.role === "user"
                    ? "bg-primary/15 text-primary"
                    : "bg-foreground/10 text-foreground/50",
                )}
              >
                {turn.role}
              </span>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-3 text-xs leading-5 text-foreground/75">{turn.content}</p>
                <p className="mt-1 text-[10px] text-foreground/35">
                  {new Date(turn.created_at).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => void remove_(turn.id)}
                disabled={busy === turn.id}
                aria-label="Delete message"
                className="shrink-0 text-foreground/30 hover:text-destructive"
              >
                {busy === turn.id ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function VerdictBadge({ status }: { status: string }) {
  const ok = status === "verified";
  const Icon = ok ? ShieldCheck : ShieldAlert;
  return (
    <span className={cn("flex items-center gap-1", ok ? "text-positive" : "text-caution")}>
      <Icon className="size-3" />
      {status}
    </span>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground/35" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-input bg-background/70 pl-8 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
      />
    </div>
  );
}

function Header() {
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary">MindSpace</p>
      <h1 className="mt-2 font-display text-3xl font-medium">History</h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-foreground/60">
        Every agent run and chat turn is saved to your account — search, review or delete anything
        here.
      </p>
    </div>
  );
}
