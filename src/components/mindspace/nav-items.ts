import {
  Activity,
  BarChart3,
  Bell,
  Bookmark,
  BookOpen,
  Camera,
  Clock3,
  Home,
  LayoutDashboard,
  Link2,
  ListTodo,
  PenLine,
  Repeat,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Navigation model for the next-generation MindSpace AI browser assistant.
 *
 * Core destinations:
 * 1. Overview (Dashboard, screen preview, status)
 * 2. Current Capture (Screenshot understanding, detected tasks)
 * 3. Agent Activity (Multi-agent supervisor & worker traces)
 * 4. Saved Pages (Saved research collections)
 * 5. Task History (Execution history)
 * 6. My Workspace (Notes, RAG Knowledge Base, Writing Studio)
 * 7. Automations (Recurring workflows)
 * 8. Approvals (Human-in-the-loop gates for consequential actions)
 * 9. Notifications (System alerts & task completions)
 * 10. Connected Accounts (Google Workspace & external services)
 * 11. Observability (OpenTelemetry traces & metrics)
 * 12. Settings (Theme & preferences)
 *
 * All legacy view IDs are retained as aliases for full backward compatibility.
 */

export type MindSpaceView =
  | "overview"
  | "capture"
  | "agents"
  | "saved"
  | "history"
  | "workspace"
  | "automations"
  | "approvals"
  | "notifications"
  | "accounts"
  | "observability"
  | "settings"
  // Legacy aliases
  | "home"
  | "collections"
  | "ask"
  | "research"
  | "knowledge"
  | "writing"
  | "sessions"
  | "tasks";

export type NavEntry = {
  id: MindSpaceView;
  label: string;
  icon: LucideIcon;
  badge?: string;
  group?: "core" | "system";
};

export const PRIMARY_NAV: NavEntry[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, group: "core" },
  { id: "capture", label: "Current Capture", icon: Camera, group: "core" },
  { id: "agents", label: "Agent Activity", icon: Activity, group: "core" },
  { id: "saved", label: "Saved Pages", icon: Bookmark, group: "core" },
  { id: "history", label: "Task History", icon: Clock3, group: "core" },
  { id: "workspace", label: "My Workspace", icon: BookOpen, group: "core" },
  { id: "automations", label: "Automations", icon: Repeat, group: "core" },
];

export const SECONDARY_NAV: NavEntry[] = [
  { id: "approvals", label: "Approvals", icon: ShieldCheck, group: "system" },
  { id: "notifications", label: "Notifications", icon: Bell, group: "system" },
  { id: "accounts", label: "Connected Accounts", icon: Link2, group: "system" },
  { id: "observability", label: "Observability", icon: BarChart3, group: "system" },
  { id: "settings", label: "Settings", icon: Settings2, group: "system" },
];

export const ALL_NAV_ITEMS: NavEntry[] = [...PRIMARY_NAV, ...SECONDARY_NAV];

export const VIEW_LABELS: Record<MindSpaceView, string> = {
  overview: "Overview",
  home: "Overview",
  capture: "Current Capture",
  agents: "Agent Activity",
  saved: "Saved Pages",
  collections: "Saved Pages",
  history: "Task History",
  sessions: "Task History",
  workspace: "My Workspace",
  knowledge: "My Workspace",
  research: "My Workspace",
  writing: "Writing Studio",
  ask: "Ask MindSpace",
  automations: "Automations",
  approvals: "Approvals",
  notifications: "Notifications",
  accounts: "Connected Accounts",
  observability: "Observability",
  tasks: "Task History",
  settings: "Settings",
};
