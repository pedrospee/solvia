# ADR-0001: Monorepo with npm workspaces

- **Status:** Accepted
- **Date:** 2026-09-27
- **Phase:** 2A

## Context

Until Phase 1, Solvia was a single npm package: the financial core in `src/core`, configuration in
`src/infrastructure` and a bootstrap in `src/main.ts`. The core's purity (no database, HTTP, UI
or Node APIs) was a convention, enforced only by review.

Phase 2 adds a backend (Hono, Drizzle, SQLite) and a React frontend. Both need the financial core,
and the frontend must never pull in server code. Inspired by the backend/frontend split of the
Securo project, we want separate packages with explicit dependencies between them, while
keeping one repository, one lockfile and one `npm run check`.

## Decision

Use **npm workspaces**:

```text
packages/core   @solvia/core      pure financial core, zero runtime dependencies
backend         @solvia/backend   configuration and bootstrap; API and persistence from Phase 2B
```

- Shared tooling stays at the root: `tsconfig.base.json`, `biome.json`, one `vitest.config.ts`
  with a Vitest project per workspace, and the development dependencies.
- Each workspace declares only its own runtime dependencies (`zod` belongs to the backend).
- `@solvia/core` exposes its public API only through `src/index.ts`; other workspaces import
  `@solvia/core`, never deep paths.
- `@solvia/core` compiles without Node types (`"types": []`), so using `process` or `node:*`
  in the core fails the typecheck.

### How the backend loads `@solvia/core`

The core's `package.json` points `exports` straight at `./src/index.ts`, with no build step.

This works because npm links a workspace into `node_modules` as a symlink, and Node resolves the
symlink to its real path (`packages/core/src/index.ts`) before deciding whether to strip types.
Type stripping skips files under `node_modules`, but that real path is outside it. TypeScript
follows the same link for typechecking, and `tsc` on the backend emits only the backend's own
files.
- `npm run dev` runs the backend source and restarts when a core file changes.
- `npm run build && npm start` runs the compiled backend, which loads the core source through type
  stripping.

We considered conditional exports instead (`development` → `src`, `default` → compiled `dist`).
That gives a fully compiled production artifact, but it needs `customConditions` in TypeScript,
`--conditions` in Node, `resolve.conditions` in Vitest, and a build order where the core compiles
before the backend. The core is never published and the app runs locally on Node 24, so we chose
the simpler option. Switching later only touches the core's `package.json` and the scripts.

## Alternatives considered

| Option                    | Why not now                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Keep a single package** | Simplest, but core purity stays a convention, and the frontend (Phase 2C) would share one `package.json` and dependency list with the server.                         |
| **pnpm workspaces**       | Stricter dependency isolation and faster installs, but it is another tool to install and learn. npm already ships with Node and handles two or three workspaces well. |
| **Turborepo (or Nx)**     | Task caching and dependency-aware pipelines pay off with many packages and slow builds. We have two small workspaces and a check that runs in seconds.                |

## Consequences

- Package boundaries are explicit, and core purity is checked by the compiler.
- Commands run from the root (`npm run check`, `npm run dev`); a single workspace is targeted with
  `--workspace` (`-w`), or `vitest run --project <name>` for tests.
- New workspaces (`packages/contracts`, `frontend/`) are added to the root `workspaces` list and
  to `vitest.config.ts` when a phase needs them.
- In production the core runs from TypeScript source through Node type stripping. This relies on
  erasable-only syntax, which the project already enforces with `erasableSyntaxOnly`.
- If the project ever needs pnpm, Turborepo or a compiled core, it will be recorded in a new ADR.
