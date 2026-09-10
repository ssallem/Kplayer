import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "site",
  base: "./",
  plugins: [react()],
  build: { outDir: "../site-dist", emptyOutDir: true },
  server: { host: "127.0.0.1", port: 4173 },
});
