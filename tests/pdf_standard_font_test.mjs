import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

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

test("PDF.js Standard Fonts & Extraction Verification", async (t) => {
  const publicFontsDir = path.resolve("public/standard_fonts");
  const publicCmapsDir = path.resolve("public/cmaps");

  await t.test("public/standard_fonts directory contains essential standard font assets", () => {
    assert.ok(fs.existsSync(publicFontsDir), "public/standard_fonts must exist");
    const files = fs.readdirSync(publicFontsDir);
    assert.ok(files.includes("FoxitDingbats.pfb"), "Must contain FoxitDingbats.pfb");
    assert.ok(
      files.includes("LiberationSans-Regular.ttf"),
      "Must contain LiberationSans-Regular.ttf",
    );
    assert.ok(files.includes("FoxitFixed.pfb"), "Must contain FoxitFixed.pfb");
  });

  await t.test("public/cmaps directory contains CMap character maps", () => {
    assert.ok(fs.existsSync(publicCmapsDir), "public/cmaps must exist");
    const files = fs.readdirSync(publicCmapsDir);
    assert.ok(files.length > 50, "Must contain standard CMap files");
  });

  await t.test(
    "PDF.js extracts text from non-embedded standard-font PDF cleanly without warnings",
    async () => {
      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (...args) => {
        warnings.push(args.join(" "));
        originalWarn(...args);
      };

      try {
        // PDF.js requires a trailing forward slash for standardFontDataUrl & cMapUrl
        const fontsUrl = path.resolve("public/standard_fonts").replace(/\\/g, "/") + "/";
        const cmapsUrl = path.resolve("public/cmaps").replace(/\\/g, "/") + "/";
        const pdfBuffer = Buffer.from(MINIMAL_PDF, "utf-8");
        const loadingTask = pdfjs.getDocument({
          data: new Uint8Array(pdfBuffer),
          standardFontDataUrl: fontsUrl,
          cMapUrl: cmapsUrl,
          cMapPacked: true,
        });

        const doc = await loadingTask.promise;
        assert.equal(doc.numPages, 1);

        const page = await doc.getPage(1);
        const textContent = await page.getTextContent();
        const extracted = textContent.items
          .map((i) => i.str)
          .join(" ")
          .trim();
        assert.equal(extracted, "MindSpace Offline PDF Intelligence");

        const hasStandardFontWarning = warnings.some((w) =>
          w.includes("standardFontDataUrl API parameter is provided"),
        );
        assert.equal(
          hasStandardFontWarning,
          false,
          "Should not produce standardFontDataUrl warning when configured",
        );
      } finally {
        console.warn = originalWarn;
      }
    },
  );
});
