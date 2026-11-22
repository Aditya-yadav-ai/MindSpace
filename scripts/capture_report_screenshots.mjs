/**
 * Automated Screenshot Capturer for MindSpace Academic Report Evidence.
 * Connects directly to Google Chrome via Chrome DevTools Protocol (CDP),
 * navigates through the live application on http://localhost:8080 and dist-extension,
 * and saves genuine screenshots into docs/report-evidence/.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { spawn } from "node:child_process";

const ROOT_DIR = process.cwd();
const EVIDENCE_DIR = path.join(ROOT_DIR, "docs", "report-evidence");
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = 9265;

if (!fs.existsSync(EVIDENCE_DIR)) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getCDPTarget() {
  for (let i = 0; i < 20; i++) {
    try {
      const data = await new Promise((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${CDP_PORT}/json`, (res) => {
            let str = "";
            res.on("data", (chunk) => (str += chunk));
            res.on("end", () => resolve(JSON.parse(str)));
          })
          .on("error", reject);
      });
      const page = data.find((d) => d.type === "page");
      if (page) return page;
    } catch {}
    await sleep(500);
  }
  throw new Error("Could not find active CDP page target");
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve);
      this.ws.addEventListener("error", reject);
    });

    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }

  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res.result?.value;
  }

  async screenshot(filePath, clip = null) {
    const params = { format: "png" };
    if (clip) params.clip = clip;
    const res = await this.send("Page.captureScreenshot", params);
    const buf = Buffer.from(res.data, "base64");
    fs.writeFileSync(filePath, buf);
    console.log(`  ✔ Captured: ${path.basename(filePath)} (${(buf.length / 1024).toFixed(1)} KB)`);
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function captureAll() {
  console.log("================================================================================");
  console.log("  MINDSPACE LIVE EVIDENCE SCREENSHOT CAPTURER");
  console.log("================================================================================\n");

  const tempProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), "mindspace-report-shots-"));
  const chromeArgs = [
    `--remote-debugging-port=${CDP_PORT}`,
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--allow-file-access-from-files",
    "--disable-web-security",
    "--window-size=1440,960",
    `--user-data-dir=${tempProfileDir}`,
    "http://localhost:8080/",
  ];

  console.log("Launching headless Chrome on port", CDP_PORT, "...");
  const proc = spawn(CHROME_PATH, chromeArgs, { stdio: "ignore" });

  try {
    const target = await getCDPTarget();
    const cdp = new CDPClient(target.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 960,
      deviceScaleFactor: 1,
      mobile: false,
    });

    console.log("Waiting for Login screen to render...");
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const text = await cdp.evaluate("document.body.innerText");
      if (text && text.includes("Sign in to MindSpace")) {
        console.log(`Login screen ready (${(i + 1) * 0.5}s)`);
        break;
      }
    }
    await sleep(1000);

    // -------------------------------------------------------------------------
    // Screenshot 01: Login Screen
    // -------------------------------------------------------------------------
    console.log("\n[1/12] Capturing 01_login.png ...");
    await cdp.screenshot(path.join(EVIDENCE_DIR, "01_login.png"));

    // -------------------------------------------------------------------------
    // Screenshot 02: Signup Screen
    // -------------------------------------------------------------------------
    console.log("\n[2/12] Capturing 02_signup.png ...");
    await cdp.evaluate(`
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Create an account'));
      if (btn) btn.click();
    `);
    await sleep(1500);
    await cdp.screenshot(path.join(EVIDENCE_DIR, "02_signup.png"));

    // -------------------------------------------------------------------------
    // Screenshot 03: Main Dashboard / Overview (via Offline Demo)
    // -------------------------------------------------------------------------
    console.log("\n[3/12] Entering Offline Demo Mode and Capturing 03_dashboard.png ...");
    await cdp.evaluate(`
      const demoBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Explore Demo'));
      if (demoBtn) demoBtn.click();
    `);
    // Wait until workspace header renders
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const text = await cdp.evaluate("document.body.innerText");
      if (
        text &&
        (text.includes("Good day") || text.includes("Overview") || text.includes("Quick Actions"))
      ) {
        console.log(`Workspace loaded (${(i + 1) * 0.5}s)`);
        break;
      }
    }
    await sleep(1500);
    await cdp.screenshot(path.join(EVIDENCE_DIR, "03_dashboard.png"));

    // Helper function to click sidebar navigation items
    async function clickNav(label) {
      const debug = await cdp.evaluate(`
        (() => {
          const btns = Array.from(document.querySelectorAll('nav button, aside button, button'));
          const matches = btns.map(b => ({
            text: b.textContent?.trim().replace(/\\s+/g, ' '),
            aria: b.getAttribute('aria-label'),
            title: b.getAttribute('title')
          }));
          const target = btns.find(b => {
            const t = b.textContent?.trim().replace(/\\s+/g, ' ') || '';
            return t.includes('${label}') || b.getAttribute('aria-label') === '${label}' || b.getAttribute('title') === '${label}';
          });
          if (target) {
            target.scrollIntoView({ block: 'center' });
            target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            target.click();
            return { success: true, clicked: target.textContent?.trim() };
          }
          return { success: false, available: matches.slice(0, 15) };
        })()
      `);
      console.log(`  -> clickNav('${label}'):`, JSON.stringify(debug));
      await sleep(2000);
    }

    // -------------------------------------------------------------------------
    // Screenshot 05: Current Capture / Page Context
    // -------------------------------------------------------------------------
    console.log("\n[4/12] Navigating to Current Capture and Capturing 05_page_context.png ...");
    await clickNav("Current Capture");
    await cdp.screenshot(path.join(EVIDENCE_DIR, "05_page_context.png"));

    // -------------------------------------------------------------------------
    // Screenshot 06: Screenshot Workflow & Multimodal Analysis
    // -------------------------------------------------------------------------
    console.log("\n[5/12] Capturing 06_screenshot_workflow.png ...");
    await cdp.evaluate(`
      const planBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Supervisor Architecture Plan'));
      if (planBtn) planBtn.click();
      const main = document.querySelector('main');
      if (main) main.scrollTo(0, 300);
    `);
    await sleep(1000);
    await cdp.screenshot(path.join(EVIDENCE_DIR, "06_screenshot_workflow.png"));
    await cdp.evaluate(`
      const main = document.querySelector('main');
      if (main) main.scrollTo(0, 0);
    `);

    // -------------------------------------------------------------------------
    // Screenshot 08: Agent Activity
    // -------------------------------------------------------------------------
    console.log("\n[6/12] Navigating to Agent Activity and Capturing 08_agent_activity.png ...");
    await clickNav("Agent Activity");
    await cdp.screenshot(path.join(EVIDENCE_DIR, "08_agent_activity.png"));

    // -------------------------------------------------------------------------
    // Screenshot 07: PDF Upload & Analysis (in My Workspace)
    // -------------------------------------------------------------------------
    console.log("\n[7/12] Navigating to My Workspace and Capturing 07_pdf_analysis.png ...");
    await clickNav("My Workspace");
    await cdp.screenshot(path.join(EVIDENCE_DIR, "07_pdf_analysis.png"));

    // -------------------------------------------------------------------------
    // Screenshot 09: Writing Studio & Content Synthesis (in My Workspace)
    // -------------------------------------------------------------------------
    console.log(
      "\n[8/12] Switching to Writing Studio in Workspace and Capturing 09_rag_results.png ...",
    );
    await cdp.evaluate(`
      const tabs = Array.from(document.querySelectorAll('button')).filter(b => b.textContent && b.textContent.includes('Writing Studio'));
      if (tabs.length > 0) tabs[0].click();
    `);
    await sleep(1500);
    await cdp.screenshot(path.join(EVIDENCE_DIR, "09_rag_results.png"));

    // -------------------------------------------------------------------------
    // Screenshot 10: Connected Accounts Overview
    // -------------------------------------------------------------------------
    console.log(
      "\n[9/12] Navigating to Connected Accounts and Capturing 10_connected_accounts.png ...",
    );
    await clickNav("Connected Accounts");
    await cdp.screenshot(path.join(EVIDENCE_DIR, "10_connected_accounts.png"));

    // -------------------------------------------------------------------------
    // Screenshot 11: 14 Google Services Matrix (Filtered to Productivity Category)
    // -------------------------------------------------------------------------
    console.log("\n[10/12] Selecting Productivity Filter and Capturing 11_google_services.png ...");
    await cdp.evaluate(`
      const prodBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Productivity'));
      if (prodBtn) prodBtn.click();
    `);
    await sleep(1200);
    await cdp.screenshot(path.join(EVIDENCE_DIR, "11_google_services.png"));
    await cdp.evaluate(`
      const allBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('All (14)'));
      if (allBtn) allBtn.click();
    `);

    // -------------------------------------------------------------------------
    // Screenshot 12: Offline Mode Banner & Local Heuristics
    // -------------------------------------------------------------------------
    console.log("\n[11/12] Capturing 12_offline_mode.png ...");
    await clickNav("Overview");
    await sleep(1000);
    await cdp.screenshot(path.join(EVIDENCE_DIR, "12_offline_mode.png"));

    // -------------------------------------------------------------------------
    // Screenshot 04: Browser Extension Side Panel
    // -------------------------------------------------------------------------
    console.log(
      "\n[12/12] Loading dist-extension/sidepanel.html and Capturing 04_browser_sidepanel.png ...",
    );
    const sidepanelPath = path.join(ROOT_DIR, "dist-extension", "sidepanel.html");
    const sidepanelUrl = "file:///" + sidepanelPath.replace(/\\/g, "/");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 440,
      height: 850,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send("Page.navigate", { url: sidepanelUrl });
    // Wait until sidepanel React mounts
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const text = await cdp.evaluate("document.body.innerText");
      if (
        text &&
        (text.includes("MindSpace") ||
          text.includes("Capture") ||
          text.includes("Assistant") ||
          text.includes("Sign in"))
      ) {
        console.log(`Sidepanel ready (${(i + 1) * 0.5}s)`);
        break;
      }
    }
    await sleep(1500);
    await cdp.screenshot(path.join(EVIDENCE_DIR, "04_browser_sidepanel.png"));

    cdp.close();
    console.log("\nAll 12 evidence screenshots captured successfully into docs/report-evidence/!");
  } finally {
    proc.kill("SIGKILL");
    try {
      fs.rmSync(tempProfileDir, { recursive: true, force: true });
    } catch {}
  }
}

captureAll()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Screenshot capture failed:", err);
    process.exit(1);
  });
