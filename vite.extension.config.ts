import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [react(), tailwindcss(), tsconfigPaths()],
  resolve: {
    alias: {
      "@tanstack/react-start/server": path.resolve(
        __dirname,
        "./src/lib/tanstack-start-server-shim.ts",
      ),
      "@tanstack/react-start": path.resolve(__dirname, "./src/lib/tanstack-start-shim.ts"),
      "@/lib/auth.functions": path.resolve(__dirname, "./src/lib/auth.extension.ts"),
      "@/lib/auth.server": path.resolve(__dirname, "./src/lib/auth.browser-shim.ts"),
      "@/lib/google/oauth.server": path.resolve(
        __dirname,
        "./src/lib/google/oauth.browser-shim.ts",
      ),
      "@/lib/google/crypto.server": path.resolve(
        __dirname,
        "./src/lib/google/oauth.browser-shim.ts",
      ),
      "@/lib/google/adapter.server": path.resolve(
        __dirname,
        "./src/lib/google/oauth.browser-shim.ts",
      ),
      "@/lib/reminders/service.server": path.resolve(
        __dirname,
        "./src/lib/google/oauth.browser-shim.ts",
      ),
      "@/lib/history.server": path.resolve(__dirname, "./src/lib/google/oauth.browser-shim.ts"),
      "@/lib/local-db.server": path.resolve(__dirname, "./src/lib/local-db.browser-shim.ts"),
      "@/lib/rag.server": path.resolve(__dirname, "./src/lib/rag.browser-shim.ts"),
      "node:url": path.resolve(__dirname, "./src/lib/node-empty-shim.ts"),
      "node:fs": path.resolve(__dirname, "./src/lib/node-empty-shim.ts"),
      "node:path": path.resolve(__dirname, "./src/lib/node-empty-shim.ts"),
      url: path.resolve(__dirname, "./src/lib/node-empty-shim.ts"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    "process.env": {},
  },
  base: "./",
  build: {
    outDir: "dist-extension",
    emptyOutDir: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      input: {
        sidepanel: path.resolve(__dirname, "sidepanel.html"),
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
        manualChunks(id) {
          // Split heavy vendor libraries into separate cacheable chunks.
          // NOTE: pdfjs-dist is kept in the main bundle because the extension
          // test harness loads the bundle via file:// protocol, which does not
          // support cross-chunk dynamic import resolution.
          if (id.includes("node_modules/mermaid") || id.includes("node_modules/cytoscape"))
            return "vendor-diagrams";
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3"))
            return "vendor-charts";
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/"))
            return "vendor-react";
          if (id.includes("node_modules/@radix-ui")) return "vendor-radix";
          if (id.includes("node_modules/@supabase")) return "vendor-supabase";
          if (id.includes("node_modules/shiki") || id.includes("node_modules/@shikijs"))
            return "vendor-syntax";
        },
      },
    },
  },
});
