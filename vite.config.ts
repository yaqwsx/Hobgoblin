import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: Number(process.env.HOBGOBLIN_DEV_PORT ?? 1420),
    strictPort: process.env.HOBGOBLIN_STRICT_PORT === "1",
  },
  envPrefix: ["VITE_", "TAURI_"],
});
