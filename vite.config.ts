import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const projectPath = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    fs: { allow: ["web", "node_modules", "data/demo_aggregates.json"].map(projectPath) },
    proxy: { "/api": "http://127.0.0.1:8001" },
  },
  build: { outDir: "../dist", emptyOutDir: true },
});
