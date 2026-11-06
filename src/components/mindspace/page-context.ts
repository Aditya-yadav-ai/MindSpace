import { useCallback, useEffect, useState } from "react";

export type PageContext = {
  title: string;
  url: string;
  selection: string;
  text: string;
};

export const emptyPageContext: PageContext = { title: "", url: "", selection: "", text: "" };

const STORAGE_KEY = "mindspace.page-context.v1";
const SAVED_PAGES_KEY = "mindspace.saved-pages.v1";

/**
 * True when the page can reach the browser tab APIs. This is only a
 * capability check used for honest UI copy: MindSpace does not currently
 * ship a content script, so no page text arrives automatically even when
 * the APIs are present.
 */
export function canAccessBrowserTabs() {
  if (typeof window === "undefined") return false;
  const chromeApi = (window as unknown as { chrome?: { tabs?: unknown } }).chrome;
  return Boolean(chromeApi?.tabs);
}

/** Human-readable hostname for a URL, or "" when the value is not a URL. */
export function domainOf(url: string) {
  const value = url.trim();
  if (!value) return "";
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
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

    if (typeof chrome !== "undefined" && chrome?.storage?.local) {
      chrome.storage.local.get(["lastCapture", "lastScreenshotCapture"], (items) => {
        if (chrome.runtime?.lastError) return;
        if (items?.lastCapture) {
          const cap = items.lastCapture as Partial<PageContext>;
          setContext((current) => ({
            ...current,
            title: cap.title || current.title,
            url: cap.url || current.url,
            text: cap.text || current.text,
            selection: cap.selection || current.selection,
          }));
        } else if (items?.lastScreenshotCapture) {
          const sc = items.lastScreenshotCapture as {
            title?: string;
            url?: string;
            textContext?: Partial<PageContext>;
          };
          setContext((current) => ({
            ...current,
            title: sc.title || current.title,
            url: sc.url || current.url,
            text: sc.textContext?.text || current.text,
            selection: sc.textContext?.selection || current.selection,
          }));
        }
      });

      const messageListener = (message: {
        type?: string;
        payload?: { data?: { title?: string; url?: string; textContext?: Partial<PageContext> } };
      }) => {
        if (message?.type === "MINDSPACE_SCREENSHOT_CAPTURED" && message.payload?.data) {
          const cap = message.payload.data;
          setContext((current) => ({
            ...current,
            title: cap.title || current.title,
            url: cap.url || current.url,
            text: cap.textContext?.text || current.text,
            selection: cap.textContext?.selection || current.selection,
          }));
        }
      };

      chrome.runtime?.onMessage?.addListener(messageListener);
      setHydrated(true);
      return () => {
        chrome.runtime?.onMessage?.removeListener(messageListener);
      };
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

/* ------------------------------------------------------------------------- *
 * Saved pages — device-local only.
 *
 * There is no saved-pages table in this project, so saving is deliberately
 * scoped to this browser profile via localStorage. The UI labels it as such
 * and never implies account sync.
 * ------------------------------------------------------------------------- */

export type SavedPageRecord = {
  id: string;
  title: string;
  url: string;
  domain: string;
  savedAt: string;
  wordCount: number;
};

function isSavedPageRecord(value: unknown): value is SavedPageRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["id"] === "string" &&
    typeof record["title"] === "string" &&
    typeof record["url"] === "string" &&
    typeof record["savedAt"] === "string"
  );
}

export function readSavedPages(): SavedPageRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SAVED_PAGES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedPageRecord).map((record) => ({
      ...record,
      domain: record.domain || domainOf(record.url),
      wordCount: Number.isFinite(record.wordCount) ? record.wordCount : 0,
    }));
  } catch {
    return [];
  }
}

function persistSavedPages(items: SavedPageRecord[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SAVED_PAGES_KEY, JSON.stringify(items));
  } catch {
    /* ignore full storage — saving is a convenience, not a requirement */
  }
}

export function useSavedPages() {
  const [items, setItems] = useState<SavedPageRecord[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setItems(readSavedPages());
    setHydrated(true);
  }, []);

  const commit = useCallback((next: SavedPageRecord[]) => {
    setItems(next);
    persistSavedPages(next);
  }, []);

  /** Saves (or refreshes) the current page. Returns whether it already existed. */
  const add = useCallback(
    (page: PageContext, wordCount: number) => {
      const title = page.title.trim() || domainOf(page.url) || "Untitled page";
      const url = page.url.trim();
      const key = url || title;
      let existed = false;
      const current = readSavedPages();
      const next = current.map((record) => {
        const recordKey = record.url.trim() || record.title;
        if (recordKey !== key) return record;
        existed = true;
        return {
          ...record,
          title,
          url,
          domain: domainOf(url),
          savedAt: new Date().toISOString(),
          wordCount,
        };
      });
      if (!existed) {
        next.unshift({
          id: `page_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          title,
          url,
          domain: domainOf(url),
          savedAt: new Date().toISOString(),
          wordCount,
        });
      }
      commit(next);
      return { existed, id: next.find((record) => (record.url || record.title) === key)?.id ?? "" };
    },
    [commit],
  );

  const remove = useCallback(
    (id: string) => commit(readSavedPages().filter((record) => record.id !== id)),
    [commit],
  );

  const clear = useCallback(() => commit([]), [commit]);

  /** True when this exact page (URL, or title when there is no URL) is stored. */
  const isSaved = useCallback(
    (page: PageContext) => {
      const title = page.title.trim() || domainOf(page.url) || "Untitled page";
      const key = page.url.trim() || title;
      return items.some((record) => (record.url.trim() || record.title) === key);
    },
    [items],
  );

  return { items, hydrated, add, remove, clear, isSaved };
}
