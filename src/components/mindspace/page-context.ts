import { useCallback, useEffect, useState } from "react";

export type PageContext = {
  title: string;
  url: string;
  selection: string;
  text: string;
};

export const emptyPageContext: PageContext = { title: "", url: "", selection: "", text: "" };

const STORAGE_KEY = "mindspace.page-context.v1";
const SCREENSHOT_STORAGE_KEY = "mindspace.captured-screenshot.v1";
const CAPTURE_STATUS_STORAGE_KEY = "mindspace.capture-status.v1";

type StorageChange = { newValue?: unknown };

type ExtensionChromeApi = {
  tabs?: {
    query: (query: { active: boolean; lastFocusedWindow: boolean }) => Promise<Array<{ id?: number }>>;
  };
  scripting?: {
    executeScript: (options: {
      target: { tabId: number };
      func: () => PageContext;
    }) => Promise<Array<{ result?: PageContext }>>;
  };
  storage?: {
    session?: {
      get: (keys: string | string[]) => Promise<Record<string, unknown>>;
      remove: (keys: string | string[]) => Promise<void>;
    };
    onChanged?: {
      addListener: (
        listener: (changes: Record<string, StorageChange>, areaName: string) => void,
      ) => void;
      removeListener: (
        listener: (changes: Record<string, StorageChange>, areaName: string) => void,
      ) => void;
    };
  };
};

function getExtensionChromeApi() {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { chrome?: ExtensionChromeApi }).chrome;
}

/** True when running inside the packaged Chrome extension side panel. */
export function hasExtensionBridge() {
  const chromeApi = getExtensionChromeApi();
  return Boolean(chromeApi?.tabs && chromeApi?.scripting);
}

export function usePageContext() {
  const [context, setContext] = useState<PageContext>(emptyPageContext);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [captureStatus, setCaptureStatus] = useState<string | null>(null);
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
    const storage = getExtensionChromeApi()?.storage;
    if (!storage?.session) return;

    let cancelled = false;
    void storage.session
      .get([SCREENSHOT_STORAGE_KEY, CAPTURE_STATUS_STORAGE_KEY])
      .then((items) => {
        if (!cancelled) {
          const value = items[SCREENSHOT_STORAGE_KEY];
          setScreenshot(typeof value === "string" ? value : null);
          const status = items[CAPTURE_STATUS_STORAGE_KEY];
          setCaptureStatus(typeof status === "string" ? status : null);
        }
      })
      .catch(() => undefined);

    const onStorageChanged = (changes: Record<string, StorageChange>, areaName: string) => {
      if (areaName !== "session") return;
      if (SCREENSHOT_STORAGE_KEY in changes) {
        const value = changes[SCREENSHOT_STORAGE_KEY]?.newValue;
        setScreenshot(typeof value === "string" ? value : null);
      }
      if (CAPTURE_STATUS_STORAGE_KEY in changes) {
        const status = changes[CAPTURE_STATUS_STORAGE_KEY]?.newValue;
        setCaptureStatus(typeof status === "string" ? status : null);
      }
    };
    storage.onChanged?.addListener(onStorageChanged);

    return () => {
      cancelled = true;
      storage.onChanged?.removeListener(onStorageChanged);
    };
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const chromeApi = getExtensionChromeApi();
    if (!chromeApi?.tabs || !chromeApi.scripting) return;

    let cancelled = false;
    async function captureActiveTab() {
      try {
        const [tab] = await chromeApi.tabs!.query({ active: true, lastFocusedWindow: true });
        if (tab?.id == null) return;
        const [injected] = await chromeApi.scripting!.executeScript({
          target: { tabId: tab.id },
          func: () => ({
            title: document.title,
            url: window.location.href,
            selection: String(window.getSelection() ?? "").trim(),
            text:
              (document.querySelector("main") ?? document.body)?.innerText?.slice(0, 30000) ?? "",
          }),
        });
        if (!cancelled && injected?.result) setContext(injected.result);
      } catch {
        // Some browser pages do not allow extension script injection.
      }
    }

    void captureActiveTab();
    return () => {
      cancelled = true;
    };
  }, [hydrated]);

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

  const clear = useCallback(() => {
    setContext(emptyPageContext);
    setScreenshot(null);
    setCaptureStatus(null);
    void getExtensionChromeApi()?.storage?.session?.remove([
      SCREENSHOT_STORAGE_KEY,
      CAPTURE_STATUS_STORAGE_KEY,
    ]);
  }, []);

  /** Capture the reader's current selection inside this panel. */
  const captureSelection = useCallback(() => {
    const value = typeof window === "undefined" ? "" : String(window.getSelection() ?? "").trim();
    if (value) update({ selection: value });
    return value;
  }, [update]);

  const hasContent = Boolean(context.text.trim() || context.selection.trim() || screenshot);
  const wordCount = context.text.trim() ? context.text.trim().split(/\s+/).length : 0;

  return {
    context,
    update,
    clear,
    captureSelection,
    hasContent,
    wordCount,
    hydrated,
    screenshot,
    captureStatus,
  };
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
