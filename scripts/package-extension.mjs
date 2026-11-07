import fs from "node:fs";
import path from "node:path";

const publicDir = path.join(process.cwd(), ".output", "public");
const htmlPath = path.join(publicDir, "index.html");
const assetsDir = path.join(publicDir, "assets");

if (!fs.existsSync(htmlPath)) {
  throw new Error(`Extension HTML was not generated: ${htmlPath}`);
}

fs.mkdirSync(assetsDir, { recursive: true });
let inlineScriptIndex = 0;
const html = fs
  .readFileSync(htmlPath, "utf8")
  .replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (tag, attributes, source) => {
    if (/\bsrc\s*=/.test(attributes)) {
      if (!/\btype=["']module["']/i.test(attributes)) return tag;
      const orderedAttributes = attributes.replace(/\sasync(?:=["'][^"']*["']|=[^\s>]+)?/i, "");
      return orderedAttributes === attributes
        ? tag
        : `<script${orderedAttributes}>${source}</script>`;
    }
    if (!source.trim()) return tag;

    const type = attributes.match(/\btype\s*=\s*["']?([^"'\s>]+)/i)?.[1];
    if (type && !["module", "text/javascript", "application/javascript"].includes(type)) {
      return tag;
    }

    const fileName = `extension-bootstrap-${inlineScriptIndex++}.js`;
    fs.writeFileSync(path.join(assetsDir, fileName), source);
    return `<script${attributes} src="/assets/${fileName}"></script>`;
  });

if (inlineScriptIndex === 0) {
  throw new Error("No inline bootstrap scripts were found to package.");
}

fs.writeFileSync(htmlPath, html);
console.log(`Packaged ${inlineScriptIndex} inline bootstrap script(s) for Chrome CSP.`);
