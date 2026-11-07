import {
  ChevronLeft,
  ChevronRight,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";

import {
  PRIMARY_NAV,
  SECONDARY_NAV,
  type MindSpaceView,
  type NavEntry,
} from "@/components/mindspace/nav-items";
import { cn } from "@/lib/utils";

export type SidebarUser = {
  name: string;
  email: string;
  initials: string;
  preview: boolean;
};

function isNavActive(currentView: MindSpaceView, itemId: MindSpaceView): boolean {
  if (currentView === itemId) return true;
  if (itemId === "overview" && currentView === "home") return true;
  if (itemId === "saved" && currentView === "collections") return true;
  if (
    itemId === "workspace" &&
    (currentView === "knowledge" ||
      currentView === "research" ||
      currentView === "writing" ||
      currentView === "ask")
  ) {
    return true;
  }
  if (itemId === "history" && (currentView === "sessions" || currentView === "tasks")) return true;
  return false;
}

export function SidebarNav({
  view,
  onSelect,
  user,
  onSignOut,
  onClose,
  collapsed = false,
  onToggleCollapse,
}: {
  view: MindSpaceView;
  onSelect: (view: MindSpaceView) => void;
  user: SidebarUser;
  onSignOut: () => void;
  onClose?: (() => void) | undefined;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-all duration-200 select-none",
        collapsed ? "w-16" : "w-[240px]",
      )}
    >
      {/* Brand Header */}
      <div
        className={cn(
          "flex items-center gap-3 pb-3 pt-4 border-b border-sidebar-border/60",
          collapsed ? "justify-center px-2" : "px-4",
        )}
      >
        <div
          onClick={() => onSelect("overview")}
          className="relative grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary via-indigo-600 to-violet-600 text-[15px] font-bold text-primary-foreground shadow-[0_2px_8px_rgba(79,70,229,0.35),inset_0_1px_0_rgba(255,255,255,0.3)] cursor-pointer hover:scale-105 transition-transform"
          title="MindSpace Overview"
        >
          <Sparkles className="size-4 text-white" />
        </div>

        {!collapsed && (
          <div className="min-w-0 leading-tight flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-[14px] font-bold tracking-tight text-sidebar-foreground">
                MindSpace
              </p>
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                AI 2030
              </span>
            </div>
            <p className="truncate text-[10.5px] text-muted-foreground">Autonomous Assistant</p>
          </div>
        )}

        {/* Collapse button on desktop */}
        {onToggleCollapse && !onClose && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden md:grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-3.5" />
            ) : (
              <PanelLeftClose className="size-3.5" />
            )}
          </button>
        )}

        {/* Close button on mobile */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="ml-auto grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground md:hidden"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Navigation Sections */}
      <nav
        aria-label="MindSpace"
        className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-2 py-2"
      >
        {!collapsed && (
          <p className="px-2.5 pb-1 pt-2 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/80 font-medium">
            Core Workspace
          </p>
        )}
        <ul className="space-y-0.5">
          {PRIMARY_NAV.map((item) => (
            <li key={item.id}>
              <NavButton
                item={item}
                active={isNavActive(view, item.id)}
                onSelect={onSelect}
                collapsed={collapsed}
              />
            </li>
          ))}
        </ul>

        {!collapsed && (
          <p className="px-2.5 pb-1 pt-4 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/80 font-medium">
            System &amp; Intelligence
          </p>
        )}
        {collapsed && <div className="my-2 border-t border-sidebar-border/60" />}
        <ul className="space-y-0.5">
          {SECONDARY_NAV.map((item) => (
            <li key={item.id}>
              <NavButton
                item={item}
                active={isNavActive(view, item.id)}
                onSelect={onSelect}
                collapsed={collapsed}
              />
            </li>
          ))}
        </ul>
      </nav>

      {/* User & Settings Footer */}
      <div
        className={cn(
          "border-t border-sidebar-border/80 p-2",
          collapsed && "flex flex-col items-center",
        )}
      >
        <button
          type="button"
          onClick={() => onSelect("settings")}
          title={user.name + (user.preview ? " (Preview)" : ` (${user.email})`)}
          className={cn(
            "flex items-center gap-2.5 rounded-xl text-left transition-all duration-150 hover:bg-sidebar-accent group",
            collapsed ? "size-10 justify-center p-0" : "w-full px-2 py-2",
          )}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-tr from-primary/20 to-violet-500/20 text-[11px] font-semibold uppercase text-sidebar-foreground ring-1 ring-border shadow-sm">
            {user.initials || "M"}
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[12px] font-semibold text-sidebar-foreground">
                  {user.name}
                </span>
                {user.preview ? (
                  <span className="flex items-center gap-1.5 truncate text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                    <span className="size-1.5 rounded-full bg-amber-500" />
                    Demo / Offline Mode
                  </span>
                ) : (
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {user.email}
                  </span>
                )}
              </span>
              <Settings2 className="size-3.5 shrink-0 text-muted-foreground group-hover:text-sidebar-foreground transition-colors" />
            </>
          )}
        </button>

        {!collapsed && (
          <button
            type="button"
            onClick={onSignOut}
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="size-3" />
            {user.preview ? "Exit preview" : "Sign out"}
          </button>
        )}
      </div>
    </div>
  );
}

function NavButton({
  item,
  active,
  onSelect,
  collapsed,
}: {
  item: NavEntry;
  active: boolean;
  onSelect: (view: MindSpaceView) => void;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "group relative flex items-center rounded-xl text-[12.5px] transition-all duration-150 select-none",
        collapsed ? "size-10 justify-center mx-auto" : "w-full gap-2.5 px-2.5 py-2",
        active
          ? "bg-primary/10 text-primary font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] dark:bg-primary/20 dark:text-primary-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground hover:translate-x-0.5",
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-primary"
        />
      )}
      <Icon
        aria-hidden="true"
        className={cn(
          "size-4 shrink-0 transition-colors",
          active
            ? "text-primary dark:text-primary-foreground"
            : "text-muted-foreground group-hover:text-sidebar-foreground",
        )}
      />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && item.badge && (
        <span className="ml-auto rounded-full bg-primary/15 px-1.5 py-0.2 text-[9.5px] font-bold text-primary">
          {item.badge}
        </span>
      )}
      {collapsed && item.badge && (
        <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
      )}
    </button>
  );
}
