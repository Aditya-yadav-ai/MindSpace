import * as React from "react";
import { cn } from "@/lib/utils";

export interface Card3DProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  glow?: boolean;
}

export const Card3D = React.forwardRef<HTMLDivElement, Card3DProps>(
  ({ className, interactive = false, glow = false, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-2xl border border-border/80 bg-card text-card-foreground transition-all duration-200",
          "shadow-[0_2px_8px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.7)] dark:shadow-[0_2px_8px_rgba(0,0,0,0.2),0_8px_24px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.06)]",
          interactive &&
            "hover:-translate-y-1 hover:shadow-[0_6px_20px_rgba(0,0,0,0.08),0_16px_36px_rgba(79,70,229,0.12),inset_0_1px_0_rgba(255,255,255,0.9)] hover:border-primary/40 cursor-pointer",
          glow &&
            "relative after:absolute after:-inset-px after:rounded-2xl after:bg-gradient-to-r after:from-primary/20 after:via-accent/10 after:to-primary/20 after:-z-10 after:blur-sm",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);
Card3D.displayName = "Card3D";

export const Card3DHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-5 pb-3", className)} {...props} />
  ),
);
Card3DHeader.displayName = "Card3DHeader";

export const Card3DTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("text-base font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
Card3DTitle.displayName = "Card3DTitle";

export const Card3DDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-xs text-muted-foreground", className)} {...props} />
));
Card3DDescription.displayName = "Card3DDescription";

export const Card3DContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-5 pt-0", className)} {...props} />
  ),
);
Card3DContent.displayName = "Card3DContent";

export const Card3DFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-5 pt-0", className)} {...props} />
  ),
);
Card3DFooter.displayName = "Card3DFooter";
