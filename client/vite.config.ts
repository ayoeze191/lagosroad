import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // host: true exposes the dev server on your LAN so you can open it on your phone.
  server: { host: true },
  preview: { host: true },
  build: { target: "es2020", chunkSizeWarningLimit: 1200 }
});
