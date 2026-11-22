// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    // Pre-bundle heavy dependencies so the SSR module runner does not time out
    // while waiting for the initial dependency optimization crawl to finish.
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react-dom/client",
        "@tanstack/react-router",
        "@tanstack/react-query",
        "@supabase/supabase-js",
        "recharts",
        "lucide-react",
        "motion",
        "pdfjs-dist",
        "clsx",
        "tailwind-merge",
        "zod",
        "sonner",
        "date-fns",
        "cmdk",
        "nanoid",
        "ai",
      ],
    },
    ssr: {
      // Externalise heavy SSR deps to avoid bundling them into the module runner
      optimizeDeps: {
        include: [
          "react",
          "react-dom",
          "react/jsx-runtime",
          "@tanstack/react-router",
          "@tanstack/react-query",
        ],
      },
    },
  },
});
