import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const distExt = path.resolve("dist-extension");
const sidepanelUrl = "file:///" + path.join(distExt, "sidepanel.html").replace(/\\/g, "/");
const tempProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindspace-cdp-click-"));

const proc = spawn(chromePath, [
  "--remote-debugging-port=9243",
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
        .get("http://127.0.0.1:9243/json", (r) => {
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

    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === "Runtime.consoleAPICalled") {
        const text = msg.params.args
          .map((a) => a.value || a.description || JSON.stringify(a))
          .join(" ");
        console.log("[BROWSER CONSOLE]", msg.params.type, text);
      }
      if (msg.method === "Runtime.exceptionThrown") {
        console.error(
          "[BROWSER EXCEPTION]",
          msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails,
        );
      }
    });

    await new Promise((r) => setTimeout(r, 2000));

    // Click "Explore Demo" to enter the app
    const demoScript = `
      (async () => {
        const demoBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Explore Demo'));
        if (demoBtn) {
          console.log('>>> CLICKING EXPLORE DEMO...');
          demoBtn.click();
          await new Promise(r => setTimeout(r, 2000));
        }

        const btnsAfter = Array.from(document.querySelectorAll('button')).map((b, i) => i + ': text=\"' + b.textContent?.trim() + '\" title=\"' + (b.getAttribute('title') || '') + '\" aria=\"' + (b.getAttribute('aria-label') || '') + '\"');
        console.log('BUTTONS AFTER DEMO (' + btnsAfter.length + '):', JSON.stringify(btnsAfter));

        // Now iterate and click all nav items
        const navLabels = ['Overview', 'Current capture', 'Ask MindSpace', 'Writing studio', 'Tasks', 'Knowledge', 'History', 'Automations', 'Settings', 'Connected accounts', 'Agent activity'];
        for (const label of navLabels) {
          const btns = Array.from(document.querySelectorAll('button'));
          const btn = btns.find(b => {
            const txt = b.textContent?.toLowerCase() || '';
            const title = b.getAttribute('title')?.toLowerCase() || '';
            const aria = b.getAttribute('aria-label')?.toLowerCase() || '';
            const target = label.toLowerCase();
            return txt.includes(target) || title.includes(target) || aria.includes(target);
          });
          if (btn) {
            console.log('>>> CLICKING NAV:', label);
            btn.click();
            await new Promise(r => setTimeout(r, 2000));
          } else {
            console.log('--- NAV NOT FOUND:', label);
          }
        }
      })()
    `;
    ws.send(
      JSON.stringify({
        id: 20,
        method: "Runtime.evaluate",
        params: { expression: demoScript, awaitPromise: true },
      }),
    );

    await new Promise((r) => setTimeout(r, 30000));
    ws.close();
  } catch (err) {
    console.error("Error:", err);
  } finally {
    proc.kill("SIGKILL");
    try {
      fs.rmSync(tempProfileDir, { recursive: true, force: true });
    } catch {}
  }
}, 2500);
