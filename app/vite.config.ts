import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// TAURI_DEV_HOST is set by `tauri android dev` so the phone can reach the dev server.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 5174 } : undefined,
    // Shared data (lexicon, demo data) lives one level up in ../data.
    fs: { allow: [".."] },
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // Pre-bundle up front so the dev server never reloads mid-setup on first use.
  optimizeDeps: { include: ["@huggingface/transformers"] },
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
});
