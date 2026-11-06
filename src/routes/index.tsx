import { createFileRoute } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";
import { Laptop, LoaderCircle, LogOut, Moon, ShieldCheck, Sun } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { AgentActivity } from "@/components/mindspace/agent-activity";
import { ApprovalsView } from "@/components/mindspace/approvals-view";
import { AskMindSpaceView } from "@/components/mindspace/ask-mindspace-view";
import { AutomationsPanel } from "@/components/mindspace/automations-panel";
import { CollectionsView } from "@/components/mindspace/collections-view";
import { ConnectedAccountsView } from "@/components/mindspace/connected-accounts-view";
import { ConnectedServices } from "@/components/mindspace/connected-services";
import { CurrentCaptureView } from "@/components/mindspace/current-capture-view";
import { HistoryPanel } from "@/components/mindspace/history-panel";
import { KnowledgeBase } from "@/components/mindspace/knowledge-base";
import { MemorySettings } from "@/components/mindspace/memory-settings";
import { MyWorkspaceView } from "@/components/mindspace/my-workspace-view";
import { NotificationsView } from "@/components/mindspace/notifications-view";
import { ObservabilityView } from "@/components/mindspace/observability-view";
import { OverviewView } from "@/components/mindspace/overview-view";
import { domainOf, usePageContext, useSavedPages } from "@/components/mindspace/page-context";
import { SavedPages } from "@/components/mindspace/saved-pages";
import { VIEW_LABELS, type MindSpaceView } from "@/components/mindspace/nav-items";
import { SidebarNav } from "@/components/mindspace/sidebar-nav";
import { TasksPanel } from "@/components/mindspace/tasks-panel";
import { TopBar } from "@/components/mindspace/top-bar";
import { SurfaceCard, ViewHeader } from "@/components/mindspace/ui";
import { WorkspaceHome } from "@/components/mindspace/workspace-home";
import { WritingStudio } from "@/components/mindspace/writing-studio";
import { Button } from "@/components/ui/button";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { useTheme } from "@/lib/theme";
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

export function MindSpaceApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const isExtension =
    typeof window !== "undefined" && typeof chrome !== "undefined" && Boolean(chrome?.runtime?.id);
  const [demo, setDemo] = useState(isExtension);

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
      <div className="grid min-h-dvh place-items-center bg-background text-foreground">
        <LoaderCircle className="size-5 animate-spin" aria-label="Loading MindSpace" />
      </div>
    );
  }

  if (!session && !demo) return <AuthScreen onPreview={() => setDemo(true)} />;

  return <Workspace session={session} onExitDemo={() => setDemo(false)} />;
}

/* -------------------------------------------------------------------------- */
/* Authentication                                                            */
/* -------------------------------------------------------------------------- */

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
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <section className="grid w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_60px_-40px_oklch(0.235_0.019_264/0.5)] md:grid-cols-[1fr_1fr]">
        <div className="hidden flex-col justify-between bg-navy p-8 text-navy-foreground md:flex">
          <BrandMark />

          <div>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-navy-muted">
              Browser workspace
            </p>
            <h1 className="mt-4 max-w-xs text-[34px] font-semibold leading-[1.15]">
              A quieter place to think with the web.
            </h1>
            <p className="mt-4 max-w-xs text-[13px] leading-6 text-navy-muted">
              Bring in the page you are reading and MindSpace will summarize it, explain it or pull
              out the key facts.
            </p>
          </div>

          <p className="flex items-start gap-2 text-[11.5px] leading-5 text-navy-muted">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            MindSpace only reads the page text you add. It cannot browse, click or act for you.
          </p>
        </div>

        <div className="px-6 py-9 sm:px-10">
          <div className="mb-8 md:hidden">
            <BrandMark dark />
          </div>

          <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-primary">
            {mode === "signin" ? "Welcome back" : "Create your space"}
          </p>
          <h2 className="mt-2 text-[24px] font-semibold text-foreground">
            {mode === "signin" ? "Sign in to MindSpace" : "Start with MindSpace"}
          </h2>
          <p className="mt-2 text-[13px] text-muted-foreground">
            {mode === "signin"
              ? "Continue to your browser workspace."
              : "Your account keeps future context private and in sync."}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block text-[11.5px] font-medium text-foreground">
              Email
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-[13px] outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </label>
            <label className="block text-[11.5px] font-medium text-foreground">
              Password
              <input
                required
                minLength={6}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 6 characters"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-[13px] outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </label>
            {message && (
              <p
                className="rounded-lg border border-border bg-muted px-3 py-2 text-[11.5px] leading-5 text-secondary-foreground"
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

          <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-[0.14em] text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
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

          <div className="mt-5 flex flex-col gap-2 text-[11.5px]">
            <button
              type="button"
              className="w-fit text-muted-foreground transition-colors hover:text-foreground"
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
              type="button"
              className="w-fit font-medium text-primary transition-colors hover:text-primary/75"
              onClick={onPreview}
            >
              Preview the workspace
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function BrandMark({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={cn(
          "grid size-9 place-items-center rounded-xl text-[15px] font-bold",
          dark ? "bg-navy text-navy-foreground" : "bg-navy-foreground text-navy",
        )}
      >
        M
      </div>
      <div className="leading-tight">
        <p
          className={cn(
            "text-[14px] font-semibold tracking-tight",
            dark ? "text-foreground" : "text-navy-foreground",
          )}
        >
          MindSpace
        </p>
        <p className={cn("text-[10.5px]", dark ? "text-muted-foreground" : "text-navy-muted")}>
          Browser workspace
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Workspace shell                                                           */
/* -------------------------------------------------------------------------- */

export function Workspace({
  session,
  onExitDemo,
}: {
  session: Session | null;
  onExitDemo: () => void;
}) {
  const [view, setView] = useState<MindSpaceView>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
  const [quiet, setQuiet] = useState(false);

  const page = usePageContext();
  const savedPages = useSavedPages();

  const rawName =
    session?.user.user_metadata?.["full_name"] || session?.user.email?.split("@")[0] || "Explorer";
  const name = String(rawName);
  const initials =
    name
      .split(" ")
      .map((part: string) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "M";
  const user = {
    name,
    email: session?.user.email ?? "Preview session",
    initials,
    preview: !session,
  };

  async function signOut() {
    if (session) await supabase.auth.signOut();
    else onExitDemo();
  }

  function selectView(next: MindSpaceView) {
    setView(next);
    setMenuOpen(false);
  }

  return (
    <div
      className={cn(
        "flex h-dvh overflow-hidden bg-background font-body text-foreground",
        quiet && "quiet",
      )}
    >
      {menuOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-navy/40 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 shrink-0 transition-all duration-200 md:static md:translate-x-0",
          sidebarCollapsed ? "md:w-16" : "md:w-[240px]",
          menuOpen ? "translate-x-0 w-[240px]" : "-translate-x-full",
        )}
      >
        <SidebarNav
          view={view}
          onSelect={selectView}
          user={user}
          onSignOut={() => void signOut()}
          onClose={() => setMenuOpen(false)}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          pageTitle={page.context.title.trim()}
          domain={domainOf(page.context.url)}
          hasContext={page.hasContent}
          quiet={quiet}
          onOpenMenu={() => setMenuOpen(true)}
          onAddPageText={() => {
            selectView("workspace");
            setCaptureOpen(true);
          }}
        />

        <div className="flex min-h-0 flex-1">
          <main className="scrollbar-slim min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
            {(view === "overview" || view === "home") && (
              <OverviewView
                name={name}
                context={page.context}
                onNavigate={(v) => selectView(v)}
                onCapture={() => selectView("capture")}
              />
            )}
            {view === "capture" && (
              <CurrentCaptureView context={page.context} onRunTask={() => selectView("agents")} />
            )}
            {view === "workspace" && (
              <MyWorkspaceView
                context={page.context}
                signedIn={Boolean(session)}
                savedItems={savedPages.items}
                savedHydrated={savedPages.hydrated}
                onRemoveSaved={savedPages.remove}
              />
            )}
            {view === "approvals" && <ApprovalsView />}
            {view === "notifications" && <NotificationsView />}
            {view === "accounts" && <ConnectedAccountsView signedIn={Boolean(session)} />}
            {view === "observability" && <ObservabilityView />}
            {(view === "collections" || view === "saved") && (
              <CollectionsView
                items={savedPages.items}
                hydrated={savedPages.hydrated}
                onRemove={savedPages.remove}
              />
            )}
            {view === "ask" && <AskMindSpaceView context={page.context} />}
            {(view === "research" || view === "knowledge") && (
              <KnowledgeBase signedIn={Boolean(session)} />
            )}
            {view === "writing" && (
              <WritingStudio seedText={page.context.selection || page.context.text} />
            )}
            {view === "agents" && (
              <AgentActivity signedIn={Boolean(session)} context={page.context} />
            )}
            {(view === "history" || view === "sessions") && (
              <HistoryPanel signedIn={Boolean(session)} />
            )}
            {view === "tasks" && <TasksPanel signedIn={Boolean(session)} />}
            {view === "automations" && <AutomationsPanel signedIn={Boolean(session)} />}
            {view === "settings" && (
              <SettingsView
                showDetails={showDetails}
                setShowDetails={setShowDetails}
                quiet={quiet}
                setQuiet={setQuiet}
                onSignOut={() => void signOut()}
                signedIn={Boolean(session)}
                preview={!session}
              />
            )}
          </main>

          {showDetails && (
            <DetailsRail
              view={view}
              wordCount={page.wordCount}
              hasContext={page.hasContent}
              savedCount={savedPages.items.length}
              preview={!session}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Details rail                                                              */
/* -------------------------------------------------------------------------- */

function DetailsRail({
  view,
  wordCount,
  hasContext,
  savedCount,
  preview,
}: {
  view: MindSpaceView;
  wordCount: number;
  hasContext: boolean;
  savedCount: number;
  preview: boolean;
}) {
  return (
    <aside className="scrollbar-slim hidden w-[252px] shrink-0 overflow-y-auto border-l border-border bg-card px-4 py-5 xl:block">
      <h2 className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground">
        This session
      </h2>

      <dl className="mt-3 space-y-2">
        <RailRow label="View" value={VIEW_LABELS[view]} />
        <RailRow
          label="Page context"
          value={hasContext ? `${wordCount.toLocaleString()} words added` : "Not added yet"}
        />
        <RailRow label="Saved pages" value={`${savedCount} on this device`} />
        <RailRow label="Account" value={preview ? "Preview mode" : "Signed in"} />
      </dl>

      <h2 className="mt-6 font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground">
        Boundaries
      </h2>
      <p className="mt-3 text-[11.5px] leading-5 text-muted-foreground">
        MindSpace only sees the page text you add. It cannot browse, click or act on your behalf,
        and this build has no screenshot capture.
      </p>
    </aside>
  );
}

function RailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-2.5 py-2">
      <dt className="text-[10.5px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-[12px] font-medium text-foreground">{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                  */
/* -------------------------------------------------------------------------- */

function SettingsView({
  showDetails,
  setShowDetails,
  quiet,
  setQuiet,
  onSignOut,
  signedIn,
  preview,
}: {
  showDetails: boolean;
  setShowDetails: (value: boolean) => void;
  quiet: boolean;
  setQuiet: (value: boolean) => void;
  onSignOut: () => void;
  signedIn: boolean;
  preview: boolean;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <ViewHeader
        eyebrow="Settings"
        title="Preferences"
        description="How the workspace behaves, and what it is connected to."
      />

      <SurfaceCard className="mt-5 px-4 sm:px-5">
        <ThemeSettingRow />
        <SettingRow
          label="Show page details"
          copy="Keep a summary of this session beside your workspace on wide screens."
          checked={showDetails}
          onChange={setShowDetails}
        />
        <SettingRow
          label="Reduce motion"
          copy="Turn off the workspace's optional fade and pulse animations."
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
      </SurfaceCard>

      <ConnectedServices signedIn={signedIn} />
      <MemorySettings signedIn={signedIn} />

      <SurfaceCard className="mt-4 flex items-center justify-between gap-4 p-4 sm:p-5">
        <div>
          <p className="text-sm font-medium text-foreground">
            {preview ? "Preview session" : "Account session"}
          </p>
          <p className="mt-1 text-[11.5px] leading-5 text-muted-foreground">
            {preview
              ? "You are previewing the workspace without an account, so nothing is saved to a server."
              : "Securely end this session on this browser."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onSignOut}>
          <LogOut aria-hidden="true" />
          {preview ? "Exit preview" : "Sign out"}
        </Button>
      </SurfaceCard>
    </div>
  );
}

function ThemeSettingRow() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-4">
      <div>
        <p className="text-[13px] font-medium text-foreground">Theme & Appearance</p>
        <p className="mt-1 text-[11.5px] leading-5 text-muted-foreground">
          Persistent theme preference across refresh, extension reloads, and browser restarts.
        </p>
      </div>
      <div className="inline-flex rounded-lg border border-border bg-muted/60 p-1">
        {(["light", "dark", "system"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTheme(t)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1 text-[12px] font-medium capitalize transition-colors",
              theme === t
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "light" && <Sun className="size-3.5" />}
            {t === "dark" && <Moon className="size-3.5" />}
            {t === "system" && <Laptop className="size-3.5" />}
            {t}
          </button>
        ))}
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
    <div className="flex items-center justify-between gap-5 border-b border-border py-4 last:border-b-0">
      <div>
        <p className="text-[13px] font-medium text-foreground">{label}</p>
        <p className="mt-1 text-[11.5px] leading-5 text-muted-foreground">{copy}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-40",
          checked ? "bg-primary" : "bg-foreground/15",
        )}
      >
        <span
          className={cn(
            "absolute top-1 size-4 rounded-full bg-primary-foreground shadow-sm transition-transform",
            checked ? "translate-x-5" : "translate-x-1",
          )}
        />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
