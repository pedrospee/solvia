# Security

## Deployment assumption

- Single user, **localhost only**. The HTTP server listens on `127.0.0.1` only; the address is a
  constant, not a setting.
- **No authentication** in this configuration. This is an explicit, documented assumption.
- If the application is ever exposed on a network, or becomes multi-user/SaaS,
  authentication and authorization become mandatory before that change ships.

## Browsers on this machine

Binding to `127.0.0.1` keeps other machines out, but not a browser on this one. Any site open in it
can try to reach the API, so the server checks every request (`backend/src/http/local-request-guard.ts`):
- **DNS rebinding.** A malicious site can make its own domain resolve to `127.0.0.1`, and the
  browser then treats the API as that site, able to read and change data. Its requests still carry
  the site's `Host`, so any `Host` other than `127.0.0.1:PORT` or `localhost:PORT` is a 403
  `HOST_NOT_ALLOWED`, for every method and route.
- **CSRF.** Some requests, such as a `POST` without a body (archive, void), reach a server without
  a CORS preflight. A change (any method but `GET`, `HEAD` and `OPTIONS`) whose `Origin` is not the
  server's own is a 403 `ORIGIN_NOT_ALLOWED`. Requests with a body already need JSON
  (`Content-Type` check, ADR-0003), which a cross-site form cannot send.
- **No CORS headers.** The API never sends `Access-Control-Allow-*`, so a page from another origin
  cannot read any answer.
- **The UI (Phase 2C)** must reach the API from the server's own origin, for example through the
  Vite dev server's proxy, or its origin must be added deliberately, with a test.

## Data

- Only fictitious data in the repository: seed data, mocks and test fixtures.
- The real SQLite database lives **outside the repository**, at the path set in `.env`
  (`DATABASE_PATH`); backups go to `BACKUP_DIR`. Both must be absolute paths, so they can never be
  created relative to the repository by accident.
- Real data is entered only after persistence and backup exist (Phase 2).
- The database file is not encrypted by the application. Disk encryption (FileVault on
  macOS) must be enabled. SQLCipher may be evaluated in Phase 12.
- **Only the owner can read the data.** The database (with its WAL files), backups and exports are
  written as 600, in directories set to 700, whatever the process umask. Existing files and
  directories are tightened when the server opens the database or a script writes there
  (`backend/src/infrastructure/files/private-files.ts`).

## Never in the code or in Git

Passwords, bank credentials, API keys, tokens, IBANs, card numbers, CVVs, real statements,
real database files, backups or exports.

## Controls

| Control                                                                                                                                       | Where                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `.gitignore` blocks `.env*` (except `.env.example`), databases, `data/`, `personal-data/`, `financial-data/`, `backups/`, `exports/`, `logs/` | `.gitignore`                                        |
| Placeholder-only environment template                                                                                                         | `.env.example`                                      |
| Environment validated at startup; the app refuses to start on invalid config                                                                  | `backend/src/infrastructure/config/environment.ts`  |
| API errors never expose stack traces, SQL, file paths or internal details (500 is generic and logged)                                         | `backend/src/http/error-handler.ts`                 |
| Only the local server's `Host`; changes only from its `Origin` (DNS rebinding, CSRF)                                                          | `backend/src/http/local-request-guard.ts`           |
| Request bodies limited to 1 MB (413 `PAYLOAD_TOO_LARGE`), so no request can hold the server's memory                                          | `backend/src/http/app.ts`                           |
| Gitleaks scans staged changes before every commit; the commit is blocked if Gitleaks is missing                                               | `.githooks/pre-commit`, enabled by `npm install`    |
| Full-history scan on demand                                                                                                                   | `npm run secrets:scan`                              |
| Gitleaks scan on every push and pull request to `main`                                                                                        | `.github/workflows/ci.yml`                          |
| Database, backups and exports private to the owner (600 files, 700 directories)                                                               | `backend/src/infrastructure/files/private-files.ts` |
| Weekly dependency updates                                                                                                                     | `.github/dependabot.yml`                            |
| GitHub secret scanning + push protection                                                                                                      | Enable when the remote repository is created        |

## Accepted dependency risks

Known advisories that are not fixed yet, with the reason and the condition that ends the
acceptance. Reviewed when Dependabot proposes a related update.

| Advisory                                                                                                                                      | Path                                                                                   | Why it is accepted                                                                                                                                                                                                                                                       | Resolved by                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) (moderate): the esbuild dev server answers requests from any website | `drizzle-kit` → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → `esbuild` 0.18 | Development only: `drizzle-kit` runs in `npm run db:generate` and in CI, never in the server. It bundles the schema with esbuild and never starts the vulnerable dev server. `npm audit fix --force` would downgrade `drizzle-kit` to 0.18, which breaks the migrations. | `drizzle-kit` 1.0 stable, which has no `@esbuild-kit` dependency, upgraded together with `drizzle-orm` 1.0 in its own pull request, after slice 5 |

Accepted on 2026-10-25.

## Backups

- ✅ Automatic, verified backup before migrating an existing database (`npm run db:migrate`).
- ✅ Manual backup (`npm run db:backup`), restore with a verified `pre-restore` backup
  (`npm run db:restore -- <file>`) and a complete JSON export (`npm run data:export`).
- Backups are not encrypted by the application, like the database: keep them on an encrypted disk.
  An export is readable JSON with every amount and description; treat it like the database.

Backups are stored outside the repository, in `BACKUP_DIR`.
