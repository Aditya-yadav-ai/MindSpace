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

    // Web accessible resources (PDF.js fonts and cmaps)
    assert.ok(
      Array.isArray(manifest.web_accessible_resources),
      "Must declare web_accessible_resources",
    );
    const warResources = manifest.web_accessible_resources.flatMap((r) => r.resources || []);
    assert.ok(warResources.includes("standard_fonts/*"), "Must expose standard_fonts/*");
    assert.ok(warResources.includes("cmaps/*"), "Must expose cmaps/*");
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

  await t.test(
    "sidepanel loads in real Chrome with zero uncaught runtime exceptions (no fileURLToPath errors)",
    async () => {
      const http = await import("node:http");
      const sidepanelFile = path.join(DIST_EXT_DIR, "sidepanel.html");
      const sidepanelUrl = "file:///" + sidepanelFile.replace(/\\/g, "/");
      const tempProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindspace-chrome-cdp-"));

      const args = [
        "--remote-debugging-port=9235",
        "--headless=new",
        "--disable-gpu",
        "--allow-file-access-from-files",
        "--no-sandbox",
        "--disable-web-security",
        `--user-data-dir=${tempProfileDir}`,
        sidepanelUrl,
      ];

      const proc = spawn(browserBinary, args, { stdio: ["ignore", "pipe", "pipe"] });
      await new Promise((resolve) => setTimeout(resolve, 2500));

      try {
        const targets = await new Promise((resolve, reject) => {
          http
            .get("http://127.0.0.1:9235/json", (res) => {
              let data = "";
              res.on("data", (chunk) => (data += chunk));
              res.on("end", () => resolve(JSON.parse(data)));
            })
            .on("error", reject);
        });

        const target = targets.find((tg) => tg.url && tg.url.includes("sidepanel.html"));
        assert.ok(target, "Sidepanel page target must be active in Chrome");

        const ws = new WebSocket(target.webSocketDebuggerUrl);
        const exceptions = [];

        const result = await new Promise((resolve, reject) => {
          ws.addEventListener("open", () => {
            ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
            ws.send(JSON.stringify({ id: 2, method: "Console.enable" }));
            setTimeout(() => {
              ws.send(
                JSON.stringify({
                  id: 10,
                  method: "Runtime.evaluate",
                  params: { expression: "document.getElementById('root')?.innerHTML || ''" },
                }),
              );
            }, 1500);
          });

          ws.addEventListener("message", (event) => {
            const msg = JSON.parse(event.data);
            if (msg.method === "Runtime.exceptionThrown") {
              exceptions.push(msg.params?.exceptionDetails);
            }
            if (msg.id === 10) {
              resolve(msg.result?.result?.value || "");
            }
          });

          ws.addEventListener("error", reject);
        });

        ws.close();

        // 1. Verify React root has mounted the application UI
        assert.ok(result.length > 500, "React app must mount in #root");
        assert.ok(
          result.includes("MindSpace") || result.includes("Welcome"),
          "Must contain MindSpace UI",
        );

        // 2. Verify zero uncaught exceptions
        assert.equal(
          exceptions.length,
          0,
          `Chrome threw uncaught exceptions: ${JSON.stringify(exceptions)}`,
        );

        // 3. Specifically assert no fileURLToPath errors
        const hasFileUrlError = exceptions.some((e) =>
          (e?.exception?.description || "").includes("fileURLToPath"),
        );
        assert.equal(hasFileUrlError, false, "Must have zero fileURLToPath runtime errors");
      } finally {
        proc.kill("SIGKILL");
        try {
          fs.rmSync(tempProfileDir, { recursive: true, force: true });
        } catch {}
      }
    },
  );

  await t.test(
    "extracts text from standard-font PDF in browser context without standardFontDataUrl warnings",
    async () => {
      const http = await import("node:http");
      const sidepanelFile = path.join(DIST_EXT_DIR, "sidepanel.html");
      const sidepanelUrl = "file:///" + sidepanelFile.replace(/\\/g, "/");
      const tempProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindspace-chrome-pdf-"));

      // Discover the actual PDF and worker chunk filenames from the built assets
      const assetsDir = path.join(DIST_EXT_DIR, "assets");
      const assetFiles = fs.readdirSync(assetsDir);
      const pdfChunkFile = assetFiles.find((f) => /^pdf-[a-zA-Z0-9_-]+\.js$/.test(f));
      const workerChunkFile = assetFiles.find((f) =>
        /^pdf\.worker\.min-[a-zA-Z0-9_-]+\.mjs$/.test(f),
      );
      assert.ok(pdfChunkFile, "PDF chunk must exist in dist-extension/assets");
      assert.ok(workerChunkFile, "PDF worker chunk must exist in dist-extension/assets");

      const MINIMAL_PDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 55 >>
stream
BT
/F1 24 Tf
100 700 Td
(MindSpace Offline PDF Intelligence) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000227 00000 n 
0000000332 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
407
%%EOF`;

      const args = [
        "--remote-debugging-port=9236",
        "--headless=new",
        "--disable-gpu",
        "--allow-file-access-from-files",
        "--no-sandbox",
        "--disable-web-security",
        `--user-data-dir=${tempProfileDir}`,
        sidepanelUrl,
      ];

      const proc = spawn(browserBinary, args, { stdio: ["ignore", "pipe", "pipe"] });
      await new Promise((resolve) => setTimeout(resolve, 2500));

      try {
        const targets = await new Promise((resolve, reject) => {
          http
            .get("http://127.0.0.1:9236/json", (res) => {
              let data = "";
              res.on("data", (chunk) => (data += chunk));
              res.on("end", () => resolve(JSON.parse(data)));
            })
            .on("error", reject);
        });

        const target = targets.find((tg) => tg.url && tg.url.includes("sidepanel.html"));
        assert.ok(target, "Sidepanel page target must be active in Chrome");

        const ws = new WebSocket(target.webSocketDebuggerUrl);
        const pdfBase64 = Buffer.from(MINIMAL_PDF).toString("base64");

        const pdfExpr = `
          (async () => {
            const warnings = [];
            const originalWarn = console.warn;
            console.warn = (...args) => {
              warnings.push(args.join(" "));
              originalWarn(...args);
            };

            try {
              const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
              const pdfjs = await import(baseUrl + 'assets/${pdfChunkFile}');
              const binary = atob('${pdfBase64}');
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

              pdfjs.GlobalWorkerOptions.workerSrc = baseUrl + 'assets/${workerChunkFile}';

              const task = pdfjs.getDocument({
                data: bytes,
                standardFontDataUrl: baseUrl + 'standard_fonts/',
                cMapUrl: baseUrl + 'cmaps/',
                cMapPacked: true,
                useWorkerFetch: false,
                isEvalSupported: false,
                useSystemFonts: true,
              });

              const doc = await task.promise;
              const page = await doc.getPage(1);
              const textContent = await page.getTextContent();
              const extracted = textContent.items.map(item => item.str).join(' ').trim();

              console.warn = originalWarn;
              return { extracted, warnings, success: true };
            } catch (err) {
              console.warn = originalWarn;
              return { error: err.message, warnings, success: false };
            }
          })()
        `;

        const evalResult = await new Promise((resolve, reject) => {
          ws.addEventListener("open", () => {
            ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
            setTimeout(() => {
              ws.send(
                JSON.stringify({
                  id: 20,
                  method: "Runtime.evaluate",
                  params: { expression: pdfExpr, awaitPromise: true, returnByValue: true },
                }),
              );
            }, 1000);
          });

          ws.addEventListener("message", (event) => {
            const msg = JSON.parse(event.data);
            if (msg.id === 20) {
              resolve(msg.result?.result?.value);
            }
          });

          ws.addEventListener("error", reject);
        });

        ws.close();

        assert.ok(evalResult?.success, `PDF extraction failed: ${evalResult?.error}`);
        assert.equal(evalResult?.extracted, "MindSpace Offline PDF Intelligence");

        const hasFontWarning = (evalResult?.warnings || []).some((w) =>
          w.includes("standardFontDataUrl API parameter is provided"),
        );
        assert.equal(hasFontWarning, false, "Must not emit standardFontDataUrl warning");
      } finally {
        proc.kill("SIGKILL");
        try {
          fs.rmSync(tempProfileDir, { recursive: true, force: true });
        } catch {}
      }
    },
  );
});
