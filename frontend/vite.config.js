import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The Flask backend runs on 5001 (macOS reserves 5000). In development Vite proxies /api to it,
// so the browser only ever talks to one origin. React reaches Python only through this HTTP API.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:5001" },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/__tests__/setup.js",
    css: false,
  },
});
