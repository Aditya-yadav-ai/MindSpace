import * as React from "react";
import {
  Bell,
  CheckCircle2,
  Clock,
  ExternalLink,
  Info,
  ShieldAlert,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button3D } from "@/components/ui/button-3d";
import { Card3D } from "@/components/ui/card-3d";

export interface NotificationItem {
  id: string;
  type: "success" | "warning" | "info" | "security";
  title: string;
  detail: string;
  timestamp: string;
  read: boolean;
}

export function NotificationsView() {
  const [notifications, setNotifications] = React.useState<NotificationItem[]>([
    {
      id: "notif_01",
      type: "success",
      title: "Multimodal Screen Analysis Completed",
      detail:
        "Vision Agent successfully identified layout 'workspace_document' and extracted 6 entities.",
      timestamp: "2 mins ago",
      read: false,
    },
    {
      id: "notif_02",
      type: "security",
      title: "Untrusted Content Sanitized",
      detail:
        "Prompt injection scanner inspected active webpage DOM. Null bytes stripped and text capped within 60,000 char quota.",
      timestamp: "15 mins ago",
      read: false,
    },
    {
      id: "notif_03",
      type: "info",
      title: "Google Workspace Registry Initialized",
      detail:
        "10 Google services registered with granular OAuth scopes and token refresh handlers.",
      timestamp: "1 hour ago",
      read: true,
    },
    {
      id: "notif_04",
      type: "success",
      title: "255 Automated Tests Passing",
      detail:
        "All unit, integration, and security verification tests validated with zero failures.",
      timestamp: "3 hours ago",
      read: true,
    },
  ]);

  const markAllAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const clearAll = () => {
    setNotifications([]);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="rounded-xl bg-primary/10 p-2 text-primary">
            <Bell className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Notifications</h1>
            <p className="text-xs text-muted-foreground">
              Autonomous agent activity, security alerts, and system updates
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button3D variant="secondary" size="sm" onClick={markAllAsRead}>
            Mark all read
          </Button3D>
          <Button3D variant="ghost" size="sm" onClick={clearAll}>
            <Trash2 className="size-4" />
          </Button3D>
        </div>
      </div>

      {/* List */}
      <div className="space-y-3">
        {notifications.length === 0 ? (
          <Card3D className="p-8 text-center text-muted-foreground">
            <Bell className="mx-auto size-8 opacity-40" />
            <p className="mt-2 text-sm font-semibold">No notifications</p>
          </Card3D>
        ) : (
          notifications.map((n) => (
            <Card3D
              key={n.id}
              className={`p-4 transition-all ${
                !n.read ? "border-l-4 border-l-primary bg-primary/[0.02]" : "opacity-85"
              }`}
            >
              <div className="flex items-start gap-3.5">
                <div className="mt-0.5 shrink-0">
                  {n.type === "success" && (
                    <div className="rounded-lg bg-emerald-500/10 p-1.5 text-emerald-500">
                      <CheckCircle2 className="size-4" />
                    </div>
                  )}
                  {n.type === "security" && (
                    <div className="rounded-lg bg-amber-500/10 p-1.5 text-amber-500">
                      <ShieldAlert className="size-4" />
                    </div>
                  )}
                  {n.type === "info" && (
                    <div className="rounded-lg bg-blue-500/10 p-1.5 text-blue-500">
                      <Info className="size-4" />
                    </div>
                  )}
                </div>

                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">{n.title}</h3>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {n.timestamp}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{n.detail}</p>
                </div>
              </div>
            </Card3D>
          ))
        )}
      </div>
    </div>
  );
}
