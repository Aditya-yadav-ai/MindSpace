import { createFileRoute } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookOpen,
  ChevronUp,
  Clock3,
  Home,
  ListTodo,
  LoaderCircle,
  LogOut,
  Menu,
  PenLine,
  RefreshCw,
  Repeat,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import frostImage from "@/assets/mindspace-frost.jpg";
import { AgentActivity } from "@/components/mindspace/agent-activity";
import { AutomationsPanel } from "@/components/mindspace/automations-panel";
import { ConnectedServices } from "@/components/mindspace/connected-services";
import { ChatPanel } from "@/components/mindspace/chat-panel";
import { ContextCapture } from "@/components/mindspace/context-capture";
import { HistoryPanel } from "@/components/mindspace/history-panel";
import { KnowledgeBase } from "@/components/mindspace/knowledge-base";
import { MemorySettings } from "@/components/mindspace/memory-settings";
import { usePageContext } from "@/components/mindspace/page-context";
import { TasksPanel } from "@/components/mindspace/tasks-panel";
import { WritingStudio } from "@/components/mindspace/writing-studio";
import { Button } from "@/components/ui/button";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MindSpace — Browser workspace" },
      {
        name: "description",
        content: "A focused, secure workspace for understanding what is open in your browser.",
      },
      { property: "og:title", content: "MindSpace — Browser workspace" },
      {
        property: "og:description",
        content: "A focused, secure workspace for understanding what is open in your browser.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MindSpaceApp,
});

type AuthMode = "signin" | "signup";
type View =
  | "workspace"
  | "writing"
  | "knowledge"
  | "agents"
  | "tasks"
  | "saved"
  | "sessions"
  | "automations"
  | "settings";

function MindSpaceApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChecking(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) =>
      setSession(nextSession),
    );
    return () => data.subscription.unsubscribe();
  }, []);

  if (checking) {
    return (
      <div className="grid min-h-screen place-items-center bg-workspace text-workspace-foreground">
        <LoaderCircle className="size-5 animate-spin" aria-label="Loading MindSpace" />
      </div>
    );
  }

  if (!session && !demo) return <AuthScreen onPreview={() => setDemo(true)} />;

  return <Workspace session={session} onExitDemo={() => setDemo(false)} />;
}

function AuthScreen({ onPreview }: { onPreview: () => void }) {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { data: { full_name: email.split("@")[0] } },
          });
    setBusy(false);
    if (result.error) return setMessage(result.error.message);
    if (mode === "signup" && !result.data.session)
      setMessage("Check your email to confirm your account, then sign in.");
  }

  async function googleSignIn() {
    setBusy(true);
    setMessage(null);

    try {
      const supabaseResult = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
          queryParams: {
            access_type: "offline",
            prompt: "consent",
          },
        },
      });

      if (supabaseResult.error) {
        throw new Error(supabaseResult.error.message);
      }

      if (supabaseResult.data?.url) {
        window.location.href = supabaseResult.data.url;
      }
      return;
    } catch (supabaseError) {
      const supabaseMessage =
        supabaseError instanceof Error ? supabaseError.message : "Google sign-in failed.";

      try {
        const fallbackResult = await lovable.auth.signInWithOAuth("google", {
          redirect_uri: window.location.origin,
        });

        if (fallbackResult.error) {
          throw new Error(fallbackResult.error.message);
        }
        return;
      } catch (fallbackError) {
        const fallbackMessage =
          fallbackError instanceof Error ? fallbackError.message : "Google sign-in failed.";
        setMessage(`${supabaseMessage}. ${fallbackMessage}`);
        setBusy(false);
        return;
      }
    }

    setBusy(false);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-background p-4 sm:p-8">
      <img
        src={frostImage}
        alt=""
        width={1920}
        height={1080}
        className="absolute inset-0 size-full object-cover"
      />
      <div className="absolute inset-0 bg-background/65 backdrop-blur-xl" />
      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl items-center justify-center">
        <section className="grid w-full overflow-hidden rounded-lg border border-background/60 bg-panel/85 shadow-2xl backdrop-blur-xl md:grid-cols-[1.05fr_0.95fr]">
          <div className="hidden min-h-[610px] flex-col justify-between bg-workspace p-10 text-workspace-foreground md:flex">
            <Brand />
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-workspace-foreground/45">
                Stage 6 · Workspace Expansion
              </p>
              <h1 className="mt-4 max-w-sm font-display text-5xl font-medium leading-[1.08]">
                A quieter place to think with the web.
              </h1>
              <p className="mt-5 max-w-sm text-sm leading-6 text-workspace-foreground/55">
                Bring in the page you are reading and MindSpace will summarise it, explain it or
                pull out the key facts.
              </p>
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px] text-workspace-foreground/55">
              <span className="status-pulse size-2 rounded-full bg-positive" /> Assistant online
            </div>
          </div>
          <div className="flex min-h-[610px] flex-col justify-center px-6 py-10 sm:px-12">
            <div className="mb-9 md:hidden">
              <Brand dark />
            </div>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary">
              {mode === "signin" ? "Welcome back" : "Create your space"}
            </p>
            <h2 className="mt-2 font-display text-3xl font-medium">
              {mode === "signin" ? "Sign in to MindSpace" : "Start with MindSpace"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {mode === "signin"
                ? "Continue to your browser workspace."
                : "Your account keeps future context private and in sync."}
            </p>
            <form onSubmit={submit} className="mt-7 space-y-4">
              <label className="block text-xs font-medium text-foreground">
                Email
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  className="mt-1.5 h-10 w-full rounded-md border border-input bg-background/70 px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </label>
              <label className="block text-xs font-medium text-foreground">
                Password
                <input
                  required
                  minLength={6}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 6 characters"
                  className="mt-1.5 h-10 w-full rounded-md border border-input bg-background/70 px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </label>
              {message && (
                <p
                  className="rounded-md bg-secondary px-3 py-2 text-xs text-secondary-foreground"
                  role="status"
                >
                  {message}
                </p>
              )}
              <Button className="w-full" disabled={busy}>
                {busy && <LoaderCircle className="animate-spin" />}
                {mode === "signin" ? "Sign in" : "Create account"}
              </Button>
            </form>
            <div className="my-5 flex items-center gap-3 text-[10px] uppercase text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
              or
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => void googleSignIn()}
              disabled={busy}
            >
              Continue with Google
            </Button>
            <button
              className="mt-5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setMessage(null);
              }}
            >
              {mode === "signin"
                ? "New here? Create an account"
                : "Already have an account? Sign in"}
            </button>
            <button
              className="mt-3 text-xs font-medium text-primary hover:text-primary/75"
              onClick={onPreview}
            >
              Preview the workspace
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid size-8 place-items-center rounded-md bg-primary font-display text-sm italic text-primary-foreground">
        M
      </div>
      <div className="leading-tight">
        <p
          className={cn(
            "text-sm font-semibold",
            dark ? "text-foreground" : "text-workspace-foreground",
          )}
        >
          MindSpace
        </p>
        <p
          className={cn(
            "font-mono text-[10px]",
            dark ? "text-muted-foreground" : "text-workspace-foreground/45",
          )}
        >
          stage 6 · workspace expansion
        </p>
      </div>
    </div>
  );
}

function Workspace({ session, onExitDemo }: { session: Session | null; onExitDemo: () => void }) {
  const [view, setView] = useState<View>("workspace");
  const [menuOpen, setMenuOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showStatus, setShowStatus] = useState(true);
  const [quiet, setQuiet] = useState(false);
  const page = usePageContext();
  const name =
    session?.user.user_metadata?.["full_name"] || session?.user.email?.split("@")[0] || "Explorer";
  const initials = String(name)
    .split(" ")
    .map((part: string) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  async function signOut() {
    if (session) await supabase.auth.signOut();
    else onExitDemo();
  }

  const nav = [
    { id: "workspace" as const, label: "Workspace", icon: Home },
    { id: "writing" as const, label: "Writing", icon: PenLine },
    { id: "knowledge" as const, label: "Knowledge base", icon: BookOpen },
    { id: "agents" as const, label: "Agent activity", icon: Sparkles },
    { id: "tasks" as const, label: "Tasks", icon: ListTodo },
    { id: "saved" as const, label: "Saved pages", icon: Bookmark },
    { id: "sessions" as const, label: "History", icon: Clock3 },
    { id: "automations" as const, label: "Automations", icon: Repeat },
    { id: "settings" as const, label: "Settings", icon: Settings },
  ];

  return (
    <div className="flex h-dvh overflow-hidden bg-workspace font-body text-foreground">
      {menuOpen && (
        <button
          aria-label="Close menu"
          className="fixed inset-0 z-30 bg-workspace/35 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[250px] shrink-0 flex-col border-r border-workspace-foreground/10 bg-workspace/95 text-workspace-foreground backdrop-blur-xl transition-transform md:static md:translate-x-0",
          menuOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-4 pb-3 pt-4">
          <Brand />
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden text-workspace-foreground"
            onClick={() => setMenuOpen(false)}
          >
            <X />
          </Button>
        </div>
        <div className="px-3 pt-2">
          <div className="rounded-lg border border-workspace-foreground/10 bg-workspace-foreground/[0.06] p-2.5">
            <div className="flex items-center gap-2">
              <span className="status-pulse size-2 rounded-full bg-positive" />
              <p className="font-mono text-[11px] text-workspace-foreground/80">Extension ready</p>
            </div>
            <p className="mt-1 pl-4 text-[10px] text-workspace-foreground/40">
              v0.1.0 · Chrome shell
            </p>
          </div>
        </div>
        <nav className="mt-3 flex-1 space-y-1 px-3" aria-label="Main navigation">
          {nav.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => {
                setView(id);
                setMenuOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                view === id
                  ? "bg-workspace-foreground/[0.09] text-workspace-foreground"
                  : "text-workspace-foreground/55 hover:bg-workspace-foreground/[0.05] hover:text-workspace-foreground/85",
              )}
            >
              <Icon className={cn("size-3.5", view === id && "text-primary")} />
              {label}
            </button>
          ))}
        </nav>
        <div className="p-3">
          <button
            onClick={() => setView("settings")}
            className="flex w-full items-center gap-2.5 rounded-lg border border-workspace-foreground/10 bg-workspace-foreground/[0.05] p-2.5 text-left"
          >
            <div className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/70 text-[11px] font-semibold">
              {initials}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-xs font-medium text-workspace-foreground/85 capitalize">
                {name}
              </p>
              <p className="truncate text-[10px] text-workspace-foreground/40">
                {session?.user.email ?? "Preview session"}
              </p>
            </div>
            <ChevronUp className="size-3 text-workspace-foreground/40" />
          </button>
        </div>
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col bg-background">
        <img
          src={frostImage}
          alt=""
          width={1920}
          height={1080}
          className="absolute inset-0 size-full object-cover"
        />
        <div className="absolute inset-0 bg-background/60 backdrop-blur-2xl" />
        <header className="relative z-10 flex h-14 shrink-0 items-center gap-3 border-b border-background/50 bg-background/40 px-3 backdrop-blur-md sm:px-5">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMenuOpen(true)}
          >
            <Menu />
          </Button>
          <div className="flex min-w-0 items-center gap-2 rounded-full border border-background/70 bg-background/60 py-1 pl-2 pr-3">
            <span className="size-2 shrink-0 rounded-full bg-primary" />
            <span className="truncate font-mono text-xs text-foreground/70">
              Current browser tab
            </span>
          </div>
          <span className="hidden text-xs text-foreground/35 sm:inline">/</span>
          <span className="hidden truncate text-xs font-medium text-foreground/75 sm:inline">
            {page.context.title.trim() ||
              (page.hasContent ? "Page text captured" : "No page captured yet")}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Previous tab" disabled>
              <ArrowLeft />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Next tab" disabled>
              <ArrowRight />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Refresh connection">
              <RefreshCw />
            </Button>
          </div>
        </header>
        <div className="relative z-10 flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-7">
            {view === "workspace" && (
              <WorkspaceHome
                name={String(name)}
                page={page}
                saved={saved}
                onSave={() => setSaved(true)}
              />
            )}
            {view === "writing" && (
              <WritingStudio seedText={page.context.selection || page.context.text} />
            )}
            {view === "knowledge" && <KnowledgeBase signedIn={Boolean(session)} />}
            {view === "agents" && (
              <AgentActivity signedIn={Boolean(session)} context={page.context} />
            )}
            {view === "tasks" && <TasksPanel signedIn={Boolean(session)} />}
            {view === "saved" && (
              <EmptyView
                icon={Bookmark}
                title="Saved pages"
                copy={
                  saved
                    ? "Your current page is kept for this session. Syncing saved pages to your account comes later."
                    : "Pages you save while browsing will collect here."
                }
              />
            )}
            {view === "sessions" && <HistoryPanel signedIn={Boolean(session)} />}
            {view === "automations" && <AutomationsPanel signedIn={Boolean(session)} />}
            {view === "settings" && (
              <SettingsView
                showStatus={showStatus}
                setShowStatus={setShowStatus}
                quiet={quiet}
                setQuiet={setQuiet}
                onSignOut={() => void signOut()}
                signedIn={Boolean(session)}
              />
            )}
          </main>
          {showStatus && <StatusPanel quiet={quiet} onSignOut={() => void signOut()} />}
        </div>
      </div>
    </div>
  );
}

function WorkspaceHome({
  name,
  page,
  saved,
  onSave,
}: {
  name: string;
  page: ReturnType<typeof usePageContext>;
  saved: boolean;
  onSave: () => void;
}) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary">
            Browser workspace
          </p>
          <h1 className="mt-1.5 font-display text-3xl font-medium capitalize">
            {greeting}, {name}
          </h1>
        </div>
        <Button variant="secondary" size="sm" onClick={onSave} disabled={saved || !page.hasContent}>
          <Bookmark />
          {saved ? "Saved" : "Save this page"}
        </Button>
      </div>
      <p className="mt-2 max-w-xl text-sm leading-6 text-foreground/60">
        Bring in what you are reading, then ask MindSpace to summarize it, explain it or pull out
        the key facts.
      </p>

      <div className="mt-6">
        <ContextCapture
          context={page.context}
          update={page.update}
          clear={page.clear}
          captureSelection={page.captureSelection}
          wordCount={page.wordCount}
        />
      </div>

      <div className="mt-5 flex min-h-[26rem] flex-col">
        <ChatPanel context={page.context} />
      </div>
    </div>
  );
}

function EmptyView({
  icon: Icon,
  title,
  copy,
}: {
  icon: typeof Bookmark;
  title: string;
  copy: string;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary">MindSpace</p>
      <h1 className="mt-2 font-display text-3xl font-medium">{title}</h1>
      <div className="mt-7 grid min-h-72 place-items-center rounded-lg bg-panel/60 p-8 text-center ring-1 ring-foreground/5">
        <div>
          <Icon className="mx-auto size-6 text-primary" />
          <p className="mt-4 text-sm font-medium">A clear space for now</p>
          <p className="mt-1 max-w-sm text-xs leading-5 text-foreground/50">{copy}</p>
        </div>
      </div>
    </div>
  );
}

function SettingsView({
  showStatus,
  setShowStatus,
  quiet,
  setQuiet,
  onSignOut,
  signedIn,
}: {
  showStatus: boolean;
  setShowStatus: (value: boolean) => void;
  quiet: boolean;
  setQuiet: (value: boolean) => void;
  onSignOut: () => void;
  signedIn: boolean;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-primary">Preferences</p>
      <h1 className="mt-2 font-display text-3xl font-medium">Settings</h1>
      <div className="mt-7 divide-y divide-border rounded-lg bg-panel/70 px-5 ring-1 ring-foreground/5">
        {" "}
        <SettingRow
          label="Show system status"
          copy="Keep connection details visible beside your workspace."
          checked={showStatus}
          onChange={setShowStatus}
        />
        <SettingRow
          label="Quiet mode"
          copy="Reduce connection animations and visual signals."
          checked={quiet}
          onChange={setQuiet}
        />
        <SettingRow
          label="Launch on browser start"
          copy="Available when the packaged Chrome extension is installed."
          checked={false}
          disabled
          onChange={() => undefined}
        />
      </div>
      <ConnectedServices signedIn={signedIn} />
      <MemorySettings signedIn={signedIn} />
      <div className="mt-6 flex items-center justify-between rounded-lg bg-panel/70 p-5 ring-1 ring-foreground/5">
        <div>
          <p className="text-sm font-medium">Account session</p>
          <p className="mt-1 text-xs text-foreground/45">
            Securely end this session on this browser.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onSignOut}>
          <LogOut />
          Sign out
        </Button>
      </div>
    </div>
  );
}

function SettingRow({
  label,
  copy,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  copy: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-5 py-5">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-1 text-xs leading-5 text-foreground/45">{copy}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-40",
          checked ? "bg-primary" : "bg-foreground/15",
        )}
      >
        <span
          className={cn(
            "absolute top-1 size-4 rounded-full bg-primary-foreground transition-transform",
            checked ? "translate-x-1" : "-translate-x-4",
          )}
        />
      </button>
    </div>
  );
}

function StatusPanel({ quiet, onSignOut }: { quiet: boolean; onSignOut: () => void }) {
  const statuses = useMemo(
    () => [
      { label: "Extension", value: "ready", tone: "positive" },
      { label: "Cloud", value: "connected", tone: "positive" },
      { label: "Assistant", value: "live", tone: "positive" },
      { label: "Agents", value: "live", tone: "positive" },
    ],
    [],
  );
  return (
    <aside className="hidden w-[236px] shrink-0 overflow-y-auto border-l border-background/50 bg-background/45 px-4 py-5 backdrop-blur-md lg:block">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-foreground/45">
        System
      </h2>
      <div className="mt-3 space-y-2">
        {statuses.map((item) => (
          <div key={item.label} className="rounded-lg bg-panel/65 p-2.5 ring-1 ring-foreground/5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-foreground/70">{item.label}</span>
              <span
                className={cn(
                  "flex items-center gap-1.5 font-mono text-[11px]",
                  item.tone === "positive" ? "text-positive" : "text-caution",
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    item.tone === "positive" ? "bg-positive" : "bg-caution",
                    !quiet && item.label === "Extension" && "status-pulse",
                  )}
                />
                {item.value}
              </span>
            </div>
          </div>
        ))}
      </div>
      <h2 className="mt-6 font-mono text-[11px] uppercase tracking-[0.16em] text-foreground/45">
        Boundaries
      </h2>
      <p className="mt-3 text-xs leading-5 text-foreground/55">
        MindSpace only sees the page text you bring in. It cannot browse, click or act on your
        behalf.
      </p>
      <div className="mt-6 border-t border-background/60 pt-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium">Account</p>
            <p className="text-[10px] text-foreground/40">Workspace access</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    </aside>
  );
}
