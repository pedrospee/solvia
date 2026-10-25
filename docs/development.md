# Development

## Requirements

- **Node.js 24 LTS** (`.nvmrc`). With nvm: `nvm use`. With Homebrew: `brew install node@24`, then put `/opt/homebrew/opt/node@24/bin` first on `PATH` (or `brew link --overwrite node@24`).
- **Gitleaks** (`brew install gitleaks`): the pre-commit hook blocks commits without it.

## Setup

```sh
npm install            # also enables the Git hooks (core.hooksPath = .githooks)
cp .env.example .env   # then set DATABASE_PATH and BACKUP_DIR; never commit .env
npm run db:migrate     # creates the database and applies the migrations
npm run dev            # API on http://127.0.0.1:3000
```

The `.env` file lives at the repository root; the backend and its scripts read it from there.
`DATABASE_PATH` and `BACKUP_DIR` are required absolute paths **outside the repository**.

## Repository layout

An npm workspaces monorepo ([ADR-0001](adr/0001-monorepo-with-npm-workspaces.md)):

| Workspace            | Package             | Contents                                                    |
| -------------------- | ------------------- | ----------------------------------------------------------- |
| `packages/core`      | `@solvia/core`      | Pure financial core; public API in `src/index.ts`           |
| `packages/contracts` | `@solvia/contracts` | Zod schemas of the API's JSON requests and responses        |
| `backend`            | `@solvia/backend`   | HTTP API (Hono), use cases and SQLite persistence (Drizzle) |

Development tools (TypeScript, Vitest, Biome, `@types/node`) are root development dependencies. Runtime dependencies are declared in the workspace that uses them.

## Scripts

Run from the repository root:

| Script                              | What it does                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| `npm run check`                     | typecheck + lint + tests across all workspaces — **run before every commit**          |
| `npm test` / `npm run test:watch`   | Vitest once / in watch mode, every workspace                                          |
| `npm run lint` / `npm run lint:fix` | Biome check / apply safe fixes and formatting                                         |
| `npm run typecheck`                 | TypeScript without emitting, per workspace                                            |
| `npm run dev`                       | Runs the API from source on `127.0.0.1`, restarting when backend or core files change |
| `npm run build` / `npm start`       | Compile the backend to `backend/dist/` / run the compiled app                         |
| `npm run db:migrate`                | Applies pending migrations; backs up an existing database first                       |
| `npm run db:generate`               | Generates a new migration after a schema change                                       |
| `npm run secrets:scan`              | Gitleaks scan of the whole Git history                                                |

### Working with one workspace

```sh
npm run typecheck -w @solvia/core        # a script of one workspace
npx vitest run --project core            # tests of one workspace (core | contracts | backend)
npm install <pkg> -w @solvia/backend     # add a dependency to one workspace (document why first)
```

`@solvia/core` has no build step: its `exports` points at `src/index.ts` and Node runs it through type stripping, in development and in production ([ADR-0001](adr/0001-monorepo-with-npm-workspaces.md)).

## Database

SQLite through Drizzle ([ADR-0002](adr/0002-persistence-with-sqlite-and-drizzle.md)).
- **The server never changes the schema.** `npm run dev` and `npm start` refuse to start when the
  database does not exist or has pending migrations, and ask you to run `npm run db:migrate`.
- **`npm run db:migrate`** is the only schema-changing operation. When an existing database has
  pending migrations, it first writes a verified backup to `BACKUP_DIR`; a new database or an
  up-to-date one is not backed up.
- **Changing the schema:** edit `backend/src/infrastructure/database/schema/`, run
  `npm run db:generate`, commit the generated migration, then run `npm run db:migrate`.
  Committed migrations are never edited. CI fails when the schema and the migrations differ.
- Integer columns use `bigintInteger` (never Drizzle's `integer()`), so money stays `bigint`.

## Conventions

- Code, identifiers, files and docs in English.
- Import the core as `@solvia/core`, never through a deep path. New public functions are added to `packages/core/src/index.ts`.
- The core compiles without Node types; `process`, `Buffer` and `node:*` modules are not available there.
- Relative imports use the `.ts` extension; the build rewrites them to `.js`.
- Erasable TypeScript only: no `enum`, `namespace` or parameter properties. Use `as const` arrays and union types.
- `import type` for type-only imports.
- Money is never a `number`. Parse user amounts with `moneyFromDecimal`.
- Domain failures throw `DomainError` with a stable `code`.
- Tests live next to the code (`*.test.ts`); reference the rule ID (`BR-xx`) in the `describe` name when a test covers a business rule.
- Test data comes from fictitious fixtures (`test-fixtures.ts`) and is excluded from the build.

## Workflow

1. Understand the problem → write the rule in [business-rules.md](business-rules.md).
2. Implement the core rule with tests; then application, infrastructure and UI.
3. `npm run check` passes.
4. Mark the rule ✅ with its test file.
5. Small conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`, `build:`, `ci:`. A file move never shares a commit with content edits, except the path fixes the move requires. Moves use `git mv`.

Significant architecture decisions are recorded as an ADR in [adr/](adr/).

A feature is done when it is implemented, tested, validated, handles errors, is documented and breaks nothing.
