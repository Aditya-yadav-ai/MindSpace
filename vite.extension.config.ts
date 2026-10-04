import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    prerender: {
      enabled: true,
      crawlLinks: false,
      failOnError: true,
      pages: ["/"],
    },
    server: { entry: "server" },
  },
});