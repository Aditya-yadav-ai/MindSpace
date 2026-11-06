import * as React from "react";
import { cn } from "@/lib/utils";
import { Sparkles, Loader2, CheckCircle2, AlertCircle, Camera } from "lucide-react";

export type AIOrbState = "idle" | "capturing" | "thinking" | "executing" | "success" | "error";

export interface AIOrbProps {
  state?: AIOrbState;
  size?: "sm" | "md" | "lg";
  label?: string;
  className?: string;
  onClick?: () => void;
}

export function AIOrb({ state = "idle", size = "md", label, className, onClick }: AIOrbProps) {
  const sizeClasses = {
    sm: "w-10 h-10",
    md: "w-16 h-16",
    lg: "w-24 h-24",
  };

  const ringSizes = {
    sm: "w-14 h-14",
    md: "w-24 h-24",
    lg: "w-36 h-36",
  };

  const getGradient = () => {
    switch (state) {
      case "capturing":
        return "from-amber-400 via-rose-500 to-indigo-600";
      case "thinking":
        return "from-indigo-500 via-purple-500 to-pink-500";
      case "executing":
        return "from-blue-500 via-cyan-400 to-emerald-500";
      case "success":
        return "from-emerald-400 via-teal-500 to-green-600";
      case "error":
        return "from-rose-500 via-red-600 to-orange-500";
      case "idle":
      default:
        return "from-indigo-500 via-blue-500 to-violet-600";
    }
  };

  const getIcon = () => {
    switch (state) {
      case "capturing":
        return <Camera className="w-1/2 h-1/2 text-white animate-pulse" />;
      case "thinking":
        return <Loader2 className="w-1/2 h-1/2 text-white animate-spin" />;
      case "executing":
        return <Sparkles className="w-1/2 h-1/2 text-white animate-bounce" />;
      case "success":
        return <CheckCircle2 className="w-1/2 h-1/2 text-white" />;
      case "error":
        return <AlertCircle className="w-1/2 h-1/2 text-white" />;
      case "idle":
      default:
        return <Sparkles className="w-1/2 h-1/2 text-white/90" />;
    }
  };

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center select-none group",
        onClick && "cursor-pointer",
        className,
      )}
      onClick={onClick}
    >
      {/* Outer ambient glow & pulse rings */}
      <div
        className={cn(
          "absolute rounded-full transition-all duration-700 pointer-events-none opacity-40 blur-xl",
          ringSizes[size],
          `bg-gradient-to-tr ${getGradient()}`,
          state === "thinking" && "animate-pulse scale-125 opacity-70",
          state === "capturing" && "scale-110 opacity-60",
        )}
      />

      {/* Orbit ring (visible when active) */}
      {(state === "thinking" || state === "executing") && (
        <div
          className={cn(
            "absolute rounded-full border border-dashed border-primary/40 animate-spin pointer-events-none",
            ringSizes[size],
          )}
          style={{ animationDuration: "12s" }}
        />
      )}

      {/* Main 3D Sphere */}
      <div
        className={cn(
          "relative rounded-full flex items-center justify-center shadow-lg transition-transform duration-300",
          sizeClasses[size],
          `bg-gradient-to-br ${getGradient()}`,
          "shadow-[0_8px_20px_rgba(79,70,229,0.3),inset_0_2px_4px_rgba(255,255,255,0.6),inset_0_-4px_8px_rgba(0,0,0,0.25)]",
          onClick && "group-hover:scale-105 active:scale-95",
        )}
      >
        {/* Specular highlight */}
        <div className="absolute top-1 left-2 w-1/3 h-1/3 rounded-full bg-gradient-to-b from-white/70 to-transparent pointer-events-none" />

        {/* Center state icon */}
        <div className="relative z-10 flex items-center justify-center">{getIcon()}</div>
      </div>

      {/* State / Activity Label */}
      {label && (
        <span className="mt-2 text-xs font-medium text-muted-foreground tracking-wide flex items-center gap-1.5">
          {state === "thinking" && (
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
          )}
          {state === "capturing" && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          )}
          {state === "executing" && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce" />
          )}
          {label}
        </span>
      )}
    </div>
  );
}
