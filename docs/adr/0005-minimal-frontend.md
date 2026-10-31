# ADR-0005: Minimal frontend (Phase 2C)

- **Status:** Accepted (2026-10-26)
- **Date:** 2026-10-26
- **Phase:** 2C

Phase 2B left a complete local API: accounts, categories, manual exchange rates, transactions,
balances, backup and export. Phase 2C gives it a minimal UI so the ledger can be used every day
without curl or Insomnia. This ADR decides how the frontend is built, how it reaches the API
without weakening the local-only security model, and how the phase is split into slices.

Every decision below was proposed with its alternatives and approved on 2026-10-26 (see the
decision log at the end). Nothing here changes a financial rule. The UI never decides money: the
server stays the only authority, and every rule stays in `@solvia/core`.

## Context

### What already exists

- `AppType` is exported type-only from `@solvia/backend/rpc` for `hono/client` (ADR-0003).
- Every route answers with the single error shape `{ error: { code, message, details? } }` and a
  stable code (ADR-0003).
- Money travels as `{ amountMinor: "1050", currency: "EUR" }` (strings, integer minor units).
- Transactions are sent as **one human operation** (six types), never as postings; the server builds
  the postings and derives the rate (ADR-0004).
- The API answers only `Host` `127.0.0.1:PORT` / `localhost:PORT`, and accepts changes only from its
  own `Origin` (`local-request-guard.ts`, docs/security.md).

### API surface the UI must cover

| Resource       | Endpoints                                                                   |
| -------------- | --------------------------------------------------------------------------- |
| Accounts       | list, create, get, balance, edit, archive, unarchive, delete                |
| Categories     | list (flat, with `parentId`), create, get, edit, archive, unarchive, delete |
| Exchange rates | list, create (manual), get, applicable rate on a date                       |
| Transactions   | list (`includeVoided`), create, get, replace (`PUT`), void                  |
| Health         | `GET /api/health`                                                           |

### A problem found while drafting: the dev server's `Origin`

docs/security.md says the UI must reach the API from the server's own origin, "for example through
the Vite dev server's proxy". The proxy fixes `Host` (with `changeOrigin`), but the browser still
sends `Origin: http://localhost:5173` on every `POST`, `PUT`, `PATCH` and `DELETE`. Today's guard
answers those with **403 `ORIGIN_NOT_ALLOWED`**: the UI could read but not write.

Rewriting `Origin` inside the proxy would make it work, but it is **unsafe**: a malicious site
posting to `127.0.0.1:5173/api/...` would have its `Origin` rewritten too, and the CSRF protection
would be bypassed through the dev server. See D2.

## Decisions

### D1. Workspace and stack

- New workspace `frontend/`, package `@solvia/frontend`, added to the root `workspaces`.
- **React + Vite + TypeScript**, as already planned in architecture.md. Exact versions pinned, like
  every other dependency.
- Its own `tsconfig.json` extending `tsconfig.base.json`, with `lib: ["es2024", "dom"]`,
  `jsx: "react-jsx"` and `moduleResolution: "bundler"`; `strict` and `noUncheckedIndexedAccess`
  stay on.
- A new Vitest project `frontend` in the root `vitest.config.ts`, in a DOM environment.
- `npm run check` covers it, and CI also runs `vite build` so a broken bundle fails the pipeline.

### D2. Reaching the API safely

**Development** (`npm run dev`):
- Vite listens on `127.0.0.1:5173` only (`server.host`, `strictPort`), and keeps its own host check
  on.
- Vite proxies `/api` to `http://127.0.0.1:PORT` with `changeOrigin: true`, so `Host` is the API's.
- The `Origin` is **not** rewritten. Instead the backend accepts the dev UI's origin explicitly:
  `createApp` gets an `allowedOrigins` list, and `main.ts` adds `http://localhost:5173` and
  `http://127.0.0.1:5173` **only when `NODE_ENV=development`**. Tests prove that this origin is
  accepted in development, rejected in production, and that any other origin stays a 403.
- docs/security.md is updated in the same pull request.

**Daily use** (`npm start`):
- The backend serves the built UI (`frontend/dist`) from its own origin, `127.0.0.1:PORT`, with
  `serveStatic` from `@hono/node-server` (already a dependency). There is then exactly one origin and
  one process, and no extra origin is allowed.
- `/api/*` keeps answering JSON 404s; every other unknown path returns `index.html`, so client-side
  routes survive a page reload.

Alternatives: rewriting `Origin` in the proxy (rejected above); CORS headers (rejected in
docs/security.md: any site could then read the answers); always running the Vite dev server for
daily use (two processes, a dev tool facing real data).

### D3. Typed API client

- `hc<AppType>("/")` from `hono/client`, created once in `frontend/src/api/client.ts`.
- One helper turns any non-2xx answer into an `ApiError { status, code, message, details }` parsed
  with the contracts' error schema, so screens handle **codes**, never raw text.
- A Biome `noRestrictedImports` rule: outside test files, `frontend/` may import
  `@solvia/backend/rpc` only with `import type`, and nothing else from `@solvia/backend`.
- Slice 1 verifies the known risk in ADR-0003: type-checking the frontend also type-checks the
  backend sources that `AppType` reaches. If that fails under the frontend's compiler options, the
  backend emits a declaration file for `AppType` only (the refinement ADR-0003 already describes).

### D4. Server state: TanStack Query

The UI has to refetch balances after every transaction change, show loading and error states, and
never show stale data after a mutation. **TanStack Query** does that with query keys per resource
(`["accounts"]`, `["transactions"]`, …), invalidated after every mutation that changes them.

Alternatives considered:

| Option                        | For                                                                                                            | Against                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **TanStack Query** (chosen)   | Caching, loading/error states and invalidation (`["accounts"]`, `["transactions"]`) solved and well documented | One more dependency and its concepts to learn            |
| `fetch` + `useEffect` by hand | No dependency, everything visible                                                                              | Re-implements caching, races and invalidation, with bugs |

### D5. Routing: React Router

**React Router**, in declarative mode. Route params are read and validated where they are used.

Alternatives considered:

| Option                    | For                                                           | Against                                      |
| ------------------------- | ------------------------------------------------------------- | -------------------------------------------- |
| **React Router** (chosen) | The most documented; simple declarative routes; easy to learn | Route params are not type-checked            |
| TanStack Router           | Fully typed routes and search params                          | More concepts; overkill for ~6 screens       |
| No router (state switch)  | No dependency                                                 | No URLs: no reload, no back button, no links |

### D6. Forms and validation: controlled inputs and the contracts

**Controlled inputs**, validated on submit with the `@solvia/contracts` schema of the request
(`safeParse`). No form library.

Alternatives considered:

| Option                                                  | For                                                                | Against                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------- |
| **Controlled inputs + contracts' `safeParse`** (chosen) | No dependency; validates with the same Zod schemas the server uses | More code for the six-type transaction form    |
| React Hook Form + `@hookform/resolvers/zod`             | Less boilerplate for large forms                                   | Two dependencies; another abstraction to learn |

The client validates only the **shape** (required fields, amount format). A 422 from the server (a financial rule, e.g.
`UNBALANCED_TRANSACTION`) is shown next to the form, never re-implemented in the browser.

### D7. Money and dates in the browser: helpers from `@solvia/core`

The user types `10,50`; the API needs `"1050"`. Floating point (`parseFloat`, `Number`) must never
touch money. The frontend may import **only** these `@solvia/core` helpers: `moneyFromDecimal`,
`formatDecimal`, `MINOR_UNIT_DIGITS`, `parseLocalDate` and the `Money`, `Currency` and `LocalDate`
types. The UI turns what the user typed (`1.234,56`) into the core's decimal form (`1234.56`)
before `moneyFromDecimal`. The core is pure
(no Node types), so it runs in the browser unchanged. Financial rules (validation, factories,
balances) are never called from the UI: the server stays the authority. The Biome import rule in D3
enforces the list, and architecture.md's dependency table records it.

Alternatives considered:

| Option                                                                             | For                                                                                    | Against                                                                             |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **The frontend may import `@solvia/core`** for its money and date helpers (chosen) | One tested implementation; the core is pure (no Node types), so it runs in the browser | Changes the dependency table in architecture.md; must stay limited to these helpers |
| A small parser in `frontend/`                                                      | Frontend depends only on contracts                                                     | A second decimal parser for money, tested separately                                |

Display: `formatDecimal` gives the exact amount (`1234.56`), and `Intl.NumberFormat` with the
`pt-BR` locale (D8) formats that decimal string, never a `number`.

### D8. Language and locale: Brazilian Portuguese

- Every UI text is in **Brazilian Portuguese (pt-BR)**: "Cadastrar conta", "Excluir", "Saldo".
  Code, tests' names and documentation stay in English.
- Texts are kept in one module per screen, without an i18n library, until a second language is
  actually needed.
- Numbers and dates use the `pt-BR` locale: `R$ 1.234,56`, `€ 1.234,56`, dates `dd/mm/aaaa`. The
  API keeps `YYYY-MM-DD`.

### D9. Styling: CSS Modules

**CSS Modules**, built into Vite, with a small set of shared components written in the project.

Alternatives considered:

| Option                                        | For                                                                | Against                                    |
| --------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------ |
| **CSS Modules** (chosen)                      | Built into Vite, no dependency, scoped classes, plain CSS to learn | Components (dialog, table) written by hand |
| Tailwind CSS                                  | Fast to style                                                      | New syntax and build plugin                |
| A component library (e.g. Mantine, shadcn/ui) | Ready dialogs, tables, inputs                                      | Large dependency; its own design and API   |

Minimal means: readable tables and forms, keyboard usable, labelled inputs, light and dark mode via
`prefers-color-scheme`. No charts or dashboard: those are Phase 9.

### D10. Tests

- **Unit:** money input/format, the error helper, form → operation mapping.
- **Component:** Testing Library (`@testing-library/react`, `user-event`) in a DOM environment.
- **Against the real API, in process:** tests build the client with
  `hc<AppType>("http://127.0.0.1:3000", { fetch: app.request })`, where `app` is the backend's
  `createApp` over `createTestDatabase()`. Screens are then tested against the real contracts and
  rules, without a mock server (no MSW) that could drift from the API. Only test files import
  backend runtime code; the Biome rule in D3 keeps it out of the bundle.
- No end-to-end browser tests (Playwright) in Phase 2C; reconsidered when the UI grows.

## Slices

Each slice is one branch and one pull request, merged into `main` before the next one starts. Every
slice ends with `npm run check` green, CI green, and docs updated in the same pull request.

| Slice | Scope                                                   | Needs      |
| ----- | ------------------------------------------------------- | ---------- |
| 0     | Housekeeping before the UI                              | —          |
| 1     | Frontend skeleton, safe dev origin, typed client        | D1–D3, D10 |
| 2     | App shell and accounts                                  | D4–D9      |
| 3     | Categories                                              | 2          |
| 4     | Manual exchange rates                                   | 2          |
| 5     | Transactions: list and details                          | 2–4        |
| 6     | Transactions: single-currency operations, edit and void | 5          |
| 7     | Transactions: two-currency operations                   | 6          |
| 8     | Daily use: the backend serves the built UI              | 1–7        |

### Slice 0 — Housekeeping

- Remove the unused import in `backend/src/http/app.test.ts`.
- Patch updates: `@biomejs/biome`, `hono`, `@hono/node-server`.
- `bodyLimit` on the API (e.g. 1 MB): a request body is never larger than one operation.
- **Done when:** `npm run check` has no warnings.

### Slice 1 — Skeleton, safe dev origin, typed client

- `frontend/` workspace: Vite, React, TypeScript, Vitest project, Biome import rule, CI `vite build`.
- Vite on `127.0.0.1:5173` with the `/api` proxy (D2).
- Backend: `allowedOrigins` in `createApp`; the dev UI origin only in development, with tests.
- `api/client.ts` and the error helper (D3).
- One page: "API connected", from `GET /api/health`.
- Verify the `AppType` type-check risk (ADR-0003) and record the result here.
- Docs: security.md (dev origin), development.md (`npm run dev` runs API + UI), architecture.md.
- **Done when:** the UI opens at `http://127.0.0.1:5173` and shows the health status; a `POST` from
  the UI succeeds and a `POST` with any other `Origin` is still a 403.

#### Verified in slice 1

- **`AppType` type-checks under the frontend's options** (bundler resolution, DOM, JSX): no
  declaration file is needed (ADR-0003's known risk). The frontend's `tsc` reads 38 backend source
  files to do it.
- **Side effect: Node's types reach the UI.** Through those files, `@types/better-sqlite3`
  references `@types/node`, so `process`, `Buffer` and `node:*` imports would type-check in UI
  code. Biome stops them instead: on `frontend/src` (tests excepted) `noNodejsModules`,
  `noProcessGlobal` and `noRestrictedGlobals` (`Buffer`, `global`, `require`) are errors, next to
  the import rules of D3 and D7. A probe file with each violation fails the lint; a declaration file
  for `AppType` is still the refinement if this ever proves insufficient.
- **The in-process API in a DOM test environment:** Vite transforms code for the browser, which
  turns the backend's `new URL("./migrations", import.meta.url)` into an asset URL. The frontend's
  Vitest project therefore loads `backend/src` with Node itself (`server.deps.external`), as the
  backend runs in production.
- **The bundle** holds no backend code (no `better-sqlite3`, Drizzle, `createApp` or test
  fixtures). It is one 564 KB chunk (170 KB gzip), mostly React DOM and Zod; Vite's size warning is
  raised to 1 MB, as code splitting buys nothing on the loopback address.
- **`npm run dev`** runs both servers through `scripts/dev.ts` (no dependency): Ctrl+C stops both,
  and when one stops the other does too.

### Slice 2 — App shell and accounts

- Layout, navigation, routes (D5), loading and error states, the error-code → message map (D8).
- Money display and money input (D7). The date input moved to slice 4, the first screen that
  needs one, so no slice ships an unused component.
- Accounts: list with balance and overdraft information, create, edit, archive / unarchive, delete;
  `ACCOUNT_IN_USE` explained to the user.
- **Done when:** every account endpoint is usable from the UI, with tests against the in-process API.

#### Done in slice 2

- **Routes in pt-BR**, like the texts: `/contas`, `/contas/nova`, `/contas/:id`; `/` opens the
  accounts, any other path a "page not found". "Show archived" lives in the URL (`?arquivadas=1`).
- **Assets and liabilities are listed apart**, because a balance means money held for one and money
  owed for the other. The UI learns which kinds are liabilities from `@solvia/contracts`
  (`liabilityAccountKinds`), not from the core: it is kept explicit like `accountKindSchema`, and the
  backend's contract consistency test fails if it drifts from `LIABILITY_ACCOUNT_KINDS`. D7's list of
  core helpers is unchanged.
- **Amounts typed in pt-BR** (`parseAmountInput`): a comma before the cents, dots only between
  thousands. `12.50` is refused rather than guessed, since in pt-BR it reads as 1250. Display goes
  through `Intl.NumberFormat("pt-BR")` fed with the exact decimal string, exact past 2^53.
- **Errors by code:** `errorMessage` maps every API code a screen can receive to a pt-BR message; an
  unknown code is named, never guessed. The API's English messages are never shown.
- **The form checks shape only:** a name, an amount that reads as one. A financial rule (an overdraft
  limit above zero, only on bank accounts) is the server's; the form only hides the limit for other
  kinds, and the server's 422 is explained.
- **Deleting asks for confirmation inline**, not in a browser dialog, so it is keyboard-usable and
  testable. `ACCOUNT_IN_USE` explains that archiving keeps the history.
- Checked in a real browser (Chrome) as well as in tests: light and dark, and 390 px wide, where the
  institution and currency columns give way to the balance.

### Slice 3 — Categories

- Two-level tree built from the flat list (`parentId`), income and expense separated.
- Create (including a child), edit, archive / unarchive, delete, with the `409` codes explained
  (`CATEGORY_IN_USE`, `CATEGORY_HAS_CHILDREN`, `CATEGORY_HAS_ACTIVE_CHILDREN`,
  `CATEGORY_PARENT_ARCHIVED`).
- **Done when:** the BR-70 / BR-71 hierarchy rules can be exercised from the UI.

### Slice 4 — Manual exchange rates

- Date input (from slice 2): a `YYYY-MM-DD` value for the API, shown and typed as `dd/mm/aaaa`.
- History list (manual and transaction-derived, read-only), add a manual EUR/BRL rate.
- "Rate on a date" lookup with the applicable-rate endpoint.
- **Done when:** rates can be recorded and checked without curl.

### Slice 5 — Transactions: list and details

- List by date with type, description, accounts, category and amount in the user's words (income,
  expense, transfer, …), never debit/credit. Toggle to include voided transactions.
- Details view: the operation as the user entered it, plus the executed rate when there is one.
- **Done when:** the list matches `GET /api/transactions`, including voided ones on request.

### Slice 6 — Transactions: single-currency operations, edit and void

- One form with a type selector: `OPENING_BALANCE`, `INCOME`, `EXPENSE`, `TRANSFER`,
  `CARD_PAYMENT`, each showing only its fields.
- Edit (`PUT`, the type cannot change: `TRANSACTION_TYPE_IMMUTABLE`), void with confirmation
  (`TRANSACTION_VOIDED`).
- Balances refresh after every change (D4).
- **Done when:** a month of fictitious single-currency activity can be entered from the UI and
  every balance matches the API.

### Slice 7 — Transactions: two-currency operations

- `EXPENSE` in another currency with `chargedAmount`; `CONVERSION` with optional fee.
- Shows the executed rate the server derived; 422 errors next to the form.
- **Done when:** the conversion and card examples in ADR-0004 can be reproduced from the UI.

### Slice 8 — Daily use

- The backend serves `frontend/dist` with an `index.html` fallback outside `/api` (D2).
- `npm run build && npm start` runs the whole application at `http://127.0.0.1:PORT`.
- README and development.md: how to use Solvia day to day, and backup before real data.
- **Done when:** with the dev server stopped, the built application works end to end on one origin.

## Consequences

- Phase 2C ends with a usable application on one local origin, with no change to the security model
  except one development-only origin, tested.
- The browser bundle never contains backend code; the UI's types come from the routes themselves.
- New dependencies, each with its reason in this ADR: React, React DOM, Vite and its React plugin,
  Testing Library, a DOM environment for Vitest, TanStack Query and React Router.
- Out of scope: debts, credit card statements, planning, dashboard, charts, CSV import,
  reconciliation, authentication (still not needed while the server is local only).

## Decision log

| Id  | Decision                                                                             | Status              |
| --- | ------------------------------------------------------------------------------------ | ------------------- |
| D1  | `frontend/` workspace: React + Vite + TypeScript, in `npm run check` and CI          | Approved 2026-10-26 |
| D2  | Dev: Vite proxy, dev origin allowed only in development; daily use: one origin       | Approved 2026-10-26 |
| D3  | `hc<AppType>`, one error helper, Biome import rule                                   | Approved 2026-10-26 |
| D4  | TanStack Query                                                                       | Approved 2026-10-26 |
| D5  | React Router                                                                         | Approved 2026-10-26 |
| D6  | Controlled inputs validated with the contracts                                       | Approved 2026-10-26 |
| D7  | The frontend imports only money and date helpers from `@solvia/core`                 | Approved 2026-10-26 |
| D8  | UI in Brazilian Portuguese, `pt-BR` formats                                          | Approved 2026-10-26 |
| D9  | CSS Modules                                                                          | Approved 2026-10-26 |
| D10 | Unit, component and screen tests against the real API in process; no E2E in Phase 2C | Approved 2026-10-26 |
| —   | Phase 2C in slices 0–8                                                               | Approved 2026-10-26 |
