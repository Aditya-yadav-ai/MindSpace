/**
 * Real browser and extension integration test for MindSpace Stage 8.
 * Validates Manifest V3 compliance, script syntax, dedicated packaging directory
 * (excluding reserved files like _headers), and launches Chrome with the unpacked
 * extension loaded.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import os from "node:os";

const PROJECT_ROOT = process.cwd();
const EXTENSION_DIR = path.join(PROJECT_ROOT, "public");
const DIST_EXT_DIR = path.join(PROJECT_ROOT, "dist-extension");
const MANIFEST_PATH = path.join(EXTENSION_DIR, "manifest.json");
const BG_SCRIPT_PATH = path.join(EXTENSION_DIR, "extension-background.js");
const CS_SCRIPT_PATH = path.join(EXTENSION_DIR, "content-script.js");
const SIDEPANEL_HTML_PATH = path.join(EXTENSION_DIR, "sidepanel.html");
const SIDEPANEL_JS_PATH = path.join(EXTENSION_DIR, "sidepanel.js");

const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

function findBrowserBinary() {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

test("MindSpace Extension MV3 Contract & Syntax Verification", async (t) => {
  await t.test("manifest.json is valid MV3 with required MindSpace permissions", () => {
    assert.ok(fs.existsSync(MANIFEST_PATH), "manifest.json must exist in public/");
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

    assert.equal(manifest.manifest_version, 3, "Must be Manifest V3");
    assert.equal(manifest.name, "MindSpace");
    assert.ok(manifest.version, "Must declare version");

    // Required permissions
    const permissions = manifest.permissions || [];
    assert.ok(permissions.includes("sidePanel"), "Must declare sidePanel permission");
    assert.ok(permissions.includes("storage"), "Must declare storage permission");
    assert.ok(permissions.includes("activeTab"), "Must declare activeTab permission");
    assert.ok(permissions.includes("scripting"), "Must declare scripting permission");
    assert.ok(permissions.includes("tabs"), "Must declare tabs permission");
    assert.ok(permissions.includes("notifications"), "Must declare notifications permission");

    // Side panel path
    assert.equal(manifest.side_panel?.default_path, "sidepanel.html");

    // Background service worker
    assert.equal(manifest.background?.service_worker, "extension-background.js");

    // Icons
    assert.ok(manifest.icons?.["16"], "Must declare 16px icon");
    assert.ok(manifest.icons?.["48"], "Must declare 48px icon");
    assert.ok(manifest.icons?.["128"], "Must declare 128px icon");

    // Alt+B Shortcut command
    assert.ok(manifest.commands?.capture_screenshot, "Must register capture_screenshot command");
    assert.equal(manifest.commands.capture_screenshot.suggested_key?.default, "Alt+B");
    assert.equal(manifest.commands.capture_screenshot.suggested_key?.mac, "Alt+B");
  });

  await t.test("extension background service worker syntax is valid", () => {
    assert.ok(fs.existsSync(BG_SCRIPT_PATH));
    const code = fs.readFileSync(BG_SCRIPT_PATH, "utf8");
    assert.doesNotThrow(() => new Function(code));
    assert.ok(code.includes("capture_screenshot"), "Must handle capture_screenshot command");
    assert.ok(code.includes("captureVisibleTabScreenshot"), "Must have tab capture logic");
    assert.ok(code.includes("/v1/screenshot"), "Must sync to /v1/screenshot backend");
  });

  await t.test("content script syntax is valid", () => {
    assert.ok(fs.existsSync(CS_SCRIPT_PATH));
    const code = fs.readFileSync(CS_SCRIPT_PATH, "utf8");
    assert.doesNotThrow(() => new Function(code));
    assert.ok(code.includes("MINDSPACE_CAPTURE"), "Must handle capture requests");
  });

  await t.test("sidepanel.html and sidepanel.js link and syntax are valid", () => {
    assert.ok(fs.existsSync(SIDEPANEL_HTML_PATH));
    assert.ok(fs.existsSync(SIDEPANEL_JS_PATH));

    const html = fs.readFileSync(SIDEPANEL_HTML_PATH, "utf8");
    assert.ok(html.includes("sidepanel.js"), "sidepanel.html must link to sidepanel.js");
    assert.ok(html.includes('id="screenshotImg"'), "Must have #screenshotImg");
    assert.ok(html.includes('id="screenshotPreview"'), "Must have #screenshotPreview");

    const js = fs.readFileSync(SIDEPANEL_JS_PATH, "utf8");
    assert.doesNotThrow(() => new Function(js));
    assert.ok(js.includes("lastScreenshotCapture"), "Must restore last screenshot on load");
    assert.ok(js.includes("MINDSPACE_SCREENSHOT_CAPTURED"), "Must listen to capture event");
  });
});

test("Dedicated Extension Build Package (dist-extension) Verification", async (t) => {
  // Ensure build-extension has been run
  if (!fs.existsSync(DIST_EXT_DIR)) {
    const { execSync } = await import("node:child_process");
    execSync("node scripts/build-extension.mjs", { stdio: "inherit" });
  }

  await t.test("dist-extension directory contains all required files and NO reserved files", () => {
    assert.ok(fs.existsSync(DIST_EXT_DIR), "dist-extension must exist");

    const files = fs.readdirSync(DIST_EXT_DIR);
    assert.ok(files.includes("manifest.json"), "Must include manifest.json");
    assert.ok(files.includes("extension-background.js"), "Must include extension-background.js");
    assert.ok(files.includes("content-script.js"), "Must include content-script.js");
    assert.ok(files.includes("sidepanel.html"), "Must include sidepanel.html");
    assert.ok(files.includes("sidepanel.js"), "Must include sidepanel.js");
    assert.ok(files.includes("icon-16.png"), "Must include icon-16.png");
    assert.ok(files.includes("icon-48.png"), "Must include icon-48.png");
    assert.ok(files.includes("icon-128.png"), "Must include icon-128.png");

    // Critical: Exclude _headers and any filename starting with _
    for (const f of files) {
      assert.ok(
        !f.startsWith("_") || f === "_locales" || f === "_metadata",
        `dist-extension must NOT contain reserved file starting with _: ${f}`,
      );
    }
  });
});

test("Chrome Real-Browser Loading Verification", async (t) => {
  const browserBinary = findBrowserBinary();
  if (!browserBinary) {
    t.skip("No Chrome or Edge browser binary detected on host");
    return;
  }

  await t.test(
    "launches Chrome with clean unpacked extension directory (dist-extension)",
    async () => {
      const tempProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindspace-chrome-test-dist-"));
      const args = [
        `--user-data-dir=${tempProfileDir}`,
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        `--load-extension=${DIST_EXT_DIR}`,
        "about:blank",
      ];

      const proc = spawn(browserBinary, args, { stdio: ["ignore", "pipe", "pipe"] });

      let stderr = "";
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      // Let the browser launch, parse manifest and load the extension
      await new Promise((resolve) => setTimeout(resolve, 3000));

      proc.kill("SIGKILL");
      try {
        fs.rmSync(tempProfileDir, { recursive: true, force: true });
      } catch {}

      // Verify Chrome did not reject the extension or complain about manifest syntax
      assert.ok(
        !stderr.includes("Manifest file is invalid"),
        `Chrome reported manifest error: ${stderr}`,
      );
      assert.ok(
        !stderr.includes("Could not load extension"),
        `Chrome could not load extension: ${stderr}`,
      );
      assert.ok(
        !stderr.includes("reserved for use by the system"),
        `Chrome complained about reserved filename: ${stderr}`,
      );
    },
  );
});
