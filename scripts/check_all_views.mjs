import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const distExt = path.resolve("dist-extension");
const sidepanelUrl = "file:///" + path.join(distExt, "sidepanel.html").replace(/\\/g, "/");
const tempProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindspace-view-check-"));

const proc = spawn(chromePath, [
  "--remote-debugging-port=9246",
  "--headless=new",
  "--disable-gpu",
  "--allow-file-access-from-files",
  "--no-sandbox",
  "--disable-web-security",
  "--load-extension=" + distExt,
  "--user-data-dir=" + tempProfileDir,
  sidepanelUrl,
]);

setTimeout(async () => {
  try {
    const targets = await new Promise((res, rej) => {
      http
        .get("http://127.0.0.1:9246/json", (r) => {
          let d = "";
          r.on("data", (c) => (d += c));
          r.on("end", () => res(JSON.parse(d)));
        })
        .on("error", rej);
    });
    const target = targets.find((t) => t.url && t.url.includes("sidepanel.html"));
    if (!target) {
      console.log("No sidepanel target found!");
      return;
    }

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
      ws.send(JSON.stringify({ id: 2, method: "Console.enable" }));
      ws.send(JSON.stringify({ id: 3, method: "Log.enable" }));
    });

    const caught = [];
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === "Runtime.consoleAPICalled") {
        const text = msg.params.args
          .map((a) => a.value || a.description || JSON.stringify(a))
          .join(" ");
        console.log("[CONSOLE]", msg.params.type, text);
        if (
          msg.params.type === "error" ||
          text.includes("execution failed") ||
          text.includes("Minified React error") ||
          text.includes("Uncaught")
        ) {
          caught.push(text);
        }
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const desc =
          msg.params.exceptionDetails?.exception?.description ||
          JSON.stringify(msg.params.exceptionDetails);
        console.error("[EXCEPTION]", desc);
        caught.push(desc);
      }
    });

    await new Promise((r) => setTimeout(r, 2000));

    // Script to enter demo and click all views including workspace tabs
    const checkScript = `
      (async () => {
        // 1. Enter demo mode
        const demoBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Explore Demo'));
        if (demoBtn) {
          demoBtn.click();
          await new Promise(r => setTimeout(r, 1200));
        }

        // Helper to click by text
        const clickButton = async (text) => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent && b.textContent.includes(text)) || b.getAttribute('aria-label') === text);
          if (btn) {
            console.log('>>> CLICKING:', text);
            btn.click();
            await new Promise(r => setTimeout(r, 1200));
            return true;
          }
          return false;
        };

        // Click through all main nav items
        const mainViews = [
          'Overview',
          'Current Capture',
          'Agent Activity',
          'Saved Pages',
          'Task History',
          'My Workspace',
          'Automations',
          'Approvals',
          'Notifications',
          'Connected Accounts',
          'Observability',
          'Settings'
        ];

        for (const view of mainViews) {
          await clickButton(view);

          // Sub-tabs in Task History
          if (view === 'Task History') {
            await clickButton('Conversation History');
            await clickButton('Agent Task Runs');
          }

          // Sub-tabs in My Workspace
          if (view === 'My Workspace') {
            for (const tab of ['Knowledge Base', 'Writing Studio', 'Ask AI', 'Collections']) {
              await clickButton(tab);
            }
          }
        }
      })()
    `;

    ws.send(
      JSON.stringify({
        id: 10,
        method: "Runtime.evaluate",
        params: { expression: checkScript, awaitPromise: true },
      }),
    );

    await new Promise((r) => setTimeout(r, 25000));
    console.log("\n==============================================");
    console.log("=== TOTAL CAUGHT ERRORS/EXCEPTIONS:", caught.length, "===");
    console.log("==============================================");
    if (caught.length > 0) {
      console.log("Details:", caught);
      process.exitCode = 1;
    } else {
      console.log("ALL VIEWS AND TABS PASSED WITH 0 RUNTIME ERRORS!");
      process.exitCode = 0;
    }
    ws.close();
  } catch (err) {
    console.error("Runner Error:", err);
    process.exitCode = 1;
  } finally {
    proc.kill("SIGKILL");
    try {
      fs.rmSync(tempProfileDir, { recursive: true, force: true });
    } catch {}
  }
}, 2500);
