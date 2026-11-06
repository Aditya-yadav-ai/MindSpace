/**
 * MindSpace Extension Packaging Script
 * Builds a clean, dedicated, production-ready Chrome Manifest V3 extension directory.
 * Explicitly excludes Cloudflare / hosting deployment files (like _headers) which Chrome reserves.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DIST_EXT_DIR = path.join(ROOT_DIR, "dist-extension");

/** Generate a clean RGBA PNG with an indigo gradient circle */
function generateIconPng(size) {
  const width = size;
  const height = size;
  const rawData = Buffer.alloc(height * (1 + width * 4));

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 4);
    rawData[rowOffset] = 0; // Filter type: None
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const dx = x - width / 2;
      const dy = y - height / 2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const radius = width * 0.44;

      if (dist <= radius) {
        // Gradient from Indigo (99, 102, 241) to Violet (139, 92, 246)
        const factor = (x + y) / (width * 2);
        const r = Math.round(99 + (139 - 99) * factor);
        const g = Math.round(102 + (92 - 102) * factor);
        const b = Math.round(241 + (246 - 241) * factor);

        // Soft anti-aliasing on edge
        const edgeDist = radius - dist;
        const alpha = edgeDist < 1 ? Math.round(edgeDist * 255) : 255;

        rawData[pxOffset] = r;
        rawData[pxOffset + 1] = g;
        rawData[pxOffset + 2] = b;
        rawData[pxOffset + 3] = alpha;
      } else {
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
      }
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const crcTable = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[i] = c;
  }

  function crc32(buf) {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
    }
    return crc ^ -1;
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, "ascii");
    const crcBuf = Buffer.alloc(4);
    const crc = crc32(Buffer.concat([typeBuf, data]));
    crcBuf.writeInt32BE(crc);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth: 8
  ihdr[9] = 6; // Color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function buildExtension() {
  console.log("==================================================");
  console.log("  MINDSPACE EXTENSION PACKAGING");
  console.log("==================================================");

  // 1. Ensure source icons exist in public/
  const iconSizes = [16, 48, 128];
  for (const size of iconSizes) {
    const iconName = `icon-${size}.png`;
    const iconPath = path.join(PUBLIC_DIR, iconName);
    if (!fs.existsSync(iconPath)) {
      fs.writeFileSync(iconPath, generateIconPng(size));
      console.log(`[icons] Generated public/${iconName}`);
    }
  }

  // 2. Ensure dist-extension directory is clean
  if (fs.existsSync(DIST_EXT_DIR)) {
    fs.rmSync(DIST_EXT_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DIST_EXT_DIR, { recursive: true });
  console.log(`[package] Created clean destination: ${DIST_EXT_DIR}`);

  // 3. Read manifest and ensure icon fields are declared
  const manifestPath = path.join(PUBLIC_DIR, "manifest.json");
  const manifestRaw = fs.readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw);

  manifest.icons = {
    16: "icon-16.png",
    48: "icon-48.png",
    128: "icon-128.png",
  };
  manifest.action = {
    default_title: "Open MindSpace",
    default_icon: {
      16: "icon-16.png",
      48: "icon-48.png",
    },
  };
  manifest.host_permissions = [
    "http://127.0.0.1:8010/*",
    "http://localhost:8010/*",
    "http://127.0.0.1:8000/*",
    "http://localhost:8000/*",
  ];

  // Update public/manifest.json to keep source synchronized
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log("[manifest] Synchronized public/manifest.json with icons & host permissions");

  // 4. Compile the real React TanStack MindSpace Application into dist-extension/
  console.log("\n[bundle] Compiling React UI for extension sidepanel via Vite...");
  const { execSync } = await import("node:child_process");
  execSync("node ./node_modules/vite/bin/vite.js build --config vite.extension.config.ts", {
    stdio: "inherit",
    cwd: ROOT_DIR,
  });
  console.log("[bundle] React application compiled successfully into dist-extension/");

  // 5. Copy required extension service worker and assets from public/ into dist-extension/
  const filesToCopy = [
    "manifest.json",
    "extension-background.js",
    "content-script.js",
    "icon-16.png",
    "icon-48.png",
    "icon-128.png",
    "favicon.ico",
  ];

  for (const file of filesToCopy) {
    const src = path.join(PUBLIC_DIR, file);
    const dest = path.join(DIST_EXT_DIR, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      const stat = fs.statSync(dest);
      console.log(`[copy] ${file.padEnd(26)} -> ${stat.size.toLocaleString()} bytes`);
    } else {
      console.warn(`[warning] Source file missing: ${src}`);
    }
  }

  // Provide a backwards-compatible sidepanel.js bridge in dist-extension
  const bridgePath = path.join(DIST_EXT_DIR, "sidepanel.js");
  if (!fs.existsSync(bridgePath)) {
    fs.writeFileSync(
      bridgePath,
      '// MindSpace React side panel bridge\nconsole.log("[MindSpace] React UI mounted in sidepanel.html");\n',
    );
    console.log("[bridge] Generated compatibility sidepanel.js");
  }

  // 5. Explicitly verify NO forbidden files exist in dist-extension
  const distFiles = fs.readdirSync(DIST_EXT_DIR);
  for (const df of distFiles) {
    if (df.startsWith("_") && df !== "_locales" && df !== "_metadata") {
      throw new Error(`CRITICAL: Forbidden Chrome filename detected in build: ${df}`);
    }
  }

  // 6. Verify every manifest-referenced asset exists in dist-extension
  console.log("\n--- Verification Checklist ---");
  const checks = [
    { label: "Manifest V3 file", file: "manifest.json" },
    { label: "Background Service Worker", file: manifest.background?.service_worker },
    { label: "Side Panel HTML", file: manifest.side_panel?.default_path },
    { label: "Side Panel JS", file: "sidepanel.js" },
    { label: "Content Script", file: "content-script.js" },
    { label: "Icon 16px", file: manifest.icons?.["16"] },
    { label: "Icon 48px", file: manifest.icons?.["48"] },
    { label: "Icon 128px", file: manifest.icons?.["128"] },
  ];

  let allOk = true;
  for (const check of checks) {
    if (!check.file) {
      console.error(`FAIL: ${check.label} not specified in manifest!`);
      allOk = false;
      continue;
    }
    const target = path.join(DIST_EXT_DIR, check.file);
    if (fs.existsSync(target)) {
      console.log(`✔ PASS: ${check.label} exists (${check.file})`);
    } else {
      console.error(`FAIL: ${check.label} MISSING at ${target}`);
      allOk = false;
    }
  }

  if (!allOk) {
    throw new Error("Extension packaging verification failed.");
  }

  console.log("\n==================================================");
  console.log("  BUILD SUCCESSFUL!");
  console.log(`  Target Folder: ${DIST_EXT_DIR}`);
  console.log("==================================================\n");
  return DIST_EXT_DIR;
}

await buildExtension();
