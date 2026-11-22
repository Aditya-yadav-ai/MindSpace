import { createFileRoute } from "@tanstack/react-router";
import type { Session } from "@supabase/supabase-js";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Laptop,
  LoaderCircle,
  Lock,
  LogOut,
  Mail,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  User,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { AgentActivity } from "@/components/mindspace/agent-activity";
import { ApprovalsView } from "@/components/mindspace/approvals-view";
import { AskMindSpaceView } from "@/components/mindspace/ask-mindspace-view";
import { AutomationsPanel } from "@/components/mindspace/automations-panel";
import { CollectionsView } from "@/components/mindspace/collections-view";
import { ConnectedAccountsView } from "@/components/mindspace/connected-accounts-view";
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
import { authCreateDemoSession, authForgotPassword, authResetPassword } from "@/lib/auth.functions";
import { loadClientSession, setClientSession, clearClientSession } from "@/lib/auth-client";

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

type AuthMode = "signin" | "signup" | "forgot" | "reset";

export function MindSpaceApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    void (async () => {
      // 1. Check client session storage (localStorage or extension storage)
      const stored = await loadClientSession();
      if (stored && stored.user) {
        if (stored.user.role === "demo") {
          setDemo(true);
        }
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          setSession(data.session);
        }
      } else {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          setSession(data.session);
        }
      }
      setChecking(false);
    })();

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user?.app_metadata?.role === "demo") {
        setDemo(true);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (checking) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-3">
          <LoaderCircle
            className="size-6 animate-spin text-primary"
            aria-label="Loading MindSpace"
          />
          <p className="text-xs text-muted-foreground font-mono">Authenticating MindSpace...</p>
        </div>
      </div>
    );
  }

  // Authentication-First Gate: Unauthenticated users MUST see the Login/Signup screen.
  if (!session && !demo) {
    return (
      <AuthScreen
        onAuthenticated={(newSession) => {
          setSession(newSession);
          setDemo(false);
        }}
        onEnterDemo={async () => {
          try {
            const res = await authCreateDemoSession({});
            await setClientSession(res.session, false);
            setDemo(true);
          } catch {
            setDemo(true);
          }
        }}
      />
    );
  }

  return (
    <Workspace
      session={session}
      isDemo={demo}
      onSignOut={async () => {
        try {
          await supabase.auth.signOut();
        } catch {
          // Ignore
        }
        await clearClientSession();
        setSession(null);
        setDemo(false);
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Polished MindSpace Authentication Screen                                   */
/* -------------------------------------------------------------------------- */

function AuthScreen({
  onAuthenticated,
  onEnterDemo,
}: {
  onAuthenticated: (session: Session) => void;
  onEnterDemo: () => void;
}) {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  function resetState() {
    setErrorMsg(null);
    setSuccessMsg(null);
    setPassword("");
    setConfirmPassword("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      if (mode === "signin") {
        const result = await supabase.auth.signInWithPassword({ email, password });
        if (result.error) {
          setErrorMsg(result.error.message);
          setBusy(false);
          return;
        }
        if (result.data.session) {
          onAuthenticated(result.data.session);
        }
      } else if (mode === "signup") {
        if (password !== confirmPassword) {
          setErrorMsg("Passwords do not match. Please verify.");
          setBusy(false);
          return;
        }
        const result = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName.trim() || email.split("@")[0] } },
        });
        if (result.error) {
          setErrorMsg(result.error.message);
          setBusy(false);
          return;
        }
        if (result.data.session) {
          onAuthenticated(result.data.session);
        } else {
          setSuccessMsg("Account created! Please sign in with your credentials.");
          setMode("signin");
        }
      } else if (mode === "forgot") {
        const res = await authForgotPassword({ data: { email } });
        setSuccessMsg(res.message);
      } else if (mode === "reset") {
        if (password !== confirmPassword) {
          setErrorMsg("Passwords do not match.");
          setBusy(false);
          return;
        }
        const res = await authResetPassword({ data: { token: resetToken, newPassword: password } });
        setSuccessMsg(res.message);
        setMode("signin");
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "An unexpected authentication error occurred.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-8">
      <section className="grid w-full max-w-4xl overflow-hidden rounded-2xl border border-border/80 bg-card shadow-[0_24px_60px_-40px_rgba(0,0,0,0.6)] md:grid-cols-[1.1fr_1fr]">
        {/* Left Branding Showcase */}
        <div className="hidden flex-col justify-between bg-navy p-8 text-navy-foreground md:flex">
          <BrandMark />

          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-[11px] font-mono uppercase tracking-wider text-blue-300">
              <Sparkles className="size-3" />
              <span>Multimodal AI Browser Assistant</span>
            </div>
            <h1 className="text-[30px] font-bold leading-tight text-white">
              Private, grounded intelligence for everything you read.
            </h1>
            <p className="text-[13px] leading-relaxed text-navy-muted">
              Analyze webpages, query 14 integrated Google services, synthesize notes, and
              orchestrate multi-agent workflows from Chrome side panel.
            </p>
          </div>

          <div className="space-y-2 border-t border-navy-muted/20 pt-4 text-[11.5px] text-navy-muted">
            <p className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-emerald-400" />
              <span>Strict same-email Google Account linking</span>
            </p>
            <p className="flex items-center gap-2">
              <Lock className="size-4 text-blue-400" />
              <span>AES-256-GCM encrypted credential vault</span>
            </p>
          </div>
        </div>

        {/* Right Form Container */}
        <div className="flex flex-col justify-between px-6 py-8 sm:px-10">
          <div>
            <div className="mb-6 flex items-center justify-between">
              <BrandMark dark />
              <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10.5px] font-mono text-muted-foreground">
                MV3 Stage 8
              </span>
            </div>

            {/* Mode Titles */}
            <div className="space-y-1">
              <h2 className="text-xl font-bold tracking-tight text-foreground">
                {mode === "signin" && "Sign in to MindSpace"}
                {mode === "signup" && "Create your MindSpace account"}
                {mode === "forgot" && "Reset your password"}
                {mode === "reset" && "Set new password"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {mode === "signin" && "Enter your credentials to access your browser workspace."}
                {mode === "signup" && "Sign up to synchronize notes and link your Google services."}
                {mode === "forgot" && "Enter your account email to receive reset instructions."}
                {mode === "reset" && "Enter your reset token and new password."}
              </p>
            </div>

            {/* Error & Success Banners */}
            {errorMsg && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span className="leading-snug">{errorMsg}</span>
              </div>
            )}
            {successMsg && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                <span className="leading-snug">{successMsg}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={submit} className="mt-5 space-y-3.5">
              {mode === "signup" && (
                <div>
                  <label className="block text-[11px] font-medium text-foreground mb-1">
                    Full Name
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                    <input
                      required
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Jane Doe"
                      className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>
              )}

              {mode !== "reset" && (
                <div>
                  <label className="block text-[11px] font-medium text-foreground mb-1">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                    <input
                      required
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@example.com"
                      autoComplete="email"
                      className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>
              )}

              {mode === "reset" && (
                <div>
                  <label className="block text-[11px] font-medium text-foreground mb-1">
                    Reset Token
                  </label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                    <input
                      required
                      type="text"
                      value={resetToken}
                      onChange={(e) => setResetToken(e.target.value)}
                      placeholder="Paste your reset token"
                      className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-xs outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>
              )}

              {mode !== "forgot" && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-medium text-foreground">
                      {mode === "reset" ? "New Password" : "Password"}
                    </label>
                    {mode === "signin" && (
                      <button
                        type="button"
                        onClick={() => {
                          setMode("forgot");
                          resetState();
                        }}
                        className="text-[11px] text-primary hover:underline"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                    <input
                      required
                      minLength={6}
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete={mode === "signin" ? "current-password" : "new-password"}
                      className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-9 text-xs outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>
              )}

              {(mode === "signup" || mode === "reset") && (
                <div>
                  <label className="block text-[11px] font-medium text-foreground mb-1">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                    <input
                      required
                      minLength={6}
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-9 text-xs outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>
              )}

              {mode === "signin" && (
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="rememberMe"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="size-3.5 rounded border-border text-primary focus:ring-primary"
                  />
                  <label htmlFor="rememberMe" className="text-[11.5px] text-muted-foreground">
                    Keep me signed in
                  </label>
                </div>
              )}

              <Button className="w-full mt-2" disabled={busy}>
                {busy && <LoaderCircle className="size-4 animate-spin mr-1.5" />}
                {mode === "signin" && "Sign In"}
                {mode === "signup" && "Create Account"}
                {mode === "forgot" && "Send Reset Link"}
                {mode === "reset" && "Update Password"}
              </Button>
            </form>

            {/* Switch Mode Links */}
            <div className="mt-4 flex flex-col gap-2 text-xs">
              {mode === "signin" ? (
                <button
                  type="button"
                  onClick={() => {
                    setMode("signup");
                    resetState();
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors text-left"
                >
                  New to MindSpace?{" "}
                  <span className="font-semibold text-primary">Create an account</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMode("signin");
                    resetState();
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors text-left"
                >
                  Already have an account?{" "}
                  <span className="font-semibold text-primary">Sign in</span>
                </button>
              )}
            </div>
          </div>

          {/* Academic Demo Mode Button */}
          <div className="mt-6 border-t border-border pt-4">
            <div className="rounded-xl border border-border/80 bg-muted/30 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-semibold text-foreground">
                    Offline Evaluation Mode
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Explore workspace with local intelligence without cloud credentials
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onEnterDemo}
                  className="text-xs h-7 gap-1"
                >
                  <span>Explore Demo</span>
                  <ArrowRight className="size-3" />
                </Button>
              </div>
            </div>
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
          "grid size-9 place-items-center rounded-xl text-[15px] font-bold shadow-sm",
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
        <p className={cn("text-[10px]", dark ? "text-muted-foreground" : "text-navy-muted")}>
          AI Browser Workspace
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
  isDemo = false,
  onSignOut,
}: {
  session: Session | null;
  isDemo?: boolean;
  onSignOut: () => void;
}) {
  const [view, setView] = useState<MindSpaceView>(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const v = params.get("view");
      if (v && v in VIEW_LABELS) return v as MindSpaceView;
    }
    return "overview";
  });

  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
  const [quiet, setQuiet] = useState(false);

  const page = usePageContext();
  const savedPages = useSavedPages();

  const userEmail =
    session?.user?.email || (isDemo ? "demo@mindspace.local" : "user@mindspace.local");
  const rawName =
    session?.user?.user_metadata?.["full_name"] ||
    session?.user?.email?.split("@")[0] ||
    (isDemo ? "Demo Evaluator" : "Explorer");

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
    email: userEmail,
    initials,
    preview: isDemo || !session,
  };

  useEffect(() => {
    function onPopState() {
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const v = params.get("view");
        if (v && v in VIEW_LABELS) {
          setView(v as MindSpaceView);
        } else {
          setView("overview");
        }
      }
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function selectView(next: MindSpaceView) {
    setView(next);
    setMenuOpen(false);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("view", next);
      window.history.pushState({ view: next }, "", url.toString());
    }
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
          onSignOut={onSignOut}
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
          onSignOut={onSignOut}
          userInitials={user.initials}
          userName={user.name}
          userEmail={user.email}
          preview={user.preview}
        />

        {isDemo && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-1.5 flex items-center justify-between text-xs text-amber-700 dark:text-amber-400">
            <span className="flex items-center gap-1.5 font-medium">
              <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
              Demo Mode Active — Running locally with offline simulated intelligence. No cloud
              credentials required.
            </span>
            <button
              type="button"
              onClick={onSignOut}
              className="text-[11px] underline hover:no-underline font-semibold"
            >
              Sign In to Real Account
            </button>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <main className="scrollbar-slim flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
            {view === "overview" && (
              <OverviewView
                onNavigate={selectView}
                savedCount={savedPages.items.length}
                hasContext={page.hasContent}
                context={page.context}
              />
            )}
            {view === "capture" && (
              <CurrentCaptureView
                context={page.context}
                hasContent={page.hasContent}
                activeAction={page.activeAction}
                onRunAction={page.runAction}
                onClear={page.clear}
                onSelectView={selectView}
              />
            )}
            {view === "workspace" && (
              <MyWorkspaceView
                context={page.context}
                signedIn={Boolean(session) || isDemo}
                savedItems={savedPages.items}
                savedHydrated={savedPages.hydrated}
                onRemoveSaved={savedPages.remove}
              />
            )}
            {view === "approvals" && <ApprovalsView />}
            {view === "notifications" && <NotificationsView />}
            {view === "accounts" && (
              <ConnectedAccountsView signedIn={Boolean(session) || isDemo} userEmail={user.email} />
            )}
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
              <KnowledgeBase signedIn={Boolean(session) || isDemo} />
            )}
            {view === "writing" && (
              <WritingStudio seedText={page.context.selection || page.context.text} />
            )}
            {view === "agents" && (
              <AgentActivity signedIn={Boolean(session) || isDemo} context={page.context} />
            )}
            {(view === "history" || view === "sessions") && (
              <HistoryPanel signedIn={Boolean(session) || isDemo} />
            )}
            {view === "tasks" && <TasksPanel signedIn={Boolean(session) || isDemo} />}
            {view === "automations" && <AutomationsPanel signedIn={Boolean(session) || isDemo} />}
            {view === "settings" && (
              <SettingsView
                showDetails={showDetails}
                setShowDetails={setShowDetails}
                quiet={quiet}
                setQuiet={setQuiet}
                onSignOut={onSignOut}
                signedIn={Boolean(session) || isDemo}
                preview={user.preview}
              />
            )}
          </main>

          {showDetails && (
            <DetailsRail
              view={view}
              wordCount={page.wordCount}
              hasContext={page.hasContent}
              savedCount={savedPages.items.length}
              preview={user.preview}
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
        <RailRow label="Account" value={preview ? "Demo Evaluator" : "Authenticated User"} />
      </dl>

      <h2 className="mt-6 font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground">
        Security Controls
      </h2>
      <p className="mt-3 text-[11.5px] leading-5 text-muted-foreground">
        Verified PyJWT token authentication and AES-256-GCM token encryption active. All external
        mutating operations gated with human confirmation.
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
  setShowDetails: (value: boolean | ((current: boolean) => boolean)) => void;
  quiet: boolean;
  setQuiet: (value: boolean | ((current: boolean) => boolean)) => void;
  onSignOut: () => void;
  signedIn: boolean;
  preview: boolean;
}) {
  const { theme, setTheme } = useTheme();

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-primary">
          Preferences
        </p>
        <h1 className="mt-2 text-[26px] font-semibold text-foreground">Settings</h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Tune MindSpace to how you read and think.
        </p>
      </div>

      <div className="space-y-6">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-[14px] font-semibold text-foreground">Theme</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Choose light, dark or mirror your operating system.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              { id: "light" as const, label: "Light", icon: Sun },
              { id: "dark" as const, label: "Dark", icon: Moon },
              { id: "system" as const, label: "System", icon: Laptop },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTheme(id)}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors",
                  theme === id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-foreground hover:bg-muted",
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-[14px] font-semibold text-foreground">Workspace layout</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Adjust the panels visible on larger screens.
          </p>
          <label className="mt-4 flex items-center justify-between gap-4 text-[13px]">
            <span>Show session details rail</span>
            <input
              type="checkbox"
              checked={showDetails}
              onChange={(e) => setShowDetails(e.target.checked)}
              className="size-4 rounded border-border text-primary focus:ring-primary"
            />
          </label>
          <label className="mt-3 flex items-center justify-between gap-4 text-[13px]">
            <span>Quiet mode (hide side navigation labels)</span>
            <input
              type="checkbox"
              checked={quiet}
              onChange={(e) => setQuiet(e.target.checked)}
              className="size-4 rounded border-border text-primary focus:ring-primary"
            />
          </label>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-[14px] font-semibold text-foreground">Account & Session</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {preview
              ? "Currently running in local evaluation mode."
              : "Manage your active authenticated session."}
          </p>
          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {preview ? "Evaluation Session" : "Signed in"}
            </span>
            <Button variant="outline" size="sm" onClick={onSignOut} className="gap-1.5 text-xs">
              <LogOut className="size-3.5" />
              Sign Out
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
