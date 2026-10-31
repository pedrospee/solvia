import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// The API's port comes from the repository's .env, the one the backend reads.
const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig(({ mode }) => {
  const { PORT = "3000" } = loadEnv(mode, REPOSITORY_ROOT, "PORT");

  return {
    plugins: [react()],
    build: {
      // One chunk, mostly React DOM and Zod (the contracts' schemas, ADR-0005 D6), loaded from
      // the loopback address: code splitting would buy nothing yet.
      chunkSizeWarningLimit: 1024,
    },
    server: {
      // Loopback only, like the API. Vite keeps its own Host check (server.allowedHosts).
      host: "127.0.0.1",
      // DEV_UI_PORT in backend/src/http/local-request-guard.ts: the API accepts this origin
      // in development only (ADR-0005, D2).
      port: 5173,
      strictPort: true,
      proxy: {
        // changeOrigin sets Host to the API's. Origin is forwarded unchanged on purpose:
        // rewriting it would let any site through this proxy (docs/security.md).
        "/api": { target: `http://127.0.0.1:${PORT}`, changeOrigin: true },
      },
    },
  };
});
