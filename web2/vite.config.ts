import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: Vite serves the SPA on :3001 and proxies /api to the Hono API on :4001.
// Prod: `npm start` serves dist/ + API from a single Hono server on :3001.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    proxy: {
      "/api": "http://127.0.0.1:4001",
    },
  },
  build: {
    outDir: "dist",
  },
});
