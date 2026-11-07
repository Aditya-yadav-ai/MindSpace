// MindSpace service worker: owns capture orchestration and talks to the local
// Python API. No capture content is ever logged or persisted beyond chrome.storage.

var DEFAULT_API_BASE = "http://127.0.0.1:8010";
var REQUEST_TIMEOUT_MS = 40000;

chrome.runtime.onInstalled.addListener(function () {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(function () {});
});

function getApiBase() {
  return new Promise(function (resolve) {
    chrome.storage.local.get({ apiBase: DEFAULT_API_BASE }, function (items) {
      resolve(String(items.apiBase || DEFAULT_API_BASE).replace(/\/+$/, ""));
    });
  });
}

function getClientId() {
  // The web app and the extension run on the same machine, so they share the
  // fixed "local" client id and can see each other's captures. An explicit
  // stored override is still honoured.
  return new Promise(function (resolve) {
    chrome.storage.local.get({ clientId: "local" }, function (items) {
      resolve(String(items.clientId || "local"));
    });
  });
}

function activeTab() {
  return new Promise(function (resolve, reject) {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, function (tabs) {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!tabs || !tabs[0]) {
        reject(new Error("No active tab is available."));
        return;
      }
      resolve(tabs[0]);
    });
  });
}

function sendToTab(tabId, message) {
  return new Promise(function (resolve, reject) {
    chrome.tabs.sendMessage(tabId, message, function (response) {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function injectContentScript(tabId) {
  return new Promise(function (resolve, reject) {
    chrome.scripting.executeScript(
      { target: { tabId: tabId }, files: ["content-script.js"] },
      function () {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      },
    );
  });
}

async function requestCapture(tab) {
  try {
    return await sendToTab(tab.id, { type: "MINDSPACE_CAPTURE" });
  } catch (error) {
    // Most pages have no content script yet: inject on demand, then retry once.
    await injectContentScript(tab.id);
    return sendToTab(tab.id, { type: "MINDSPACE_CAPTURE" });
  }
}

async function apiFetch(path, options) {
  var base = await getApiBase();
  var clientId = await getClientId();
  var controller = new AbortController();
  var timer = setTimeout(function () {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    var response = await fetch(base + path, {
      method: (options && options.method) || "GET",
      headers: Object.assign(
        { "Content-Type": "application/json", "X-MindSpace-Client": clientId },
        (options && options.headers) || {},
      ),
      body: options && options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    var payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    return { ok: response.ok, status: response.status, payload: payload };
  } catch (error) {
    var message =
      error && error.name === "AbortError"
        ? "The local MindSpace service did not respond in time."
        : "Cannot reach the local MindSpace service at " + base + ".";
    return { ok: false, status: 0, payload: null, networkError: message };
  } finally {
    clearTimeout(timer);
  }
}

async function captureActiveTab() {
  var tab;
  try {
    tab = await activeTab();
  } catch (error) {
    return { ok: false, reason: "no_tab", message: error.message };
  }

  var result;
  try {
    result = await requestCapture(tab);
  } catch (error) {
    return {
      ok: false,
      reason: "unreadable",
      message:
        "This page cannot be read (" +
        String(error.message || error).slice(0, 160) +
        "). Paste the text manually instead.",
      url: tab.url || "",
      title: tab.title || "",
    };
  }

  if (!result || !result.ok) {
    return {
      ok: false,
      reason: (result && result.reason) || "unreadable",
      message: (result && result.message) || "The page could not be captured.",
      url: (result && result.url) || tab.url || "",
      title: tab.title || "",
    };
  }

  await new Promise(function (resolve) {
    chrome.storage.local.set(
      { lastCapture: result.capture, lastCaptureUsedSelection: !!result.usedSelection },
      resolve,
    );
  });

  var sync = await apiFetch("/v1/context", { method: "POST", body: { context: result.capture } });

  return {
    ok: true,
    capture: result.capture,
    usedSelection: !!result.usedSelection,
    synced: sync.ok,
    syncStatus: sync.status,
    syncError: sync.ok
      ? ""
      : (sync.payload && sync.payload.error && sync.payload.error.message) ||
        sync.networkError ||
        "The service rejected the capture.",
  };
}

async function captureVisibleTabScreenshot() {
  var tab;
  try {
    tab = await activeTab();
  } catch (err) {
    return { ok: false, message: err.message };
  }

  var isRestricted =
    !tab.url || /^(chrome|chrome-extension|edge|about|devtools|view-source):/i.test(tab.url);
  if (isRestricted) {
    return {
      ok: false,
      restricted: true,
      reason: "restricted_url",
      message:
        "MindSpace cannot capture internal browser pages (" +
        (tab.url || "restricted") +
        ") for security and privacy reasons.",
      url: tab.url || "",
      title: tab.title || "",
    };
  }

  var dataUrl = null;
  try {
    dataUrl = await new Promise(function (resolve, reject) {
      chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }, function (data) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(data);
        }
      });
    });
  } catch (err) {
    console.warn("Screenshot capture error:", err);
  }

  var textCapture = null;
  try {
    var textResult = await requestCapture(tab);
    if (textResult && textResult.ok) {
      textCapture = textResult.capture;
    }
  } catch (e) {
    // optional text extraction fallback
  }

  var screenshotPayload = {
    url: tab.url || "",
    title: tab.title || "",
    screenshot: dataUrl,
    captured_at: new Date().toISOString(),
    textContext: textCapture,
  };

  await new Promise(function (resolve) {
    chrome.storage.local.set({ lastScreenshotCapture: screenshotPayload }, resolve);
  });

  var sync = await apiFetch("/v1/screenshot", {
    method: "POST",
    body: screenshotPayload,
  });

  return {
    ok: true,
    data: screenshotPayload,
    analysis: sync.ok ? sync.payload : null,
    synced: sync.ok,
  };
}

chrome.commands.onCommand.addListener(async function (command) {
  if (command === "capture_screenshot" || command === "capture-visible-tab") {
    try {
      var tab = await activeTab();
      if (chrome.sidePanel && chrome.sidePanel.open) {
        chrome.sidePanel.open({ windowId: tab.windowId }).catch(function () {});
      }
      var res = await captureVisibleTabScreenshot();
      chrome.runtime
        .sendMessage({ type: "MINDSPACE_SCREENSHOT_CAPTURED", payload: res })
        .catch(function () {});
    } catch (e) {
      console.error("Screenshot command execution failed:", e);
    }
  }
});

async function assist(payload) {
  var response = await apiFetch("/v1/assist", { method: "POST", body: payload });
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      retryable: !!(response.payload && response.payload.error && response.payload.error.retryable),
      message:
        (response.payload && response.payload.error && response.payload.error.message) ||
        response.networkError ||
        "The request failed.",
    };
  }
  return { ok: true, data: response.payload };
}

chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
  if (!message || !message.type) {
    return undefined;
  }

  if (message.type === "MINDSPACE_CAPTURE_ACTIVE_TAB") {
    captureActiveTab().then(sendResponse);
    return true;
  }
  if (message.type === "MINDSPACE_CAPTURE_SCREENSHOT") {
    captureVisibleTabScreenshot().then(sendResponse);
    return true;
  }
  if (message.type === "MINDSPACE_GET_LAST_SCREENSHOT") {
    chrome.storage.local.get({ lastScreenshotCapture: null }, function (items) {
      sendResponse({ ok: true, data: items.lastScreenshotCapture });
    });
    return true;
  }
  if (message.type === "MINDSPACE_ASSIST") {
    assist(message.payload).then(sendResponse);
    return true;
  }
  if (message.type === "MINDSPACE_GET_STATUS") {
    (async function () {
      var health = await apiFetch("/ready");
      sendResponse({
        ok: health.ok,
        service:
          health.ok && health.payload
            ? {
                mode: health.payload.mode,
                mock: health.payload.mock,
                llmConfigured: health.payload.llm_configured,
                reason: health.payload.reason,
              }
            : null,
        message: health.ok ? "" : health.networkError || "Service unavailable.",
      });
    })();
    return true;
  }
  if (message.type === "MINDSPACE_SET_API_BASE") {
    chrome.storage.local.set({ apiBase: message.apiBase || DEFAULT_API_BASE }, function () {
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message.type === "MINDSPACE_GET_API_BASE") {
    getApiBase().then(function (base) {
      sendResponse({ ok: true, apiBase: base });
    });
    return true;
  }
  if (message.type === "MINDSPACE_LIST_TABS") {
    chrome.tabs.query({}, function (tabs) {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, message: chrome.runtime.lastError.message });
        return;
      }
      var clean = (tabs || [])
        .filter(function (t) {
          return (
            t.url && !/^(chrome|edge|about|devtools|view-source|chrome-extension):/i.test(t.url)
          );
        })
        .map(function (t) {
          return {
            id: t.id,
            windowId: t.windowId,
            title: t.title || "Untitled",
            url: t.url,
            active: !!t.active,
            favIconUrl: t.favIconUrl || "",
          };
        });
      sendResponse({ ok: true, tabs: clean });
    });
    return true;
  }
  if (message.type === "MINDSPACE_CAPTURE_TABS") {
    (async function () {
      var tabIds = (message.payload && message.payload.tabIds) || [];
      var results = [];
      for (var i = 0; i < tabIds.length; i++) {
        var tid = tabIds[i];
        try {
          var t = await new Promise(function (res, rej) {
            chrome.tabs.get(tid, function (tab) {
              if (chrome.runtime.lastError || !tab)
                rej(chrome.runtime.lastError || new Error("Tab not found"));
              else res(tab);
            });
          });
          var capResult = await requestCapture(t);
          if (capResult && capResult.ok) {
            results.push({
              tabId: tid,
              url: t.url || "",
              title: t.title || "",
              captured_at: new Date().toISOString(),
              capture: capResult.capture,
            });
          }
        } catch (err) {
          results.push({
            tabId: tid,
            error: String(err && err.message ? err.message : err),
          });
        }
      }
      sendResponse({ ok: true, tabs: results });
    })();
    return true;
  }
  if (message.type === "MINDSPACE_OPEN_TAB") {
    chrome.tabs.create({ url: message.url || "https://google.com" }, function (tab) {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, message: chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true, tabId: tab.id, url: tab.url });
      }
    });
    return true;
  }
  if (message.type === "MINDSPACE_NAVIGATE_TAB") {
    var navTabId = message.tabId;
    if (!navTabId) {
      activeTab()
        .then(function (t) {
          chrome.tabs.update(t.id, { url: message.url }, function (updated) {
            sendResponse({
              ok: !chrome.runtime.lastError,
              tabId: t.id,
              url: updated && updated.url,
            });
          });
        })
        .catch(function (e) {
          sendResponse({ ok: false, message: e.message });
        });
    } else {
      chrome.tabs.update(navTabId, { url: message.url }, function (updated) {
        sendResponse({
          ok: !chrome.runtime.lastError,
          tabId: navTabId,
          url: updated && updated.url,
        });
      });
    }
    return true;
  }
  if (message.type === "MINDSPACE_CLOSE_TAB") {
    if (message.tabId) {
      chrome.tabs.remove(message.tabId, function () {
        sendResponse({ ok: !chrome.runtime.lastError });
      });
      return true;
    }
  }
  if (message.type === "MINDSPACE_SHOW_NOTIFICATION") {
    if (chrome.notifications && chrome.notifications.create) {
      chrome.notifications.create(
        {
          type: "basic",
          iconUrl:
            "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='12' cy='12' r='10' fill='%236366f1'/></svg>",
          title: message.title || "MindSpace",
          message: message.message || "",
          priority: 1,
        },
        function (notificationId) {
          sendResponse({ ok: true, notificationId: notificationId });
        },
      );
    } else {
      sendResponse({ ok: false, reason: "notifications_unsupported" });
    }
    return true;
  }
  if (message.type === "MINDSPACE_EXECUTE_ACTION") {
    (async function () {
      try {
        var targetTabId = message.tabId;
        if (!targetTabId) {
          var actTab = await activeTab();
          targetTabId = actTab.id;
        }
        await injectContentScript(targetTabId).catch(function () {});
        var actResult = await sendToTab(targetTabId, {
          type: "MINDSPACE_AUTOMATION_EXECUTE",
          payload: message.payload,
        });
        sendResponse(actResult);
      } catch (err) {
        sendResponse({ ok: false, message: String(err && err.message ? err.message : err) });
      }
    })();
    return true;
  }
  return undefined;
});
