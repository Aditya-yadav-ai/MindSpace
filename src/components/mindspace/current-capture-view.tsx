import * as React from "react";
import {
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  Cpu,
  DollarSign,
  ExternalLink,
  Layers,
  Link as LinkIcon,
  ListTodo,
  Play,
  RefreshCw,
  Scan,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { Button3D } from "@/components/ui/button-3d";
import { Card3D, Card3DContent, Card3DHeader, Card3DTitle } from "@/components/ui/card-3d";
import type { PageContext } from "@/components/mindspace/page-context";

export interface ScreenshotData {
  url: string;
  title: string;
  screenshot?: string | null;
  layout_type?: string;
  captured_at?: string;
  entities?: {
    dates?: string[];
    amounts?: string[];
    links?: string[];
    actions?: string[];
  };
  suggested_tasks?: string[];
}

export function CurrentCaptureView({
  context,
  onRunTask,
}: {
  context: PageContext;
  onRunTask?: (task: string) => void;
}) {
  const [capturing, setCapturing] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<"entities" | "text" | "plan">("entities");
  const [screenshotUrl, setScreenshotUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (typeof chrome !== "undefined" && chrome?.storage?.local) {
      chrome.storage.local.get(
        { lastScreenshotCapture: null },
        (items: { [key: string]: unknown }) => {
          const sc = items["lastScreenshotCapture"] as { screenshot?: string } | undefined;
          if (sc?.screenshot) {
            setScreenshotUrl(sc.screenshot);
          }
        },
      );
      const onMsg = (msg: { type?: string; payload?: { data?: { screenshot?: string } } }) => {
        if (msg?.type === "MINDSPACE_SCREENSHOT_CAPTURED" && msg.payload?.data?.screenshot) {
          setScreenshotUrl(msg.payload.data.screenshot);
        }
      };
      chrome.runtime?.onMessage?.addListener(onMsg);
      return () => {
        chrome.runtime?.onMessage?.removeListener(onMsg);
      };
    }
    return undefined;
  }, []);

  // Derive visual layout and entities from the current page text
  const derivedEntities = React.useMemo(() => {
    const text = context.text || "";
    const dates = Array.from(text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)).map((m) => m[0]);
    const namedDates = Array.from(
      text.matchAll(
        /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}\b/gi,
      ),
    ).map((m) => m[0]);
    const allDates = Array.from(new Set([...dates, ...namedDates]));

    const amounts = Array.from(
      text.matchAll(
        /(\$\s*\d+(?:,\d{3})*(?:\.\d{2})?|\b\d+(?:,\d{3})*(?:\.\d{2})?\s*(?:USD|EUR)\b)/gi,
      ),
    ).map((m) => m[0]);

    const links = Array.from(text.matchAll(/https?:\/\/[^\s<>"]+/g)).map((m) => m[0]);

    const actions = text
      .split(/[.!?\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20 && s.length < 140)
      .filter((s) =>
        /\b(todo|to-do|action|deadline|schedule|email|submit|approve|send)\b/i.test(s),
      );

    return {
      dates: allDates.slice(0, 8),
      amounts: Array.from(new Set(amounts)).slice(0, 8),
      links: Array.from(new Set(links)).slice(0, 8),
      actions: Array.from(new Set(actions)).slice(0, 6),
    };
  }, [context.text]);

  const detectedLayout = React.useMemo(() => {
    const lower = (context.url + " " + context.title).toLowerCase();
    if (lower.includes("calendar") || lower.includes("meeting")) return "calendar_schedule";
    if (lower.includes("mail") || lower.includes("gmail") || lower.includes("inbox"))
      return "communication";
    if (lower.includes("shop") || lower.includes("product") || lower.includes("price"))
      return "ecommerce";
    if (lower.includes("doc") || lower.includes("sheet") || lower.includes("notion"))
      return "workspace_document";
    return "article";
  }, [context.url, context.title]);

  const suggestedTasks = React.useMemo(() => {
    const list: string[] = [];
    if (detectedLayout === "calendar_schedule" || derivedEntities.dates.length > 0) {
      list.push("Create calendar event for detected dates and send notifications");
      list.push("Draft reminder tasks for upcoming deadlines");
    }
    if (detectedLayout === "ecommerce" || derivedEntities.amounts.length > 0) {
      list.push("Extract product pricing specification and compare against alternatives");
    }
    if (derivedEntities.actions.length > 0) {
      list.push("Generate action item checklist and assign to workspace task queue");
    }
    list.push("Synthesize entire page into structured executive brief with citations");
    list.push("Extract all outbound links and fact-check key claims");
    return list;
  }, [detectedLayout, derivedEntities]);

  const handleCaptureNow = () => {
    setCapturing(true);
    if (typeof chrome !== "undefined" && chrome?.runtime?.sendMessage) {
      chrome.runtime.sendMessage(
        { type: "MINDSPACE_CAPTURE_SCREENSHOT" },
        (resp: { data?: { screenshot?: string } } | undefined) => {
          setCapturing(false);
          if (resp?.data?.screenshot) {
            setScreenshotUrl(resp.data.screenshot);
          }
        },
      );
    } else {
      setTimeout(() => {
        setCapturing(false);
      }, 800);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Current Screen Capture
            </h1>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary capitalize">
              {detectedLayout.replace("_", " ")}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Multimodal screenshot analysis & entity extraction by Vision Agent
          </p>
        </div>

        <Button3D
          variant="primary"
          onClick={handleCaptureNow}
          disabled={capturing}
          className="gap-2 shrink-0"
        >
          {capturing ? (
            <RefreshCw className="size-4 animate-spin" />
          ) : (
            <Camera className="size-4" />
          )}
          <span>{capturing ? "Capturing Screen..." : "Retake Screenshot"}</span>
        </Button3D>
      </div>

      {/* Screen Preview & Visual Understanding */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left 2 Cols: Screen Viewport Preview */}
        <Card3D className="overflow-hidden lg:col-span-2">
          {/* Simulated Browser Bar */}
          <div className="flex items-center gap-2 border-b border-border/80 bg-muted/40 px-4 py-2.5">
            <div className="flex gap-1.5">
              <span className="size-2.5 rounded-full bg-rose-400" />
              <span className="size-2.5 rounded-full bg-amber-400" />
              <span className="size-2.5 rounded-full bg-emerald-400" />
            </div>
            <div className="flex-1 truncate rounded-lg border border-border/60 bg-background/80 px-3 py-1 font-mono text-[11px] text-muted-foreground text-center">
              {context.url || "https://browser.active-tab/current"}
            </div>
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-mono text-primary font-bold">
              1080p
            </span>
          </div>

          {/* Screen Content Viewport */}
          <div className="relative min-h-[280px] sm:min-h-[360px] bg-gradient-to-br from-background to-muted/20 p-6 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                <Scan className="size-4 animate-pulse" />
                <span>Screen Elements Identified</span>
              </div>
              <h2 className="text-lg font-bold text-foreground">
                {context.title || "Active Webpage Context"}
              </h2>

              {screenshotUrl && (
                <div className="overflow-hidden rounded-xl border border-border/70 bg-black/5 shadow-inner">
                  <img
                    src={screenshotUrl}
                    alt="Captured screen viewport"
                    className="max-h-[320px] w-full rounded-lg object-contain"
                  />
                </div>
              )}

              <div className="rounded-xl border border-border/60 bg-card/80 p-4 text-xs text-muted-foreground leading-relaxed max-h-56 overflow-y-auto scrollbar-slim">
                {context.text ? (
                  context.text.slice(0, 800) + (context.text.length > 800 ? "..." : "")
                ) : (
                  <p className="italic text-muted-foreground/80">
                    No page text captured yet. Click "Retake Screenshot" to capture screen context.
                  </p>
                )}
              </div>
            </div>

            {/* Visual Overlays / Bounding Tags */}
            <div className="mt-4 flex flex-wrap gap-2 pt-2 border-t border-border/40">
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-3" />
                {derivedEntities.dates.length} Dates Detected
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-1 text-[11px] font-medium text-blue-600 dark:text-blue-400">
                <DollarSign className="size-3" />
                {derivedEntities.amounts.length} Monetary Values
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-violet-500/10 px-2 py-1 text-[11px] font-medium text-violet-600 dark:text-violet-400">
                <LinkIcon className="size-3" />
                {derivedEntities.links.length} URLs Mapped
              </span>
            </div>
          </div>
        </Card3D>

        {/* Right Col: AI Supervisor Recommendations */}
        <div className="space-y-4">
          <Card3D glow className="p-5 space-y-4">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <Sparkles className="size-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">AI Task Generator</h3>
                <p className="text-[11px] text-muted-foreground">Select an autonomous plan</p>
              </div>
            </div>

            <div className="space-y-2">
              {suggestedTasks.map((task, idx) => (
                <div
                  key={idx}
                  className="group flex flex-col gap-2 rounded-xl border border-border/70 bg-card p-3 transition-all hover:border-primary/50 hover:shadow-sm"
                >
                  <p className="text-xs font-medium text-foreground leading-snug">{task}</p>
                  <Button3D
                    variant="secondary"
                    size="sm"
                    className="self-end text-[11px] h-7 px-2.5 gap-1"
                    onClick={() => onRunTask && onRunTask(task)}
                  >
                    <Play className="size-3 text-primary" />
                    <span>Run Workflow</span>
                  </Button3D>
                </div>
              ))}
            </div>
          </Card3D>
        </div>
      </div>

      {/* Tabbed Entity Details */}
      <Card3D className="p-5">
        <div className="flex items-center gap-3 border-b border-border pb-3">
          <button
            onClick={() => setActiveTab("entities")}
            className={`text-xs font-bold uppercase tracking-wider pb-1 transition-colors ${
              activeTab === "entities"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Extracted Entities (
            {derivedEntities.dates.length +
              derivedEntities.amounts.length +
              derivedEntities.links.length}
            )
          </button>
          <button
            onClick={() => setActiveTab("plan")}
            className={`text-xs font-bold uppercase tracking-wider pb-1 transition-colors ${
              activeTab === "plan"
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Supervisor Architecture Plan
          </button>
        </div>

        <div className="pt-4">
          {activeTab === "entities" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {/* Dates */}
              <div className="space-y-2">
                <span className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                  <Calendar className="size-3.5 text-primary" />
                  <span>Dates & Deadlines</span>
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {derivedEntities.dates.length > 0 ? (
                    derivedEntities.dates.map((d, i) => (
                      <span
                        key={i}
                        className="rounded-lg border border-border bg-muted/40 px-2 py-1 font-mono text-xs text-foreground"
                      >
                        {d}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground italic">None detected</span>
                  )}
                </div>
              </div>

              {/* Amounts */}
              <div className="space-y-2">
                <span className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                  <DollarSign className="size-3.5 text-emerald-500" />
                  <span>Amounts & Prices</span>
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {derivedEntities.amounts.length > 0 ? (
                    derivedEntities.amounts.map((a, i) => (
                      <span
                        key={i}
                        className="rounded-lg border border-border bg-muted/40 px-2 py-1 font-mono text-xs text-foreground"
                      >
                        {a}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground italic">None detected</span>
                  )}
                </div>
              </div>

              {/* Links */}
              <div className="space-y-2">
                <span className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                  <ExternalLink className="size-3.5 text-blue-500" />
                  <span>Referenced URLs</span>
                </span>
                <div className="space-y-1">
                  {derivedEntities.links.length > 0 ? (
                    derivedEntities.links.map((l, i) => (
                      <a
                        key={i}
                        href={l}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate rounded-lg border border-border bg-muted/40 px-2 py-1 font-mono text-[11px] text-blue-600 hover:underline dark:text-blue-400"
                      >
                        {l}
                      </a>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground italic">None detected</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === "plan" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-xl bg-primary/5 p-3 text-xs text-primary border border-primary/20">
                <Cpu className="size-4 shrink-0" />
                <span>
                  The Manager/Supervisor Agent coordinates multiple specialized agents in dependency
                  order.
                </span>
              </div>
              <div className="space-y-2 font-mono text-xs">
                <div className="rounded-lg border border-border p-3 bg-muted/20">
                  <p className="font-semibold text-foreground">
                    Step 1: Vision Screen Understanding
                  </p>
                  <p className="text-muted-foreground">
                    Agent: vision | Input: Active viewport bitmap & DOM stream
                  </p>
                </div>
                <div className="rounded-lg border border-border p-3 bg-muted/20">
                  <p className="font-semibold text-foreground">Step 2: Fact & Entity Extraction</p>
                  <p className="text-muted-foreground">Agent: extractor | Input: $ref:step1.text</p>
                </div>
                <div className="rounded-lg border border-border p-3 bg-muted/20">
                  <p className="font-semibold text-foreground">
                    Step 3: Verification & Grounding Scan
                  </p>
                  <p className="text-muted-foreground">
                    Agent: verifier | Checks: groundedness, safety, approvals
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card3D>
    </div>
  );
}
