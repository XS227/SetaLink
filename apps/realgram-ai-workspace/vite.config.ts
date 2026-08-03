import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// RealGram AI Workspace — isolated Vite app. Dev server proxies /api to the
// local demo Express server so the browser never talks to Higgsfield (or any
// generation adapter) directly, keeping keys server-side.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4180,
    proxy: {
      "/api": {
        target: "http://localhost:4181",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/setupTests.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
