// MindSpace content script: extracts readable text from the active page.
// Injected on demand by the service worker (activeTab + scripting), so it does
// not run on every page the user visits.

(function () {
  if (window.__mindspaceCaptureInstalled) {
    return;
  }
  window.__mindspaceCaptureInstalled = true;

  var RESTRICTED =
    /^(chrome|edge|about|devtools|view-source|chrome-extension|moz-extension|opera|brave):/i;
  var MAX_TEXT = 60000;

  function cleanText(root) {
    var clone = root.cloneNode(true);
    var junk = clone.querySelectorAll(
      "script,style,noscript,svg,iframe,canvas,video,audio,form,nav,footer,header,aside,template,[aria-hidden='true'],[hidden]",
    );
    for (var i = 0; i < junk.length; i += 1) {
      junk[i].remove();
    }
    var raw = clone.textContent || "";
    return raw.replace(/\s+/g, " ").trim();
  }

  function capture() {
    var url = location.href;
    if (RESTRICTED.test(url)) {
      return {
        ok: false,
        reason: "restricted",
        message: "This browser page cannot be read by extensions. Paste the text manually instead.",
        url: url,
      };
    }

    var selection = "";
    try {
      selection = (window.getSelection() && window.getSelection().toString()) || "";
      selection = selection.replace(/\s+/g, " ").trim();
    } catch (error) {
      selection = "";
    }

    var root =
      document.querySelector("article") ||
      document.querySelector("main") ||
      document.querySelector("[role='main']") ||
      document.body;

    if (!root) {
      return { ok: false, reason: "empty", message: "The page has no readable body.", url: url };
    }

    var full = cleanText(root);
    var usedSelection = selection.length >= 80;
    var text = usedSelection ? selection : full;

    if (!text || text.length < 20) {
      return {
        ok: false,
        reason: "empty",
        message: "No readable text was found on this page.",
        url: url,
      };
    }

    var truncated = text.length > MAX_TEXT;
    if (truncated) {
      text = text.slice(0, MAX_TEXT);
    }

    return {
      ok: true,
      usedSelection: usedSelection,
      capture: {
        url: url,
        title: (document.title || "").slice(0, 512),
        domain: location.hostname,
        text: text,
        word_count: text.split(/\s+/).filter(Boolean).length,
        text_truncated: truncated,
        source: "extension",
        captured_at: new Date().toISOString(),
      },
    };
  }

  function computeSimpleHash(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      var char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(16);
  }

  function executeAutomation(payload) {
    if (!payload || !payload.action) {
      return { ok: false, message: "Missing automation action." };
    }

    var action = payload.action;

    if (action === "page_hash") {
      var bodyText = (document.body && document.body.innerText) || "";
      return {
        ok: true,
        hash: computeSimpleHash(bodyText.slice(0, 50000)),
        title: document.title || "",
        url: location.href,
        timestamp: new Date().toISOString(),
      };
    }

    if (action === "extract_tables") {
      var tables = document.querySelectorAll("table");
      var results = [];
      for (var t = 0; t < tables.length; t++) {
        var table = tables[t];
        var rows = [];
        var trs = table.querySelectorAll("tr");
        for (var r = 0; r < trs.length; r++) {
          var cells = [];
          var tds = trs[r].querySelectorAll("th, td");
          for (var c = 0; c < tds.length; c++) {
            cells.push((tds[c].textContent || "").trim().replace(/\s+/g, " "));
          }
          if (cells.length > 0) rows.push(cells);
        }
        if (rows.length > 0) {
          results.push({
            index: t,
            rowCount: rows.length,
            colCount: rows[0] ? rows[0].length : 0,
            rows: rows.slice(0, 100),
          });
        }
      }
      return { ok: true, count: results.length, tables: results };
    }

    if (action === "scroll") {
      var direction = payload.direction || "down";
      var pixels = typeof payload.pixels === "number" ? payload.pixels : 500;
      if (direction === "top") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else if (direction === "bottom") {
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      } else if (direction === "up") {
        window.scrollBy({ top: -pixels, behavior: "smooth" });
      } else {
        window.scrollBy({ top: pixels, behavior: "smooth" });
      }
      return {
        ok: true,
        scrollY: window.scrollY,
        scrollHeight: document.body.scrollHeight,
      };
    }

    if (action === "click") {
      var target = null;
      if (payload.selector) {
        target = document.querySelector(payload.selector);
      } else if (payload.text) {
        var searchText = payload.text.toLowerCase().trim();
        var candidates = document.querySelectorAll(
          "button, a, input[type='button'], input[type='submit'], [role='button']",
        );
        for (var i = 0; i < candidates.length; i++) {
          if (
            (candidates[i].textContent || candidates[i].value || "")
              .toLowerCase()
              .includes(searchText)
          ) {
            target = candidates[i];
            break;
          }
        }
      }

      if (!target) {
        return {
          ok: false,
          reason: "target_not_found",
          message: "Element to click was not found.",
        };
      }

      // Consequential action check
      var textContent = (
        target.textContent ||
        target.value ||
        target.getAttribute("aria-label") ||
        ""
      ).toLowerCase();
      var isConsequential =
        /\b(delete|remove|erase|buy|purchase|checkout|pay|order|submit|send|transfer)\b/i.test(
          textContent,
        );
      if (isConsequential && !payload.approved) {
        return {
          ok: false,
          approvalRequired: true,
          consequential: true,
          elementText: textContent.slice(0, 60),
          message:
            "This click action performs a consequential operation (" +
            textContent.slice(0, 40) +
            ") and requires user approval.",
        };
      }

      try {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.click();
        return {
          ok: true,
          clicked: true,
          tagName: target.tagName,
          text: (target.textContent || "").slice(0, 80).trim(),
        };
      } catch (err) {
        return { ok: false, reason: "click_failed", message: String(err) };
      }
    }

    if (action === "fill") {
      if (!payload.selector) {
        return {
          ok: false,
          reason: "missing_selector",
          message: "Selector is required for form filling.",
        };
      }
      var inputEl = document.querySelector(payload.selector);
      if (!inputEl) {
        return {
          ok: false,
          reason: "input_not_found",
          message: "Form input not found for selector: " + payload.selector,
        };
      }

      if (inputEl.type === "password" && !payload.approved) {
        return {
          ok: false,
          approvalRequired: true,
          message: "Filling password fields requires explicit user approval.",
        };
      }

      try {
        inputEl.focus();
        inputEl.value = payload.value || "";
        inputEl.dispatchEvent(new Event("input", { bubbles: true }));
        inputEl.dispatchEvent(new Event("change", { bubbles: true }));
        return {
          ok: true,
          filled: true,
          selector: payload.selector,
          valLength: (payload.value || "").length,
        };
      } catch (err) {
        return { ok: false, reason: "fill_failed", message: String(err) };
      }
    }

    if (action === "select") {
      if (!payload.selector) {
        return {
          ok: false,
          reason: "missing_selector",
          message: "Selector is required for dropdown selection.",
        };
      }
      var selectEl = document.querySelector(payload.selector);
      if (!selectEl || selectEl.tagName !== "SELECT") {
        return { ok: false, reason: "select_not_found", message: "Dropdown element not found." };
      }
      try {
        if (payload.value) selectEl.value = payload.value;
        if (typeof payload.index === "number") selectEl.selectedIndex = payload.index;
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, selected: true, value: selectEl.value };
      } catch (err) {
        return { ok: false, reason: "select_failed", message: String(err) };
      }
    }

    return {
      ok: false,
      reason: "unsupported_action",
      message: "Unsupported automation action: " + action,
    };
  }

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (!message) return undefined;
    if (message.type === "MINDSPACE_CAPTURE") {
      try {
        sendResponse(capture());
      } catch (error) {
        sendResponse({
          ok: false,
          reason: "extraction_failed",
          message:
            "Text extraction failed: " + String(error && error.message ? error.message : error),
        });
      }
      return true;
    }
    if (message.type === "MINDSPACE_AUTOMATION_EXECUTE") {
      try {
        sendResponse(executeAutomation(message.payload));
      } catch (error) {
        sendResponse({
          ok: false,
          reason: "automation_exception",
          message: String(error && error.message ? error.message : error),
        });
      }
      return true;
    }
    return undefined;
  });
})();
