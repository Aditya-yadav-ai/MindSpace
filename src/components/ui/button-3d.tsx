import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const button3dVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold cursor-pointer transition-all duration-200 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:translate-y-0.5",
  {
    variants: {
      variant: {
        primary:
          "bg-gradient-to-b from-primary to-primary/95 text-primary-foreground shadow-[0_2px_4px_rgba(0,0,0,0.06),0_4px_12px_rgba(79,70,229,0.25),inset_0_1px_0_rgba(255,255,255,0.25)] hover:shadow-[0_4px_16px_rgba(79,70,229,0.35),inset_0_1px_0_rgba(255,255,255,0.3)] hover:-translate-y-0.5 active:shadow-[0_1px_2px_rgba(0,0,0,0.1),inset_0_2px_4px_rgba(0,0,0,0.2)]",
        secondary:
          "bg-card text-foreground border border-border/80 shadow-[0_2px_6px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.6)] hover:bg-accent hover:border-border hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 active:shadow-[inset_0_1px_3px_rgba(0,0,0,0.08)]",
        glass:
          "bg-white/80 dark:bg-card/80 backdrop-blur-md text-foreground border border-white/60 dark:border-white/10 shadow-[0_4px_16px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.8)] hover:bg-white/95 dark:hover:bg-card/95 hover:shadow-[0_6px_20px_rgba(0,0,0,0.1)] hover:-translate-y-0.5 active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]",
        outline:
          "border-2 border-border bg-transparent text-foreground shadow-sm hover:border-primary/50 hover:bg-primary/5 hover:-translate-y-0.5 active:translate-y-0",
        destructive:
          "bg-gradient-to-b from-destructive to-destructive/95 text-destructive-foreground shadow-[0_2px_4px_rgba(0,0,0,0.08),0_4px_12px_rgba(239,68,68,0.25),inset_0_1px_0_rgba(255,255,255,0.2)] hover:shadow-[0_4px_16px_rgba(239,68,68,0.35)] hover:-translate-y-0.5 active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]",
        ghost: "hover:bg-accent/80 hover:text-accent-foreground active:bg-accent rounded-lg",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-11 rounded-xl px-6 text-base",
        icon: "h-9 w-9 rounded-xl",
        "icon-sm": "h-8 w-8 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

export interface Button3DProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button3dVariants> {
  asChild?: boolean;
}

const Button3D = React.forwardRef<HTMLButtonElement, Button3DProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(button3dVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button3D.displayName = "Button3D";

export { Button3D, button3dVariants };
