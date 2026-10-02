import { useCallback, useEffect, useState } from "react";

export type PageContext = {
  title: string;
  url: string;
  selection: string;
  text: string;
};

export const emptyPageContext: PageContext = { title: "", url: "", selection: "", text: "" };

const STORAGE_KEY = "mindspace.page-context.v1";

/** True when running inside the packaged Chrome extension side panel. */
export function hasExtensionBridge() {
  if (typeof window === "undefined") return false;
  const chromeApi = (window as unknown as { chrome?: { tabs?: unknown; scripting?: unknown } })
    .chrome;
  return Boolean(chromeApi?.tabs && chromeApi?.scripting);
}

export function usePageContext() {
  const [context, setContext] = useState<PageContext>(emptyPageContext);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setContext({ ...emptyPageContext, ...(JSON.parse(raw) as Partial<PageContext>) });
    } catch {
      /* ignore unreadable storage */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(context));
    } catch {
      /* ignore full storage */
    }
  }, [context, hydrated]);

  const update = useCallback((patch: Partial<PageContext>) => {
    setContext((current) => ({ ...current, ...patch }));
  }, []);

  const clear = useCallback(() => setContext(emptyPageContext), []);

  /** Capture the reader's current selection inside this panel. */
  const captureSelection = useCallback(() => {
    const value = typeof window === "undefined" ? "" : String(window.getSelection() ?? "").trim();
    if (value) update({ selection: value });
    return value;
  }, [update]);

  const hasContent = Boolean(context.text.trim() || context.selection.trim());
  const wordCount = context.text.trim() ? context.text.trim().split(/\s+/).length : 0;

  return { context, update, clear, captureSelection, hasContent, wordCount, hydrated };
}

export function pageContextPayload(context: PageContext) {
  const payload = {
    title: context.title.trim(),
    url: context.url.trim(),
    selection: context.selection.trim(),
    text: context.text.trim(),
  };
  return payload.title || payload.url || payload.selection || payload.text ? payload : null;
}

export function googleSearchUrl(query: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
