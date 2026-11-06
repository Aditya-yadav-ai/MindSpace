/**
 * MindSpace Theme Management (Requirement 4.4)
 * Supports persistent Light, Dark, and System preferences.
 * Persists in localStorage under `mindspace_theme`.
 */

import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "mindspace_theme";

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") {
      return saved;
    }
  } catch {
    // Ignore storage access errors
  }
  return "system";
}

export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme === "system") {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      return "dark";
    }
    return "light";
  }
  return theme;
}

export function applyTheme(theme: Theme): "light" | "dark" {
  const resolved = resolveTheme(theme);
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    if (resolved === "dark") {
      root.classList.add("dark");
      root.style.colorScheme = "dark";
    } else {
      root.classList.remove("dark");
      root.style.colorScheme = "light";
    }
  }
  return resolved;
}

export function setStoredTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Ignore
  }
  applyTheme(theme);
}

/**
 * React hook for theme state, reactivity, and persistence.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const current = getStoredTheme();
    setThemeState(current);
    const resolved = applyTheme(current);
    setResolvedTheme(resolved);

    // Watch system color scheme changes
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const active = getStoredTheme();
      if (active === "system") {
        const nextResolved = applyTheme("system");
        setResolvedTheme(nextResolved);
      }
    };

    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    setStoredTheme(next);
    setResolvedTheme(resolveTheme(next));
  };

  const toggleTheme = () => {
    // Toggle between light and dark directly for quick action
    const currentResolved = resolvedTheme;
    const next: Theme = currentResolved === "dark" ? "light" : "dark";
    setTheme(next);
  };

  return { theme, resolvedTheme, setTheme, toggleTheme };
}
