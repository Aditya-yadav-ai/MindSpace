/**
 * MindSpace Chrome Extension MV3 Type Definitions
 * Declares global 'chrome' namespace for browser extension contexts.
 */

declare namespace chrome {
  export namespace runtime {
    export interface MessageSender {
      id?: string;
      url?: string;
      tab?: chrome.tabs.Tab;
      frameId?: number;
    }

    export interface Port {
      name: string;
      disconnect(): void;
      postMessage(message: unknown): void;
      onDisconnect: Event<(port: Port) => void>;
      onMessage: Event<(message: unknown, port: Port) => void>;
      sender?: MessageSender;
    }

    export const id: string;
    export const lastError: { message?: string } | undefined;

    export function getURL(path: string): string;

    export function sendMessage<M = unknown, R = unknown>(
      message: M,
      responseCallback?: (response: R) => void,
    ): Promise<R>;

    export function sendMessage<M = unknown, R = unknown>(
      extensionId: string,
      message: M,
      responseCallback?: (response: R) => void,
    ): Promise<R>;

    export function connect(
      extensionId?: string,
      connectInfo?: { name?: string; includeTlsChannelId?: boolean },
    ): Port;

    export const onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean | void | Promise<unknown>,
      ): void;
      removeListener(
        callback: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean | void | Promise<unknown>,
      ): void;
      hasListener(callback: (...args: unknown[]) => unknown): boolean;
    };

    export const onConnect: {
      addListener(callback: (port: Port) => void): void;
      removeListener(callback: (port: Port) => void): void;
    };

    export const onInstalled: {
      addListener(callback: (details: { reason: string; previousVersion?: string }) => void): void;
    };
  }

  export namespace storage {
    export interface StorageArea {
      get(
        keys?: string | string[] | Record<string, unknown> | null,
        callback?: (items: { [key: string]: unknown }) => void,
      ): Promise<{ [key: string]: unknown }>;
      set(items: { [key: string]: unknown }, callback?: () => void): Promise<void>;
      remove(keys: string | string[], callback?: () => void): Promise<void>;
      clear(callback?: () => void): Promise<void>;
    }

    export const local: StorageArea;
    export const sync: StorageArea;
    export const session: StorageArea;

    export const onChanged: {
      addListener(
        callback: (
          changes: { [key: string]: { oldValue?: unknown; newValue?: unknown } },
          areaName: string,
        ) => void,
      ): void;
      removeListener(
        callback: (
          changes: { [key: string]: { oldValue?: unknown; newValue?: unknown } },
          areaName: string,
        ) => void,
      ): void;
    };
  }

  export namespace tabs {
    export interface Tab {
      id?: number;
      index: number;
      windowId: number;
      openerTabId?: number;
      selected: boolean;
      highlighted: boolean;
      active: boolean;
      pinned: boolean;
      audible?: boolean;
      discarded?: boolean;
      autoDiscardable?: boolean;
      mutedInfo?: { muted: boolean };
      url?: string;
      pendingUrl?: string;
      title?: string;
      favIconUrl?: string;
      status?: string;
      incognito: boolean;
      width?: number;
      height?: number;
      sessionId?: string;
    }

    export function query(queryInfo: {
      active?: boolean;
      currentWindow?: boolean;
      lastFocusedWindow?: boolean;
      url?: string | string[];
    }): Promise<Tab[]>;
    export function query(
      queryInfo: {
        active?: boolean;
        currentWindow?: boolean;
        lastFocusedWindow?: boolean;
        url?: string | string[];
      },
      callback: (result: Tab[]) => void,
    ): void;
    export function get(tabId: number): Promise<Tab>;
    export function captureVisibleTab(
      windowId?: number,
      options?: { format?: "png" | "jpeg"; quality?: number },
    ): Promise<string>;
    export function captureVisibleTab(
      windowId?: number,
      options?: { format?: "png" | "jpeg"; quality?: number },
      callback?: (dataUrl: string) => void,
    ): void;
    export function sendMessage<M = unknown, R = unknown>(
      tabId: number,
      message: M,
      responseCallback?: (response: R) => void,
    ): Promise<R>;
    export function create(createProperties: {
      windowId?: number;
      index?: number;
      url?: string;
      active?: boolean;
      selected?: boolean;
      pinned?: boolean;
      openerTabId?: number;
    }): Promise<Tab>;
    export function update(
      tabId?: number,
      updateProperties?: {
        url?: string;
        active?: boolean;
        highlighted?: boolean;
        selected?: boolean;
        pinned?: boolean;
        muted?: boolean;
        openerTabId?: number;
        autoDiscardable?: boolean;
      },
    ): Promise<Tab>;
  }

  export namespace sidePanel {
    export interface PanelOptions {
      tabId?: number;
      path?: string;
      enabled?: boolean;
    }

    export function setOptions(options: PanelOptions): Promise<void>;
    export function open(options: { tabId?: number; windowId?: number }): Promise<void>;
    export function getOptions(options: { tabId?: number }): Promise<PanelOptions>;
  }

  export namespace identity {
    export function getRedirectURL(path?: string): string;
    export function launchWebAuthFlow(
      details: { url: string; interactive?: boolean },
      callback?: (responseUrl?: string) => void,
    ): Promise<string>;
    export function getAuthToken(
      details: { interactive?: boolean; scopes?: string[] },
      callback?: (token?: string) => void,
    ): Promise<string>;
    export function getProfileUserInfo(
      details?: { accountStatus?: string },
      callback?: (userInfo: { email: string; id: string }) => void,
    ): Promise<{ email: string; id: string }>;
  }

  export namespace action {
    export const onClicked: {
      addListener(callback: (tab: tabs.Tab) => void): void;
    };
    export function openPopup(): Promise<void>;
  }

  export namespace commands {
    export const onCommand: {
      addListener(callback: (command: string, tab?: tabs.Tab) => void): void;
      removeListener(callback: (command: string, tab?: tabs.Tab) => void): void;
    };
  }

  export namespace windows {
    export interface Window {
      id?: number;
      focused?: boolean;
      top?: number;
      left?: number;
      width?: number;
      height?: number;
      tabs?: tabs.Tab[];
      incognito?: boolean;
      type?: string;
      state?: string;
      alwaysOnTop?: boolean;
      sessionId?: string;
    }
    export function getCurrent(): Promise<Window>;
    export function getCurrent(callback: (window: Window) => void): void;
  }
}
