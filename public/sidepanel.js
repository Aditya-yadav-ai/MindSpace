// MindSpace side panel controller. Every state shown here is derived from a real
// response: no placeholder results, no invented agent activity.

(function () {
  var state = {
    capture: null,
    usedSelection: false,
    synced: false,
    busy: false,
    service: null,
  };

  var el = {
    modeBadge: document.getElementById("modeBadge"),
    screenshotBtn: document.getElementById("screenshotBtn"),
    screenshotPreview: document.getElementById("screenshotPreview"),
    screenshotImg: document.getElementById("screenshotImg"),
    detectedLayoutBadge: document.getElementById("detectedLayoutBadge"),
    visionSummary: document.getElementById("visionSummary"),
    captureBtn: document.getElementById("captureBtn"),
    settingsBtn: document.getElementById("settingsBtn"),
    settings: document.getElementById("settings"),
    apiBase: document.getElementById("apiBase"),
    saveApiBase: document.getElementById("saveApiBase"),
    emptyState: document.getElementById("emptyState"),
    captureMeta: document.getElementById("captureMeta"),
    metaTitle: document.getElementById("metaTitle"),
    metaDomain: document.getElementById("metaDomain"),
    metaWords: document.getElementById("metaWords"),
    metaSource: document.getElementById("metaSource"),
    manualText: document.getElementById("manualText"),
    useManualBtn: document.getElementById("useManualBtn"),
    clearBtn: document.getElementById("clearBtn"),
    status: document.getElementById("status"),
    question: document.getElementById("question"),
    resultCard: document.getElementById("resultCard"),
    resultBadges: document.getElementById("resultBadges"),
    resultText: document.getElementById("resultText"),
    resultSources: document.getElementById("resultSources"),
  };

  var actionButtons = Array.prototype.slice.call(document.querySelectorAll(".action"));

  function send(message) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(message, function (response) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  function setStatus(text, kind) {
    el.status.textContent = text || "";
    el.status.className = kind || "";
  }

  function setBusy(busy) {
    state.busy = busy;
    el.captureBtn.disabled = busy;
    actionButtons.forEach(function (button) {
      button.disabled = busy || !state.capture;
    });
    if (busy) {
      setStatus("Working…", "");
    }
  }

  function renderMode() {
    el.modeBadge.className = "mode";
    if (!state.service) {
      el.modeBadge.textContent = "service offline";
      el.modeBadge.classList.add("down");
      return;
    }
    if (state.service.mock) {
      el.modeBadge.textContent = "simulated mode";
      el.modeBadge.classList.add("offline");
      el.modeBadge.title = state.service.reason || "No model key is configured.";
      return;
    }
    el.modeBadge.textContent = "live model";
    el.modeBadge.classList.add("live");
    el.modeBadge.title = state.service.reason || "";
  }

  function renderCapture() {
    var capture = state.capture;
    if (!capture) {
      el.emptyState.hidden = false;
      el.captureMeta.hidden = true;
      setBusy(state.busy);
      return;
    }
    el.emptyState.hidden = true;
    el.captureMeta.hidden = false;
    el.metaTitle.textContent = capture.title || "(untitled)";
    el.metaDomain.textContent = capture.domain || "(no domain)";
    el.metaWords.textContent =
      String(capture.word_count || 0) + (capture.text_truncated ? " (truncated)" : "");
    el.metaSource.textContent =
      (capture.source === "manual"
        ? "pasted text"
        : state.usedSelection
          ? "page selection"
          : "page text") + (state.synced ? " · shared with app" : " · extension only");
    setBusy(state.busy);
  }

  function formatError(result) {
    var suffix = result && result.retryable ? " This looks temporary; try again." : "";
    return ((result && result.message) || "The request failed.") + suffix;
  }

  async function refreshService() {
    try {
      var response = await send({ type: "MINDSPACE_GET_STATUS" });
      state.service = response && response.ok ? response.service : null;
      if (!response || !response.ok) {
        setStatus(
          response && response.message ? response.message : "The local service is not reachable.",
          "warn",
        );
      } else if (response.service && response.service.mock) {
        setStatus(
          "Service running in SIMULATED mode: " +
            (response.service.reason || "no model key configured") +
            ".",
          "warn",
        );
      } else {
        setStatus("Service running with a live model.", "ok");
      }
    } catch (error) {
      state.service = null;
      setStatus("The extension could not reach its background worker.", "error");
    }
    renderMode();
  }

  async function captureActiveTab() {
    if (state.busy) {
      return;
    }
    setBusy(true);
    try {
      var result = await send({ type: "MINDSPACE_CAPTURE_ACTIVE_TAB" });
      if (!result || !result.ok) {
        state.capture = null;
        state.synced = false;
        renderCapture();
        setStatus((result && result.message) || "The page could not be captured.", "error");
        return;
      }
      state.capture = result.capture;
      state.usedSelection = !!result.usedSelection;
      state.synced = !!result.synced;
      renderCapture();
      if (result.synced) {
        setStatus(
          "Captured " +
            result.capture.word_count +
            " words and shared them with the MindSpace app.",
          "ok",
        );
      } else {
        setStatus(
          "Captured, but not shared with the app: " +
            (result.syncError || "the service is offline") +
            " Local actions still work.",
          "warn",
        );
      }
    } catch (error) {
      setStatus("Capture failed: " + String(error.message || error), "error");
    } finally {
      setBusy(false);
    }
  }

  function useManualText() {
    var text = el.manualText.value.trim();
    if (text.length < 20) {
      setStatus("Paste at least a sentence of readable text.", "error");
      return;
    }
    state.capture = {
      url: "",
      title: "Pasted text",
      domain: "",
      text: text.slice(0, 60000),
      word_count: text.split(/\s+/).filter(Boolean).length,
      text_truncated: text.length > 60000,
      source: "manual",
      captured_at: new Date().toISOString(),
    };
    state.usedSelection = false;
    state.synced = false;
    renderCapture();
    setStatus("Using pasted text. It stays in this panel unless you run an action.", "ok");
  }

  function clearContext() {
    state.capture = null;
    state.usedSelection = false;
    state.synced = false;
    el.manualText.value = "";
    el.resultCard.style.display = "none";
    renderCapture();
    setStatus("Context cleared.", "");
  }

  function renderResult(data) {
    el.resultCard.style.display = "block";
    el.resultBadges.textContent = "";
    el.resultSources.textContent = "";

    function badge(text, className) {
      var span = document.createElement("span");
      span.className = "badge" + (className ? " " + className : "");
      span.textContent = text;
      el.resultBadges.appendChild(span);
    }

    badge(data.mock ? "SIMULATED OUTPUT" : "MODEL OUTPUT", data.mock ? "simulated" : "live");
    badge(data.mode);
    if (data.model) {
      badge(data.model);
    }
    if (typeof data.latency_ms === "number") {
      badge(data.latency_ms.toFixed(0) + " ms");
    }
    var guards = data.guardrails || {};
    if (guards.truncated) {
      badge("text truncated", "warn");
    }
    if (guards.injection_flags && guards.injection_flags.length) {
      badge("untrusted instructions ignored (" + guards.injection_flags.length + ")", "warn");
    }

    el.resultText.textContent = data.result || "";

    if (data.sources && data.sources.length) {
      var heading = document.createElement("div");
      heading.textContent = "Sources";
      el.resultSources.appendChild(heading);
      data.sources.forEach(function (source) {
        var line = document.createElement("div");
        if (source.url) {
          var link = document.createElement("a");
          link.href = source.url;
          link.target = "_blank";
          link.rel = "noreferrer";
          link.textContent = source.title || source.url;
          line.appendChild(link);
        } else {
          line.textContent = source.title || "captured page";
        }
        el.resultSources.appendChild(line);
      });
    }
  }

  async function runAction(action) {
    if (state.busy) {
      return;
    }
    if (!state.capture) {
      setStatus("Capture a page or paste text first.", "error");
      return;
    }
    var question = el.question.value.trim();
    if (action === "ask" && !question) {
      setStatus("Type a question first.", "error");
      el.question.focus();
      return;
    }

    setBusy(true);
    try {
      var response = await send({
        type: "MINDSPACE_ASSIST",
        payload: {
          action: action,
          question: action === "ask" ? question : "",
          context: state.capture,
        },
      });

      if (!response || !response.ok) {
        setStatus(formatError(response), "error");
        return;
      }
      renderResult(response.data);
      setStatus(
        response.data.mock
          ? "Simulated result (no live model configured). It is labelled as simulated."
          : "Model result received.",
        response.data.mock ? "warn" : "ok",
      );
    } catch (error) {
      setStatus("Request failed: " + String(error.message || error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function captureScreenshot() {
    if (state.busy) return;
    setBusy(true, "Capturing visible screen…");
    try {
      var res = await send({ type: "MINDSPACE_CAPTURE_SCREENSHOT" });
      if (res && res.ok && res.data) {
        if (res.data.screenshot && el.screenshotImg) {
          el.screenshotImg.src = res.data.screenshot;
          el.screenshotImg.style.display = "block";
        }
        if (el.screenshotPreview) {
          el.screenshotPreview.style.display = "block";
        }
        if (res.analysis && res.analysis.analysis) {
          var ana = res.analysis.analysis;
          if (el.detectedLayoutBadge)
            el.detectedLayoutBadge.textContent = ana.detected_layout || "detected";
          if (el.visionSummary)
            el.visionSummary.textContent =
              "Vision Agent identified layout '" +
              (ana.detected_layout || "general") +
              "' and prepared supervisor plan.";
        }
        if (res.data.textContext) {
          state.capture = res.data.textContext;
          renderCapture();
        }
        setStatus("Screenshot captured and parsed by Vision Agent.", "ok");
      } else {
        setStatus((res && res.message) || "Screenshot capture failed.", "error");
      }
    } catch (e) {
      setStatus("Screenshot error: " + String(e.message || e), "error");
    } finally {
      setBusy(false);
    }
  }

  // --- wiring -------------------------------------------------------------
  if (el.screenshotBtn) el.screenshotBtn.addEventListener("click", captureScreenshot);
  el.captureBtn.addEventListener("click", captureActiveTab);
  el.useManualBtn.addEventListener("click", useManualText);
  el.clearBtn.addEventListener("click", clearContext);

  chrome.runtime.onMessage.addListener(function (message) {
    if (message && message.type === "MINDSPACE_SCREENSHOT_CAPTURED") {
      if (message.payload && message.payload.data) {
        var payload = message.payload.data;
        if (payload.screenshot && el.screenshotImg) {
          el.screenshotImg.src = payload.screenshot;
          el.screenshotImg.style.display = "block";
        }
        if (el.screenshotPreview) el.screenshotPreview.style.display = "block";
      }
    }
  });

  actionButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      runAction(button.getAttribute("data-action"));
    });
  });

  el.question.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      runAction("ask");
    }
  });

  el.settingsBtn.addEventListener("click", function () {
    var open = el.settings.style.display === "block";
    el.settings.style.display = open ? "none" : "block";
    el.settingsBtn.setAttribute("aria-expanded", String(!open));
  });

  el.saveApiBase.addEventListener("click", async function () {
    var value = el.apiBase.value.trim() || "http://127.0.0.1:8000";
    await send({ type: "MINDSPACE_SET_API_BASE", apiBase: value });
    setStatus("Service URL saved. Checking…", "");
    await refreshService();
  });

  async function restore() {
    var stored = await new Promise(function (resolve) {
      chrome.storage.local.get(
        ["lastCapture", "lastCaptureUsedSelection", "lastScreenshotCapture", "apiBase"],
        resolve,
      );
    });
    el.apiBase.value = stored.apiBase || "http://127.0.0.1:8000";
    if (stored.lastScreenshotCapture) {
      var s = stored.lastScreenshotCapture;
      if (s.screenshot && el.screenshotImg) {
        el.screenshotImg.src = s.screenshot;
        el.screenshotImg.style.display = "block";
      }
      if (el.screenshotPreview) el.screenshotPreview.style.display = "block";
      if (s.textContext) {
        state.capture = s.textContext;
      }
    }
    if (stored.lastCapture && stored.lastCapture.text) {
      if (!state.capture) state.capture = stored.lastCapture;
      state.usedSelection = !!stored.lastCaptureUsedSelection;
      state.synced = false;
      renderCapture();
      setStatus("Restored your last capture.", "");
    }
    renderCapture();
    await refreshService();
  }

  restore();
})();
