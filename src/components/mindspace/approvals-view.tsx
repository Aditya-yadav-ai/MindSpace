import * as React from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  FileEdit,
  History,
  Lock,
  Mail,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button3D } from "@/components/ui/button-3d";
import { Card3D, Card3DContent, Card3DHeader, Card3DTitle } from "@/components/ui/card-3d";

export interface PendingAction {
  id: string;
  tool: string;
  agent: string;
  description: string;
  risk: "consequential" | "medium" | "low";
  payload: Record<string, string>;
  requestedAt: string;
}

export function ApprovalsView({
  onApproveAction,
}: {
  onApproveAction?: (actionId: string) => void;
}) {
  const [pendingActions, setPendingActions] = React.useState<PendingAction[]>([
    {
      id: "appr_cal_01",
      tool: "google.create_calendar_event",
      agent: "calendar",
      description: "Create meeting 'Stage 8 Technical Review' on user's primary calendar",
      risk: "consequential",
      payload: {
        summary: "Stage 8 Technical Review",
        start: "2026-11-20T10:00:00Z",
        end: "2026-11-20T11:00:00Z",
        attendees: "team@mindspace.local",
      },
      requestedAt: "Just now",
    },
    {
      id: "appr_mail_02",
      tool: "google.create_email_draft",
      agent: "gmail",
      description: "Draft research summary email to stakeholders",
      risk: "medium",
      payload: {
        to: "advisors@university.edu",
        subject: "MindSpace Agentic Browser Assistant Progress Brief",
        snippet: "Summary of multimodal screenshot evaluation and Mann-Whitney U test results...",
      },
      requestedAt: "5 minutes ago",
    },
  ]);

  const [auditLog, setAuditLog] = React.useState<
    Array<{ id: string; action: string; verdict: "approved" | "rejected"; time: string }>
  >([
    {
      id: "hist_01",
      action: "google.create_document (MindSpace Executive Brief)",
      verdict: "approved",
      time: "2 hours ago",
    },
    {
      id: "hist_02",
      action: "tasks.delete (Clean up scratch reminders)",
      verdict: "rejected",
      time: "Yesterday",
    },
  ]);

  const handleApprove = (id: string) => {
    const action = pendingActions.find((a) => a.id === id);
    if (!action) return;

    setPendingActions((prev) => prev.filter((a) => a.id !== id));
    setAuditLog((prev) => [
      {
        id: `hist_${Date.now()}`,
        action: action.description,
        verdict: "approved",
        time: "Just now",
      },
      ...prev,
    ]);
    if (onApproveAction) {
      onApproveAction(action.tool);
    }
  };

  const handleReject = (id: string) => {
    const action = pendingActions.find((a) => a.id === id);
    if (!action) return;

    setPendingActions((prev) => prev.filter((a) => a.id !== id));
    setAuditLog((prev) => [
      {
        id: `hist_${Date.now()}`,
        action: action.description,
        verdict: "rejected",
        time: "Just now",
      },
      ...prev,
    ]);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="rounded-xl bg-emerald-500/10 p-2 text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Human-in-the-Loop Approvals
            </h1>
            <p className="text-xs text-muted-foreground">
              Every consequential write to external accounts requires explicit authorization
            </p>
          </div>
        </div>
      </div>

      {/* Security Rule Card */}
      <Card3D className="border-emerald-500/30 bg-emerald-500/5 p-4">
        <div className="flex items-start gap-3">
          <Lock className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs">
            <p className="font-semibold text-emerald-900 dark:text-emerald-200">
              Zero Unauthorized External Mutations
            </p>
            <p className="text-emerald-700 dark:text-emerald-300">
              MindSpace agents are strictly gated at the ToolRegistry layer. Read operations execute
              autonomously, but writing emails, scheduling events, modifying files, or persisting
              tasks remain paused until you click Approve.
            </p>
          </div>
        </div>
      </Card3D>

      {/* Pending Queue */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Pending Approval Requests ({pendingActions.length})
          </h2>
        </div>

        {pendingActions.length === 0 ? (
          <Card3D className="p-8 text-center">
            <CheckCircle2 className="mx-auto size-8 text-emerald-500" />
            <h3 className="mt-2 text-sm font-semibold text-foreground">Queue is Clear</h3>
            <p className="text-xs text-muted-foreground">
              No autonomous agent is waiting on human authorization.
            </p>
          </Card3D>
        ) : (
          <div className="space-y-3">
            {pendingActions.map((action) => (
              <Card3D key={action.id} glow className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                        {action.risk} write
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        agent:{action.agent}
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-foreground">{action.description}</h3>
                    <p className="font-mono text-xs text-primary">{action.tool}</p>
                  </div>
                  <span className="text-[11px] text-muted-foreground">{action.requestedAt}</span>
                </div>

                {/* Parameters Preview */}
                <div className="rounded-lg border border-border/80 bg-muted/40 p-3 font-mono text-[11px] text-muted-foreground space-y-1">
                  {Object.entries(action.payload).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <span className="text-foreground/80 font-semibold">{k}:</span>
                      <span className="truncate">{v}</span>
                    </div>
                  ))}
                </div>

                {/* Approval Actions */}
                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button3D
                    variant="ghost"
                    size="sm"
                    onClick={() => handleReject(action.id)}
                    className="text-destructive hover:bg-destructive/10"
                  >
                    <XCircle className="size-4" />
                    <span>Reject</span>
                  </Button3D>
                  <Button3D
                    variant="primary"
                    size="sm"
                    onClick={() => handleApprove(action.id)}
                    className="gap-1.5"
                  >
                    <CheckCircle2 className="size-4" />
                    <span>Approve & Execute</span>
                  </Button3D>
                </div>
              </Card3D>
            ))}
          </div>
        )}
      </div>

      {/* Audit History */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <History className="size-4" />
          <span>Recent Decision History</span>
        </h2>
        <Card3D className="divide-y divide-border/60">
          {auditLog.map((log) => (
            <div key={log.id} className="flex items-center justify-between p-3.5 text-xs">
              <div className="flex items-center gap-2.5">
                {log.verdict === "approved" ? (
                  <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                ) : (
                  <XCircle className="size-4 text-rose-500 shrink-0" />
                )}
                <span className="font-medium text-foreground">{log.action}</span>
              </div>
              <span className="text-muted-foreground font-mono">{log.time}</span>
            </div>
          ))}
        </Card3D>
      </div>
    </div>
  );
}
