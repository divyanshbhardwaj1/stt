// vitest/config rather than vite: same defineConfig, plus the `test` block.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Built into `dist/`, which src/api/app.py serves when it is present. During
// development `npm run dev` serves the app on 5173 and proxies the API to the
// FastAPI process on 8000, so both halves reload independently.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
  },
  build: {
    outDir: "dist",
    // The report tables and the recorder are the whole app; there is nothing
    // worth code-splitting, and one file keeps the FastAPI mount trivial.
    chunkSizeWarningLimit: 900,
  },
});
