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
    rollupOptions: {
      input: {
        sidepanel: path.resolve(__dirname, "sidepanel.html"),
      },
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
});
