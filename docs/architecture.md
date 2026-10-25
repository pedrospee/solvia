# Architecture

A modular monolith with a pure TypeScript financial core and an internal double-entry ledger.
Decisions approved on 2026-09-26.

## Three concerns, never mixed

| Layer         | Question                    | Examples                                               |
| ------------- | --------------------------- | ------------------------------------------------------ |
| **Ledger**    | What actually happened?     | Salary received, transfer, card purchase, debt payment |
| **Planning**  | What is expected to happen? | Expected salary, future installment, planned trip      |
| **Analytics** | What does it mean?          | Net worth, cash flow, debt evolution, projections      |

A ledger transaction is always a fact. Planned items live in planning and are _matched_ to real transactions when they happen.

## Layers

```text
core / domain (pure rules)  ←  application (use cases)  ←  infrastructure (DB) · http (API) · web (UI)
```

- **core** — pure TypeScript: no database, HTTP, React, Hono, Node APIs or external APIs. Every important financial rule lives and is tested here.
- **application** — use cases that combine core rules with repositories (Phase 2B).
- **infrastructure** — SQLite via Drizzle, configuration, backups.
- **http** — thin Hono routes on `127.0.0.1`; no business rules.
- **web** — React + Vite UI.

Dependencies point inward only. The repository is an npm workspaces monorepo ([ADR-0001](adr/0001-monorepo-with-npm-workspaces.md)), and the workspaces make the layers visible:

| Workspace             | Package             | Layers                            | Depends on                                                                       |
| --------------------- | ------------------- | --------------------------------- | -------------------------------------------------------------------------------- |
| `packages/core`       | `@solvia/core`      | core                              | nothing (no runtime dependencies, no Node types)                                 |
| `packages/contracts`  | `@solvia/contracts` | API JSON schemas                  | Zod only (no core, no Node types)                                                |
| `backend`             | `@solvia/backend`   | application, infrastructure, http | `@solvia/core`, `@solvia/contracts`, Hono, Drizzle, better-sqlite3, Zod          |
| `frontend` (Phase 2C) | —                   | web                               | `@solvia/contracts`; `AppType` as a type-only import, never backend runtime code |

Other workspaces import the core only as `@solvia/core` (its `src/index.ts`), never through deep paths.
Persistence: [ADR-0002](adr/0002-persistence-with-sqlite-and-drizzle.md). API conventions: [ADR-0003](adr/0003-api-conventions.md).

## Ledger model: internal double-entry

Every transaction has two or more postings that sum to zero **in each currency**. Users never see debit/credit; the UI speaks of income, expense, transfer, purchase, payment and conversion. Transaction factories translate those human operations into postings.

```text
Card purchase €500       Expense:Food  +500   Credit Card  −500
Card payment €500        Credit Card   +500   Bank         −500
Internal transfer €300   Account B     +300   Account A    −300
```

- Income and expense exist only when a posting targets a category, so transfers can never create them.
- Cross-currency operations balance each currency through an `EXCHANGE_CLEARING` posting and record the executed rate. Fees are a separate expense posting.
- Balances are derived from postings, never stored as the source of truth.

Details: [financial-model.md](financial-model.md) · Rules: [business-rules.md](business-rules.md)

## Source structure

Folders are created only when a phase needs them.

```text
packages/
└── core/                     @solvia/core
    └── src/
        ├── index.ts          public API (the only import path for other workspaces)
        ├── money/            Currency, Money (bigint minor units), allocation
        ├── exchange/         ExchangeRate, conversion, executed rates, rate history
        ├── ledger/           Account, Category, Transaction, validation, factories, balances
        ├── decimal.ts        exact decimal parsing and rounding
        ├── local-date.ts     YYYY-MM-DD dates without time zone
        └── domain-error.ts   DomainError with stable codes
packages/
└── contracts/                @solvia/contracts
    └── src/                  Zod schemas of the API JSON (money, errors, …)
backend/                      @solvia/backend
├── drizzle.config.ts         drizzle-kit configuration (db:generate)
└── src/
    ├── http/
    │   ├── app.ts            createApp({ db }) and AppType
    │   ├── rpc.ts            type-only AppType entry point for the UI
    │   ├── error-handler.ts  ApiError and the single error shape
    │   ├── validation.ts     validate(target, schema): contracts through Hono's validator
    │   ├── mappers/          JSON ↔ core conversion, one file per feature
    │   └── routes/           thin Hono routes
    ├── modules/
    │   ├── errors.ts         NotFoundError, ConflictError (application errors without HTTP status)
    │   ├── accounts/         account service (use cases) and repository (persistence)
    │   ├── categories/       category service and repository
    │   ├── exchange-rates/   manual exchange rate service and repository (append-only)
    │   ├── transactions/     ledger use cases (create, edit, void, read) and repository; the effective ledger
    │   └── data-export/      the complete JSON export (data:export)
    ├── infrastructure/
    │   ├── config/           environment validation
    │   ├── database/         SQLite client, schema, migrations, backup, restore
    │   └── files/            private files and directories (600 / 700)
    ├── scripts/              db:migrate, db:backup, db:restore, data:export
    └── main.ts               bootstrap: checks the database, serves on 127.0.0.1
docs/adr/                     architecture decision records
```

Root: shared configuration (`tsconfig.base.json`, `biome.json`, `vitest.config.ts`), CI in `.github/`.

From Phase 2C: `frontend/`.

## Stack

| Area         | Choice                                              | Why                                                                                                         |
| ------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Runtime      | Node.js 24 LTS                                      | Long-term support; runs TypeScript natively (type stripping)                                                |
| Language     | TypeScript `strict` + `noUncheckedIndexedAccess`    | Errors caught at compile time                                                                               |
| Money        | `bigint` minor units, decimal strings for rates     | Never floating point                                                                                        |
| Validation   | Zod                                                 | External input and configuration                                                                            |
| Tests / lint | Vitest / Biome                                      | Fast, minimal configuration; one root config for every workspace                                            |
| Repository   | npm workspaces                                      | Explicit package boundaries without extra tools ([ADR-0001](adr/0001-monorepo-with-npm-workspaces.md))      |
| CI           | GitHub Actions, Dependabot                          | `npm run check` and Gitleaks on every push and pull request                                                 |
| Database     | SQLite + Drizzle + better-sqlite3                   | Local file, ACID, typed, versioned migrations ([ADR-0002](adr/0002-persistence-with-sqlite-and-drizzle.md)) |
| API          | Hono + `@solvia/contracts` (Zod)                    | Small, typed RPC client, shared schemas ([ADR-0003](adr/0003-api-conventions.md))                           |
| UI           | React + Vite                                        | Introduced with the minimal UI                                                                              |
| Secrets      | `.env`, Gitleaks pre-commit, GitHub push protection | See [security.md](security.md)                                                                              |

No dependency is added without a documented reason.

## Roadmap

| Phase | Scope                                                                        | Status      |
| ----- | ---------------------------------------------------------------------------- | ----------- |
| 0     | Foundation                                                                   | ✅ Done     |
| 1     | Financial core: money, exchange rates, ledger                                | ✅ Done     |
| 2     | Persistence, accounts, transactions, manual rates, backup/export, minimal UI | In progress |
| 2A    | Monorepo with npm workspaces, CI                                             | ✅ Done     |
| 2B    | Backend: Hono, Drizzle, SQLite, shared contracts, ledger, backup and export  | ✅ Done     |
| 2C    | Frontend: React + Vite                                                       |             |
| 3     | Debt management                                                              |             |
| 4     | Credit cards: statements, installments                                       |             |
| 5     | Planning and budget                                                          |             |
| 6     | Debt payoff simulator (avalanche / snowball)                                 |             |
| 7     | Financial goals                                                              |             |
| 8     | Analytics, snapshots, projections                                            |             |
| 9     | Dashboard                                                                    |             |
| 10    | Investments                                                                  |             |
| 11    | Automatic exchange rates, CSV/OFX import, Wise                               |             |
| 12    | Advanced security and audit                                                  |             |

### Phase 2B slices

Phase 2B is delivered in slices, each merged into `main` before the next one starts.

| Slice | Scope                                                                                | Status  |
| ----- | ------------------------------------------------------------------------------------ | ------- |
| 1     | Backend skeleton: Hono, Drizzle, SQLite, migrations with backup, `@solvia/contracts` | ✅ Done |
| 2     | Accounts, overdraft limit (BR-22)                                                    | ✅ Done |
| 3     | Categories, two-level hierarchy (BR-70, BR-71)                                       | ✅ Done |
| 4     | Manual exchange rates (BR-80 to BR-83)                                               | ✅ Done |
| 5     | Transactions and postings; `ACCOUNT_IN_USE`, `CATEGORY_IN_USE`; balances in the API  | ✅ Done |
| 6     | Manual backup, restore and JSON export                                               | ✅ Done |

After the MVP (phases 0–3): **reconciliation**, then **CSV import** (preview, validation, column mapping, duplicate detection, confirmation, idempotent re-import).
