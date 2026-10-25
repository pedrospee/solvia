# Security

## Deployment assumption

- Single user, **localhost only**. The HTTP server listens on `127.0.0.1` only; the address is a
  constant, not a setting.
- **No authentication** in this configuration. This is an explicit, documented assumption.
- If the application is ever exposed on a network, or becomes multi-user/SaaS,
  authentication and authorization become mandatory before that change ships.

## Data

- Only fictitious data in the repository: seed data, mocks and test fixtures.
- The real SQLite database lives **outside the repository**, at the path set in `.env`
  (`DATABASE_PATH`); backups go to `BACKUP_DIR`. Both must be absolute paths, so they can never be
  created relative to the repository by accident.
- Real data is entered only after persistence and backup exist (Phase 2).
- The database file is not encrypted by the application. Disk encryption (FileVault on
  macOS) must be enabled. SQLCipher may be evaluated in Phase 12.

## Never in the code or in Git

Passwords, bank credentials, API keys, tokens, IBANs, card numbers, CVVs, real statements,
real database files, backups or exports.

## Controls

| Control                                                                                                                                       | Where                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `.gitignore` blocks `.env*` (except `.env.example`), databases, `data/`, `personal-data/`, `financial-data/`, `backups/`, `exports/`, `logs/` | `.gitignore`                                       |
| Placeholder-only environment template                                                                                                         | `.env.example`                                     |
| Environment validated at startup; the app refuses to start on invalid config                                                                  | `backend/src/infrastructure/config/environment.ts` |
| API errors never expose stack traces, SQL, file paths or internal details (500 is generic and logged)                                         | `backend/src/http/error-handler.ts`                |
| Gitleaks scans staged changes before every commit; the commit is blocked if Gitleaks is missing                                               | `.githooks/pre-commit`, enabled by `npm install`   |
| Full-history scan on demand                                                                                                                   | `npm run secrets:scan`                             |
| Gitleaks scan on every push and pull request to `main`                                                                                        | `.github/workflows/ci.yml`                         |
| Weekly dependency updates                                                                                                                     | `.github/dependabot.yml`                           |
| GitHub secret scanning + push protection                                                                                                      | Enable when the remote repository is created       |

## Accepted dependency risks

Known advisories that are not fixed yet, with the reason and the condition that ends the
acceptance. Reviewed when Dependabot proposes a related update.

| Advisory                                                                                                                                      | Path                                                                                   | Why it is accepted                                                                                                                                                                                                                                                       | Resolved by                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) (moderate): the esbuild dev server answers requests from any website | `drizzle-kit` → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → `esbuild` 0.18 | Development only: `drizzle-kit` runs in `npm run db:generate` and in CI, never in the server. It bundles the schema with esbuild and never starts the vulnerable dev server. `npm audit fix --force` would downgrade `drizzle-kit` to 0.18, which breaks the migrations. | `drizzle-kit` 1.0 stable, which has no `@esbuild-kit` dependency, upgraded together with `drizzle-orm` 1.0 in its own pull request, after slice 5 |

Accepted on 2026-10-25.

## Backups

- ✅ Automatic, verified backup before migrating an existing database (`npm run db:migrate`).
- Manual backup, restore and export: Phase 2B.

Backups are stored outside the repository, in `BACKUP_DIR`.
