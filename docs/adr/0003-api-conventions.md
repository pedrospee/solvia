# ADR-0003: API conventions

- **Status:** Accepted
- **Date:** 2026-09-28
- **Phase:** 2B

## Context

The backend exposes the ledger to the Phase 2C React UI over HTTP. The UI must get typed requests
and responses without depending on backend runtime code, and the API must never become a second
financial core.

## Decision

### Routes and layers

- Every route is under `/api/`, JSON only. The server binds to `127.0.0.1`.
- `routes → services → @solvia/core → repositories → SQLite`. Routes validate input and map
  results; services orchestrate and call the core; repositories only persist. No financial rule
  lives in a route, service or repository.
- Routes are chained Hono sub-apps composed in `createApp()` (`backend/src/http/app.ts`).
- Routes validate input with `validate(target, schema)` (`backend/src/http/validation.ts`): Hono's
  built-in validator running a `@solvia/contracts` schema, so the schema's input type reaches
  `AppType` and a mismatch becomes a 400 `VALIDATION_FAILED`. No extra validator package is used.

### JSON representation

| Value | JSON | Example |
| --- | --- | --- |
| Money | `{ amountMinor: string, currency }` | `{ "amountMinor": "1050", "currency": "EUR" }` |
| Exchange rate | Decimal string | `"5.882353"` |
| Business date | `YYYY-MM-DD` | `"2026-03-15"` |
| Timestamp | ISO 8601 | `"2026-03-15T10:30:00.000Z"` |

`amountMinor` is a string because JSON has no `bigint`. The contract checks only the
representation (an integer within the signed 64-bit range SQLite can store); whether an amount may
be zero or negative is a financial rule, left to `@solvia/core`.

### `@solvia/contracts`

`packages/contracts` holds the Zod schemas of the JSON requests and responses. It depends only on
Zod: not on `@solvia/core` (so no second domain model and no dependency just to reuse constants),
and not on Node types (the browser imports it). Values both packages define, such as currencies,
are duplicated on purpose; a backend test fails at type level and at runtime if they drift.

```text
@solvia/core        @solvia/contracts
       ↑                    ↑
       └────── backend ─────┘
```

### Resources

- Collections are returned as `{ "items": [...] }`, leaving room for pagination fields later.
- Hierarchies are returned flat, each item with its `parentId`; the client builds the tree.
- `POST` that creates returns 201 with the resource; `DELETE` returns 204 with no body. Transactions
  have no `DELETE` (see below).
- Partial updates use `PATCH`: a field left out stays unchanged and `null` removes an optional field.
  Immutable fields are not part of the update contract, so sending them is a 400, never ignored.
  A `PATCH` that changes nothing is a no-op and keeps `updatedAt`.
- **Transactions are updated by full replacement**, never by `PATCH` ([ADR-0004](0004-ledger-persistence.md)):
  - `PUT /api/transactions/:id` carries the complete operation, in the same shape as its creation;
  - `id`, `type` and `createdAt` are immutable; a `PUT` whose operation has a different `type` than
    the persisted transaction is a 409 `TRANSACTION_TYPE_IMMUTABLE`;
  - the operation's factory rebuilds the postings, and the exchange rate is recalculated when the
    operation actually changes; the transaction and its postings are updated atomically;
  - an operation that changes nothing is a no-op: `updatedAt` and the derived data stay as they
    were;
  - editing a voided transaction is a 409 `TRANSACTION_VOIDED`.

  `PATCH` remains the update method for simple resources whose fields are independent.
- State changes that are not edits are sub-resource actions, e.g. `POST /api/accounts/:id/archive`.
- **Void** is such an action: `POST /api/transactions/:id/void` returns 200 with the transaction. A
  transaction is never physically
  deleted, and `DELETE` on a transaction is a 404 `ROUTE_NOT_FOUND`. Voiding:
  - keeps the transaction and its postings; the transaction stays identifiable, but leaves the
    effective ledger, so it no longer counts in any financial calculation;
  - creates no postings;
  - is irreversible: there is no unvoid route;
  - is idempotent (BR-24, ADR-0004): voiding a voided transaction changes nothing and returns 200
    with the transaction as it was;
  - does not change `updatedAt`.

  `GET /api/transactions/:id` returns a voided transaction too. Lists leave voided transactions out
  unless `includeVoided=true`.
- An append-only resource (e.g. manual exchange rates) has no `PATCH` or `DELETE` route; such a
  request is a 404 `ROUTE_NOT_FOUND`, and a correction is a new resource.

### Mappers

Conversion between the JSON representation and core types (`string` ↔ `bigint`, `string` →
`LocalDate`) happens only at the HTTP boundary, in one mapper per feature. A request that already
has the core's shape (e.g. categories) is passed through without a mapper. Response schemas type
the mappers; responses are not validated again at runtime.

### Errors

Every error has one shape:

```json
{ "error": { "code": "ACCOUNT_NOT_FOUND", "message": "…", "details": {} } }
```

`details` is optional. `code` is stable and meant for programs; `message` is for humans.

Services do not know HTTP. They throw `DomainError` (from the core) or application errors that carry
a code but no status, `NotFoundError` (404) and `ConflictError` (409) in
`backend/src/modules/errors.ts`; the error handler maps them to statuses. `ApiError`, which carries a status, is raised only by the HTTP layer.

| Status | When | Codes |
| --- | --- | --- |
| 400 | The request does not match the contract, or the body is malformed | `VALIDATION_FAILED` (Zod issues in `details`), `INVALID_REQUEST`, `INVALID_CURSOR` |
| 404 | A resource, or a referenced resource, does not exist | `ROUTE_NOT_FOUND`, `<ENTITY>_NOT_FOUND` (e.g. `ACCOUNT_NOT_FOUND`) |
| 409 | The request conflicts with the current state | e.g. `ACCOUNT_IN_USE`, `ACCOUNT_ARCHIVED`, `CATEGORY_IN_USE`, `CATEGORY_ARCHIVED`, `CATEGORY_HAS_CHILDREN`, `CATEGORY_HAS_ACTIVE_CHILDREN`, `CATEGORY_PARENT_ARCHIVED`, `TRANSACTION_VOIDED`, `TRANSACTION_TYPE_IMMUTABLE` |
| 422 | A financial rule was violated (`DomainError`) | The core's code, e.g. `UNBALANCED_TRANSACTION` |
| 500 | Anything unexpected | `INTERNAL_ERROR`, generic message |

A 500 is logged on the server and exposes nothing: no stack trace, SQL, file path or internal
detail. Unknown errors are never turned into a 400.

### `AppType` and Phase 2C

`createApp()` returns the fully chained Hono app, and `AppType = ReturnType<typeof createApp>`
carries every route's input and output types for `hono/client`. The route types have one source of
truth: the routes themselves.

The backend exposes it through a type-only entry point, `@solvia/backend/rpc`
(`backend/src/http/rpc.ts`, which contains only `export type { AppType }`). Phase 2C will use:

```ts
import type { AppType } from "@solvia/backend/rpc";
```

with `@solvia/backend` as a development dependency of the frontend. `import type` is erased at
compile time, so the browser bundle never contains backend code, and the UI talks to the backend
only over HTTP.

Known risk, to verify when the frontend exists: type-checking the frontend then also type-checks
the backend sources it reaches, under the frontend's compiler options. If that causes problems,
the refinement is for the backend to emit a declaration file for `AppType` only. It stays the same
single source of truth; no separate API-types package is created before the problem exists.

## Consequences

- The UI gets typed calls without a runtime dependency on the backend.
- Every error is predictable: one shape, stable codes, one status per category.
- A small amount of duplication between contracts and core is accepted and guarded by a test.
