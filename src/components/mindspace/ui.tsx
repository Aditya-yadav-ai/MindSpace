import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Shared presentational primitives for the MindSpace workspace.
 *
 * These exist so every view (workspace, writing, knowledge base, agent
 * activity, saved pages, sessions, settings) uses one card, one heading
 * rhythm and one status treatment instead of repeating utility soup.
 * They render nothing but markup — no data, no side effects.
 */

export type SurfaceTone = "neutral" | "accent" | "positive" | "caution" | "danger";

const TONE_CLASSES: Record<SurfaceTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  accent: "border-primary/20 bg-primary/10 text-primary",
  positive: "border-positive/25 bg-positive/10 text-positive",
  caution: "border-caution/30 bg-caution/10 text-caution",
  danger: "border-destructive/25 bg-destructive/10 text-destructive",
};

export function StatusPill({
  tone = "neutral",
  children,
  className,
}: {
  tone?: SurfaceTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ViewHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-primary">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-2 text-[26px] font-semibold leading-tight text-foreground">{title}</h1>
        {description && (
          <p className="mt-2 max-w-xl text-[13px] leading-6 text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SurfaceCard({
  children,
  className,
  muted = false,
}: {
  children: ReactNode;
  className?: string;
  muted?: boolean;
}) {
  return (
    <section className={cn(muted ? "surface-inset" : "surface-card", className)}>
      {children}
    </section>
  );
}

export function SectionHeading({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {Icon && (
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
            <Icon className="size-3.5" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold leading-6 text-foreground">{title}</h2>
          {description && (
            <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{description}</p>
          )}
        </div>
      </div>
      {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
    </div>
  );
}
