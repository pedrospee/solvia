import { defineConfig } from "vitest/config";

// One root config; each workspace is a Vitest project (`vitest run --project core`).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "core",
          root: "packages/core",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "contracts",
          root: "packages/contracts",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "backend",
          root: "backend",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        // The UI's own Vite config (React plugin), with a DOM to render into.
        extends: "./frontend/vite.config.ts",
        test: {
          name: "frontend",
          root: "frontend",
          include: ["src/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["src/test-setup.ts"],
          // The in-process API (ADR-0005, D10) runs as Node runs it, not transformed for the
          // browser: Vite would turn its `new URL(..., import.meta.url)` into an asset URL.
          server: { deps: { external: [/\/backend\/src\//] } },
        },
      },
    ],
  },
});
