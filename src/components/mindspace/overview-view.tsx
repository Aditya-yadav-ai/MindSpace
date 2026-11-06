import * as React from "react";
import {
  Activity,
  ArrowRight,
  BookOpen,
  Camera,
  CheckCircle2,
  Clock,
  Cpu,
  ExternalLink,
  Layers,
  Link2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button3D } from "@/components/ui/button-3d";
import { Card3D, Card3DContent, Card3DHeader, Card3DTitle } from "@/components/ui/card-3d";
import { AIOrb } from "@/components/mindspace/ai-orb";
import type { MindSpaceView } from "@/components/mindspace/nav-items";
import type { PageContext } from "@/components/mindspace/page-context";

export function OverviewView({
  name,
  context,
  onNavigate,
  onCapture,
}: {
  name: string;
  context: PageContext;
  onNavigate: (view: MindSpaceView) => void;
  onCapture?: () => void;
}) {
  const [orbState, setOrbState] = React.useState<"idle" | "thinking" | "capturing">("idle");

  const handleCaptureClick = () => {
    setOrbState("capturing");
    setTimeout(() => {
      setOrbState("idle");
      if (onCapture) {
        onCapture();
      } else {
        onNavigate("capture");
      }
    }, 800);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Hero 3D Card with AI Orb */}
      <Card3D
        glow
        className="relative overflow-hidden bg-gradient-to-br from-card via-card to-primary/5 p-6 sm:p-8"
      >
        <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
          <AIOrb
            size="lg"
            state={orbState}
            label={orbState === "capturing" ? "Capturing screen..." : "AI Manager Ready"}
            onClick={handleCaptureClick}
          />
          <div className="flex-1 space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Sparkles className="size-3.5" />
              <span>Next-Gen Agentic Browser Assistant</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Good day, {name || "Researcher"}
            </h1>
            <p className="max-w-xl text-sm text-muted-foreground">
              MindSpace connects what you see on screen with 18 specialist agents, Google Workspace
              integrations, and strict human-in-the-loop security.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2 sm:justify-start">
              <Button3D variant="primary" onClick={handleCaptureClick} className="gap-2">
                <Camera className="size-4" />
                <span>Capture Active Screen</span>
              </Button3D>
              <Button3D variant="secondary" onClick={() => onNavigate("workspace")}>
                <BookOpen className="size-4" />
                <span>Open Workspace</span>
              </Button3D>
            </div>
          </div>
        </div>
      </Card3D>

      {/* Metrics & Status Grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card3D interactive onClick={() => onNavigate("capture")} className="p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Screen Context</span>
            <Camera className="size-4 text-primary" />
          </div>
          <div className="mt-3">
            <div className="truncate text-lg font-bold text-foreground">
              {context.title ? context.title.slice(0, 22) + "..." : "No Page Attached"}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {context.domain || "Click to capture tab"}
            </p>
          </div>
        </Card3D>

        <Card3D interactive onClick={() => onNavigate("agents")} className="p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Specialists</span>
            <Cpu className="size-4 text-indigo-500" />
          </div>
          <div className="mt-3">
            <div className="text-lg font-bold text-foreground">18 Agents</div>
            <p className="text-xs text-muted-foreground">Supervisor & Workers online</p>
          </div>
        </Card3D>

        <Card3D interactive onClick={() => onNavigate("approvals")} className="p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Safety Gate</span>
            <ShieldCheck className="size-4 text-emerald-500" />
          </div>
          <div className="mt-3">
            <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
              0 Pending
            </div>
            <p className="text-xs text-muted-foreground">Human confirmation active</p>
          </div>
        </Card3D>

        <Card3D interactive onClick={() => onNavigate("accounts")} className="p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">Connected</span>
            <Link2 className="size-4 text-blue-500" />
          </div>
          <div className="mt-3">
            <div className="text-lg font-bold text-foreground">10 Services</div>
            <p className="text-xs text-muted-foreground">Google Workspace ready</p>
          </div>
        </Card3D>
      </div>

      {/* Suggested Quick Workflows */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Recommended One-Click Actions
          </h2>
          <span className="text-xs text-primary font-medium">Vision-Assisted</span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card3D
            interactive
            onClick={() => onNavigate("agents")}
            className="p-4 hover:border-primary/50"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                <Sparkles className="size-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">Executive Summary</h3>
                <p className="text-xs text-muted-foreground">
                  Grounded multi-agent synthesis with source citation checks.
                </p>
              </div>
            </div>
          </Card3D>

          <Card3D
            interactive
            onClick={() => onNavigate("capture")}
            className="p-4 hover:border-primary/50"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-indigo-500/10 p-2.5 text-indigo-500">
                <Layers className="size-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">Extract Entities & Dates</h3>
                <p className="text-xs text-muted-foreground">
                  Pull action items, deadlines, amounts, and URLs into a clean sheet.
                </p>
              </div>
            </div>
          </Card3D>

          <Card3D
            interactive
            onClick={() => onNavigate("workspace")}
            className="p-4 hover:border-primary/50"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-violet-500/10 p-2.5 text-violet-500">
                <BookOpen className="size-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">Research & Writing Studio</h3>
                <p className="text-xs text-muted-foreground">
                  Transform insights into briefs, emails, and documentation.
                </p>
              </div>
            </div>
          </Card3D>
        </div>
      </div>

      {/* Security & Multi-Agent Architecture Notice */}
      <Card3D className="border-border/60 bg-muted/30 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-background border border-border/80 text-foreground shadow-sm">
              <ShieldCheck className="size-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                Grounded Architecture & Human Authorization
              </p>
              <p className="text-xs text-muted-foreground">
                Consequential external tool writes (calendar invites, email drafts, file edits)
                require explicit user confirmation before execution.
              </p>
            </div>
          </div>
          <Button3D
            variant="outline"
            size="sm"
            onClick={() => onNavigate("approvals")}
            className="shrink-0 gap-1.5"
          >
            <span>View Approvals</span>
            <ArrowRight className="size-3.5" />
          </Button3D>
        </div>
      </Card3D>
    </div>
  );
}
