# ADR-0004: Ledger persistence

- **Status:** Accepted (2026-10-04)
- **Date:** 2026-10-01
- **Phase:** 2B, slice 5

Slice 5 persists the first real financial facts: transactions and their postings. The ledger model
already exists in `@solvia/core` (Phase 1) and is not redefined here. This ADR decides how it is
stored, edited and voided so that persistence never weakens it.

How to read it:

- **Current behaviour** is what the code does today, verified by running it.
- **Approved direction** marks a decision approved during review (2026-10-01 and 2026-10-03; see
  the decision log at the end). The complete document was accepted on 2026-10-04.
- **Deferred** marks a known concern that slice 5 deliberately does not solve.

## Context

### Current behaviour: what the core defines

- `Transaction { id, date, description, type, postings, exchangeRate? }`, with six types:
  `OPENING_BALANCE`, `INCOME`, `EXPENSE`, `TRANSFER`, `CARD_PAYMENT`, `CONVERSION`.
- `Posting { target, amount }`, where `target` is one of **three** kinds: an `ACCOUNT`, a
  `CATEGORY`, or a `SYSTEM` role:
  - `OPENING_BALANCE_EQUITY`: "the other side of a starting balance";
  - `EXCHANGE_CLEARING`: bridges the two currencies of an operation.
- Each posting carries its own currency in its `Money`. Account postings must use the account's
  currency. Categories are currency-agnostic. Sign convention: positive increases assets and
  expenses, negative increases liabilities and income.
- `assertValidTransaction(transaction, { accounts, categories })` checks:
  - at least two postings, and no zero amount;
  - every referenced account and category exists;
  - account postings use the account's currency;
  - postings sum to zero **in each currency**;
  - at most two currencies, with an exchange rate covering both and at least one
    `EXCHANGE_CLEARING` posting in each currency when there are two;
  - category signs, and the rules of each type.
- Factories (`createExpenseTransaction`, `createConversionTransaction`, …) turn a human operation
  into postings. `calculateExecutedRate` derives the rate of a real operation from its two legs:
  EUR/BRL, six decimal places, half away from zero, source `TRANSACTION`, `effectiveDate` equal to
  the transaction date (BR-16, BR-80).
- `calculateAccountBalance` and `calculateOverdraft` derive balances from the transactions they are
  given (BR-20, BR-22).

Postings produced by the real factories:

```text
CONVERSION €100 → R$620, fee €1                 EXPENSE R$120 dinner, €20.40 charged on the card
1. ACCOUNT   bank-eur           EUR -101.00      1. CATEGORY  food               BRL +120.00
2. SYSTEM    EXCHANGE_CLEARING  EUR +100.00      2. SYSTEM    EXCHANGE_CLEARING  BRL -120.00
3. SYSTEM    EXCHANGE_CLEARING  BRL -620.00      3. SYSTEM    EXCHANGE_CLEARING  EUR  +20.40
4. ACCOUNT   wise-brl           BRL +620.00      4. ACCOUNT   card               EUR  -20.40
5. CATEGORY  fees               EUR   +1.00      rate: EUR/BRL 5.882353, TRANSACTION
rate: EUR/BRL 6.2, TRANSACTION
```

A conversion in the other direction (R$620 → €100) flips the signs and keeps the rate EUR/BRL 6.2.

### Current behaviour: gaps found by running the core

`assertValidTransaction` **accepts** all of the following today. Only the factories prevent them:

- a two-currency transaction whose rate does not match its legs (9 instead of 6.2);
- a rate with source `MANUAL`, a BRL/EUR rate, or a rate effective on another date;
- clearing postings with the **same sign** in both currencies (money leaves both accounts);
- clearing postings that net to **zero** in both currencies (no exchange happened);
- two-currency `INCOME` and `CARD_PAYMENT`, built by hand. A two-currency `TRANSFER` is already
  rejected, because it cannot balance without clearing postings.

Other findings:

- **Clearing postings per currency.** The rule is "at least one" (`.some`), not "exactly one": the
  EUR clearing split as 60 + 40 is accepted. The factories produce exactly one per currency.
- **Checking the rate with `convertMoney` would be wrong.**
  - €1,000,000.00 → R$5,882,352.94 gives the rate 5.882353.
  - Converting €1,000,000.00 back with that rate gives R$5,882,353.00, six cents above the real leg.
  - The rate is rounded from the legs, so converting a leg with it can differ by cents.
- **Opening balances:**
  - an `OPENING_BALANCE` is exactly one account posting plus one `OPENING_BALANCE_EQUITY` posting,
    in the account's currency;
  - it is accepted for every account kind (cash, bank, card, loan, investment), including a
    negative balance;
  - a zero opening balance is rejected (zero posting);
  - a second opening balance for the same account is accepted, and the balance sums them;
  - it is never income or expense.
- **`calculateAccountBalance` ignores dates.** It sums every posting it receives.
- **No posting groups.** Balance is checked per currency, and two-currency transactions are not
  future work: `CONVERSION` and the foreign-charge `EXPENSE` exist today.

### Current behaviour: the backend

- Repositories receive the database (`AppDatabase`), and services call them one after another
  without a database transaction. That is safe today (one row per use case, synchronous
  services), but it cannot keep a transaction and its postings together.
- The only foreign key is `categories.parent_id → categories.id ON DELETE RESTRICT`.
- `npm run db:migrate` applies pending migrations through Drizzle's migrator, inside one SQLite
  transaction, on a connection with `foreign_keys = ON`.
- The documented lifecycle promises, for slice 5: `ACCOUNT_IN_USE`, `CATEGORY_IN_USE`, and no new
  transactions on archived accounts or categories.
- ADR-0002 does not forbid `CHECK`. The rule appears in the schema comments and the slice 2 and 3
  commits: "no CHECK constraints *duplicating core rules*".

### Verified facts about the stack

Checked against drizzle-orm 0.45.3 and better-sqlite3 13.0.3:

1. `BaseSQLiteDatabase<"sync", RunResult, typeof schema>` accepts both the database and a
   transaction object.
2. Inside `db.transaction(callback)`, a thrown error, or a statement that fails halfway (e.g. a
   foreign key violation), rolls back every earlier write of the callback.
3. A callback that returns a promise is rejected ("Transaction function cannot return a promise").
4. A table rebuild (the `__new_<table>` pattern drizzle-kit generates) **fails** on a database with
   data when a foreign key references the table or the table references itself. Inside the
   migrator's transaction `PRAGMA foreign_keys = OFF` is a no-op. This happens with `RESTRICT` and
   with `NO ACTION`, with or without `PRAGMA defer_foreign_keys = ON`.
5. The same rebuild succeeds when foreign keys are turned off **before** the transaction begins, and
   `PRAGMA foreign_key_check` before `COMMIT` detects a rebuild that lost a referenced row, so the
   transaction can be rolled back.
6. SQLite cannot enforce "a transaction has at least two postings": it is a cross-row invariant,
   without a constraint that could express it.

## Decision

### 1. Atomicity: one database transaction per ledger use case

*Approved direction: the database transaction of the approved creation and editing pipelines
(L7-B, L7-C; sections 6 and 7).*

- **The service owns the boundary.** A use case that writes more than one row, or reads in order to
  decide a write, runs its whole body inside `db.transaction(work, { behavior: "immediate" })`.
  Routes and repositories never open transactions.
- **Repositories join the transaction.** They receive a `DbExecutor`
  (`BaseSQLiteDatabase<"sync", RunResult, typeof schema>`) instead of `AppDatabase`. The service
  creates them from the `tx` object inside the callback.
- **The work is synchronous.** No `await` inside a ledger transaction (fact 3).
- **`BEGIN IMMEDIATE`** takes the write lock before the first read, so nothing read for a decision
  can change before the write.
- **Any error leaves the callback and rolls everything back:** a `DomainError`, a `ConflictError`,
  or a constraint violation.

Not accepted: repositories called in sequence without a transaction, compensating deletes, or a
repository that opens its own transaction.

### 2. Posting model: three nullable targets, exactly one set

*Approved direction (L1, L2).*

```text
postings
  transaction_id  TEXT     NOT NULL  → transactions.id  ON DELETE RESTRICT
  position        INTEGER  NOT NULL  order of the core postings
  account_id      TEXT     NULL      → accounts.id      ON DELETE RESTRICT
  category_id     TEXT     NULL      → categories.id    ON DELETE RESTRICT
  system_role     TEXT     NULL      a core SystemPostingRole
  amount_minor    INTEGER  NOT NULL  bigintInteger, signed
  currency        TEXT     NOT NULL
  PRIMARY KEY (transaction_id, position)
  CHECK ((account_id IS NOT NULL) + (category_id IS NOT NULL) + (system_role IS NOT NULL) = 1)
```

- **Exactly one target** is populated in every posting: an account, a category, or a system role.
- Two columns (`account_id`, `category_id`) cannot store `SYSTEM` postings, which every opening
  balance and every two-currency transaction contains.
- Indexes on `account_id` and `category_id` serve the foreign key check on delete, the `*_IN_USE`
  queries and the balance reads.
- The repository maps a row to the core `PostingTarget` union and back.

**`system_role` is an internal target.** Accounts and categories are destinations the user chooses
(as the parameters of an operation). System roles are not:

- `OPENING_BALANCE_EQUITY` and `EXCHANGE_CLEARING` postings are created only by the domain
  operations: the factories for opening balances, conversions and foreign charges.
- No API request names a system role or supplies a system posting, because requests describe
  operations, never postings (section 9).
- The column exists so that the persisted transaction is the complete core transaction, not
  because system postings are a client-selectable destination.

**The boundary between database integrity and domain validation (L2).** The database may enforce,
with `CHECK` constraints, invariants of the **structural representation**: invariants that exist
only because of how the database stores a core type. The core cannot see them, because it never
receives an invalid union. Every **domain and financial** invariant stays in `@solvia/core`, and no
`CHECK` duplicates one:

| The database enforces (structure) | The core enforces (domain) |
| --- | --- |
| Exactly one posting target | Which targets a transaction type may use |
| `NOT NULL`, primary keys, foreign keys | Zero sum per currency, signs, currencies, system role usage, rates |

Slice 5 has exactly one `CHECK`: the exactly-one-target constraint above. A new structural `CHECK`
must meet the same definition and be justified in its commit. Anything closer to a financial rule
needs a new ADR.

### 3. Referential behaviour: `RESTRICT` everywhere, never `CASCADE`

*Approved direction (with L9).*

- `postings.account_id`, `postings.category_id` and `postings.transaction_id` use
  `ON DELETE RESTRICT`. No financial row is ever deleted by cascade, and transactions are never
  deleted at all (section 8).
- **Why not `CASCADE`:** deleting an account or a category would silently erase postings, leaving
  transactions that no longer sum to zero and balances derived from half a fact. `SET NULL` would
  keep a posting with no target.
- **`RESTRICT`, not `NO ACTION`:** they behave the same for an ordinary delete and for a table
  rebuild (fact 4). `RESTRICT` is what `categories.parent_id` already uses.
- **`ACCOUNT_IN_USE` / `CATEGORY_IN_USE` (409)** are raised on `DELETE` of an account or a category
  that any posting references, **voided transactions included**, because their postings are kept.
  The service checks inside the delete transaction. For categories, `CATEGORY_HAS_CHILDREN` keeps
  its precedence.
- **The foreign key is a safety net, not the way conflicts are reported (L9).** Expected domain
  conflicts (`ACCOUNT_IN_USE`, `CATEGORY_IN_USE`, `CATEGORY_HAS_CHILDREN`) are detected by the
  service and returned as 409. A foreign key violation that reaches the error handler means a
  service check is missing or wrong: it is an internal defect, logged and returned as a generic 500
  (`INTERNAL_ERROR`), never translated into a 409.
- **Account and category lifecycle unchanged:** archiving is allowed with any postings; deleting is
  possible only without them.

### 4. Archived accounts and categories

*Approved direction (L3).*

**A transaction may never add a reference to an archived account or category.**

| Change made by an edit | Allowed? |
| --- | --- |
| **Keep** an existing reference to an archived entity | Yes |
| **Remove** an existing reference, where the operation allows it | Yes |
| **Change** an archived reference to an active one | Yes |
| **Add** a reference to an archived entity | No: 409 `ACCOUNT_ARCHIVED` / `CATEGORY_ARCHIVED` |

- On **create**, every reference is new, so any archived reference is rejected.
- The rule is **identical for accounts and categories**.
- The service compares the referenced accounts and categories before and after the edit **inside
  the same database transaction as the write**, so an archive cannot slip in between.
- Archived status stays out of the core. The service passes **all** referenced entities, archived
  ones included, to `assertValidTransaction`, so an old transaction still validates.
- **Removing a category is rarely possible:** `INCOME` and `EXPENSE` require a category. In
  practice it happens only when the fee of a `CONVERSION` is removed, and then the amount goes with
  it. There is no "uncategorised" state.
- Effects: editing an amount on an archived account changes its balance, which still counts in net
  worth. Editing on an archived category changes reports. Both are legitimate corrections of a
  fact.

### 5. `TRANSACTION` exchange rates

#### 5.1 Validation: the net-clearing rule

*Approved direction (L4, L4b). Implemented in `@solvia/core`, independently of the factories.*

For every transaction with two currencies:

1. `netEUR` = the sum of the `EXCHANGE_CLEARING` postings in EUR; `netBRL` = the same in BRL
   (`bigint`, minor units).
2. `netEUR ≠ 0` and `netBRL ≠ 0`.
3. `netEUR` and `netBRL` have **opposite signs**.
4. `exchangeRate` equals exactly
   `calculateExecutedRate(|netEUR| EUR, |netBRL| BRL, { effectiveDate: transaction.date, recordedAt: exchangeRate.recordedAt })`.
   That is: EUR/BRL, source `TRANSACTION`, `effectiveDate === transaction.date`, and the same
   canonical rate string. (`recordedAt` is not derived from the legs. For a persisted transaction
   it equals `updatedAt`; see 5.2.) The precision is six decimal places, half away from zero, as already
   defined by `calculateExecutedRate`.
5. **Only `CONVERSION` and `EXPENSE`** (with a foreign charge) may involve two currencies. A
   two-currency `INCOME`, `TRANSFER` or `CARD_PAYMENT` is rejected by the core.

Not required: exactly one clearing posting per currency. The net per currency is what makes the
rate well defined.

The check never uses `convertMoney`: re-deriving the rate is exact, while converting a leg with a
rounded rate can differ by cents (see Context). `invertExchangeRate` does not take part. No step
uses floating point.

| Example | netEUR / netBRL | Stored rate | Result |
| --- | --- | --- | --- |
| Conversion €100 → R$620 | +100.00 / −620.00 → 6.2 | EUR/BRL 6.2, `TRANSACTION`, same date | ✅ valid |
| Conversion R$620 → €100 | −100.00 / +620.00 → 6.2 | EUR/BRL 6.2 | ✅ valid |
| Foreign purchase R$120, charged €20.40 | +20.40 / −120.00 → 5.882353 | EUR/BRL 5.882353 | ✅ valid |
| EUR clearing split 60 + 40 | +100.00 / −620.00 → 6.2 | EUR/BRL 6.2 | ✅ valid (nets count) |
| Rate does not match the legs | +100.00 / −620.00 → 6.2 | 9 | ❌ rate ≠ derived |
| Wrong source, direction or date | — | `MANUAL`, or BRL/EUR, or another `effectiveDate` | ❌ not the executed rate |
| Same sign in both currencies | +100.00 / +620.00 | any | ❌ not an exchange |
| Net zero | 0 / 0 | any | ❌ no exchange happened |
| Two-currency `INCOME` / `CARD_PAYMENT` | — | — | ❌ type cannot involve two currencies |

#### 5.2 Storage

*Approved direction (L5).*

- Stored **on the transaction**, never in `exchange_rates`. That table is the append-only manual
  history read by `applicable`. Adding `TRANSACTION` rows would change slice 4's answers (whether
  reporting uses executed rates is a Phase 8 decision) and conflict with editing.
- **One nullable column, `transactions.exchange_rate`:** the canonical decimal string, as `TEXT`.
  It is set exactly when the transaction involves two currencies; the core already requires that,
  so no `CHECK` is needed.
- The other fields of the core `ExchangeRate` are not stored; the repository rebuilds them when it
  reads a transaction:

  | `ExchangeRate` field | Value for a transaction rate | Meaning |
  | --- | --- | --- |
  | `baseCurrency` / `quoteCurrency` | EUR / BRL (`CANONICAL_EXCHANGE_RATE_PAIR`) | Canonical direction (BR-80) |
  | `source` | `TRANSACTION` | Executed rate, derived from the legs |
  | `effectiveDate` | the transaction's `date` | The financial date of the fact |
  | `recordedAt` | the transaction's `updatedAt` | When the current version of the transaction was recorded |

- **`updatedAt` is not a property of the exchange rate.** It is the version timestamp of the
  transaction, and it supplies the rate's `recordedAt`. The invariant is
  `transaction.exchangeRate.recordedAt === transaction.updatedAt`, for every two-currency
  transaction.
- **Editing** recalculates the postings and the rate from the new legs, and sets `updatedAt`, all
  in one atomic operation (section 7). The rate stays `TRANSACTION` and EUR/BRL. A no-op edit keeps
  `updatedAt`, and therefore the rate's `recordedAt`.
- The API never accepts a rate for a transaction: the factory derives it.

### 6. Creation

*Approved direction (L7-B).*

```text
request → business operation → factory → core validation → DB transaction → transaction + postings
```

- A request describes one human operation of one of the six types (section 9). The service calls
  the matching factory, which runs `assertValidTransaction` (including section 5.1). For an opening
  balance, the service also runs the uniqueness rule (section 10).
- Inside one database transaction, the service:
  1. loads the referenced accounts and categories;
  2. applies the archived rule (section 4);
  3. builds and validates the core transaction;
  4. writes the transaction row, then its postings.

  The server sets `id`, `createdAt` and `updatedAt`. The rate's `recordedAt` is the new
  `updatedAt` (5.2): the factory receives that same timestamp.
- **Only the service, through the factories, writes ledger data.** A transaction can never exist
  without its postings, nor a posting without its transaction (`NOT NULL` foreign key and
  atomicity).
- **Integrity test:** because SQLite cannot enforce "at least two postings" (fact 6), a test
  asserts that no persisted transaction has fewer than two postings after every write scenario
  (create, edit, void, failures).

### 7. Editing

*Approved direction (L7-C).*

- An edit is a **full replacement of the operation**, never a field merge (section 9).
- `id`, `createdAt` and `type` are **immutable**.
- Every posting is recalculated by the factory from the submitted operation, and the transaction
  rate is recalculated from the new legs (section 5). Its `recordedAt` becomes the new `updatedAt`.
- The edit passes **the same core validation as creation**, plus the archived transition rule
  (section 4) and, for an opening balance, the uniqueness rule (section 10).
- **Atomic:** in one database transaction, the service:
  1. loads the current version;
  2. compares references;
  3. builds and validates the new version;
  4. updates the row;
  5. deletes and reinserts the postings.

  Any failure leaves the previous version intact.
- **No-op:** a semantically unchanged operation changes nothing, and `updatedAt` stays (ADR-0003),
  together with the rate's `recordedAt`.
- A voided transaction cannot be edited: 409 `TRANSACTION_VOIDED` (section 8).

**BR-23, refined** (to be applied to `business-rules.md` when this ADR is accepted):

> Past transactions can be edited in the MVP, as a full replacement of the operation. An edit
> passes the same validation as creation, keeps the ledger balanced, and recalculates every derived
> value, including postings and the transaction rate. `id`, `createdAt` and `type` never change.
> An edit never adds a reference to an archived account or category. `updatedAt` changes only when
> the operation changes. A voided transaction cannot be edited.

"Free editing" means correcting a recorded fact, not unrestricted mutation. Editing still overwrites
the previous version: history of edits remains deferred to Phase 12.

### 8. Void instead of deletion

*Approved direction (L7-D, V1 to V9).*

A transaction is never physically deleted. A mistaken or duplicated transaction is **voided**:

- the transaction and its postings stay persisted, identifiable and listable;
- voided transactions are excluded from balances, overdraft and financial reporting;
- voiding creates no postings;
- the transaction API offers no physical deletion.

| Rule | Decision | Reason, from the existing rules |
| --- | --- | --- |
| **V1** | Void is **irreversible** | BR-64: "never correct silently". A void changes balances; undoing it would change them again with no new fact. A wrong void is corrected by recording the transaction again, and both stay visible. |
| **V2** | A voided transaction **cannot be edited**: 409 `TRANSACTION_VOIDED` | Editing a record that no longer counts changes nothing financially, but rewrites what was voided. |
| **V3** | There is **no unvoid** | Follows from V1. Archive and unarchive are reversible because they are lifecycle, not a financial fact. |
| **V4** | `voidedAt` is the only void state for the MVP: no `voidedBy`, no `reason` | One local user; a `reason` can be added later as a nullable column (an additive migration). Audit history is Phase 12. |
| **V5** | Voiding a voided transaction is **idempotent** | It returns the transaction unchanged, keeps the original `voidedAt` and produces no other state change, like archiving an archived account. |
| **V6** | A transaction referencing an archived account or category **can be voided** | Voiding adds no reference; it goes in the same direction as removing one (section 4). |
| **V7** | Opening balance uniqueness counts **only non-voided** opening balances | At most one *effective* `OPENING_BALANCE` per account. A voided opening does not reserve the account's opening balance permanently, although it can be neither edited nor unvoided. |
| **V8** | Lists **leave voided transactions out by default** | `includeVoided=true` shows them for history and review; `GET /api/transactions/:id` always returns a transaction, voided or not. |

**V9: voiding does not change `updatedAt`.** The three timestamps of a transaction mean:

| Timestamp | Describes | Changed by |
| --- | --- | --- |
| `createdAt` | the creation of the financial operation | create only |
| `updatedAt` | the latest change to the financial operation itself | create, and an edit that changes the operation |
| `voidedAt` | the lifecycle transition of the operation to void | void only, once (V1, V5) |

- `updatedAt` describes the operation; `voidedAt` describes its lifecycle.
- Voiding creates no new version of the operation and does not recalculate the exchange rate, so
  it does not modify `updatedAt`. The L5 invariant `exchangeRate.recordedAt === updatedAt` holds
  before and after a void, and a void never looks like a new rate recording.
- This differs on purpose from archiving accounts and categories, which sets their `updatedAt`. A
  transaction's `updatedAt` has one more meaning: it supplies the rate's `recordedAt`.

#### The effective ledger

**Invariant: financial calculations consume the effective ledger, never raw persisted transaction
records.** The effective ledger is the set of non-voided transactions, as core `Transaction`
objects.

The responsibilities:

- **The persistence and service layer decides which transactions are effective.** A single
  read-model boundary in the transaction repository is the only place that applies the effective
  condition (`voided_at IS NULL`). It returns the effective ledger, for example through a
  `loadEffectiveLedger()` method; the name matters less than the boundary.
- **The core validates and calculates whatever it is given.** It stays unaware of `voidedAt`, as
  it is of `archivedAt`: `Transaction` has no status.
- **No financial calculation consumes raw records.** This covers balances, overdraft, income and
  expense, the opening balance uniqueness rule, future analytics, snapshots (BR-66), projections
  and Available to Spend. None of them reads the transactions table directly, and none implements
  its own `voided_at IS NULL` filter.

How the boundary is enforced:

- **Two representations.** Methods that can return voided transactions (by id, or lists with
  `includeVoided`) return a `TransactionRecord`: the core transaction together with `voidedAt`,
  `createdAt` and `updatedAt`. Only the effective-ledger boundary returns the bare
  `readonly Transaction[]` that calculations take. Turning raw records into calculation input is a
  deliberate act, visible in review.
- **Tests.** A test asserts that voiding a transaction changes every derived value exactly as if
  it had never been recorded, while the transaction stays readable by id and with `includeVoided`.
- **Future SQL aggregation** (ADR-0002) reads the same effective set: through the same boundary,
  or a database view defined once from the same condition, never a filter repeated in each query.

### 9. API semantics

*Approved direction (L7-E).*

| Operation | Route | Semantics |
| --- | --- | --- |
| Create | `POST /api/transactions` | One operation of one of the six types; 201 |
| Read | `GET /api/transactions`, `GET /api/transactions/:id` | Lists leave voided transactions out unless `includeVoided=true`; by id, voided ones are returned too (V8) |
| Edit | `PUT /api/transactions/:id` | Full replacement of the operation (section 7) |
| Void | `POST /api/transactions/:id/void` | Sub-resource action (ADR-0003), irreversible (V1), idempotent (V5); no unvoid route (V3) |
| Delete | none | `DELETE` is 404 `ROUTE_NOT_FOUND` |

- `PATCH` remains the convention for simple, independent resources (ADR-0003).
- Transactions use full replacement because their fields, postings, currencies and rate are
  interdependent. A merge would have to rebuild the operation from postings, and would be
  ambiguous (which amount of a conversion with a fee?). A full body also makes an empty or non-JSON
  body fail validation, instead of becoming a no-op.
- ADR-0003 gains a paragraph for full-replacement resources and for void actions.
- The request speaks in operations, never in postings ("Users never see debit/credit"); responses
  may include postings for reading.
- The existing `PATCH` Content-Type defect still has to be fixed before the existing `PATCH`
  endpoints are relied upon; it is outside this ADR.

### 10. Opening balances

*Approved direction (L10).*

- **At most one effective `OPENING_BALANCE` per account:** voided opening balances do not count
  (V7).
- **Optional:** an account that starts at zero has no opening balance. A zero opening balance is
  never recorded, which the core already enforces (no zero postings).
- **No temporal rule:** it does not have to be the account's oldest transaction.
- Editable under the refined BR-23. It can be voided like any other transaction.
- **Where the rule lives:** the rule is financial, so it belongs to the core, as a pure function
  over the account's transactions, for example `assertSingleOpeningBalance(accountId, transactions)`.
  The service runs it over the effective ledger (section 8) as it would be after the write: on an
  edit, the transaction's current version is replaced by the new one. It runs inside the same
  database transaction as the write. The core performs no persistence. The database cannot express it,
  because the account sits on a posting, not on the transaction row.
- Correcting a starting point means editing the opening balance. Adjustments over time belong to
  reconciliation (BR-64, `ADJUSTMENT`, after the MVP), not to a second opening balance.

### 11. Where the ledger rules live

| Rule | `@solvia/core` | Service | Database |
| --- | --- | --- | --- |
| Balanced per currency, ≥ 2 postings, no zero, at most two currencies | ✅ | | integrity test (fact 6) |
| Account postings in the account's currency, category signs, type rules | ✅ | | |
| Net-clearing rule and derived rate (5.1) | ✅ | | |
| Two currencies only for `CONVERSION` and foreign `EXPENSE` (L4b) | ✅ | | |
| At most one effective opening balance per account (10, V7) | ✅ pure function | loads the effective ledger and runs it in the write transaction | |
| Account or category exists | ✅ (references) | loads them | FK |
| No new reference to archived entities (4) | | ✅ | |
| `id`, `createdAt`, `type` immutable; no-op edits | | ✅ | |
| Void: irreversible, not editable, idempotent | | ✅ | |
| Which transactions are effective (non-voided) | unaware | ✅ one read-model boundary | `voided_at` |
| `*_IN_USE`, `CATEGORY_HAS_CHILDREN` precedence | | ✅ | `RESTRICT` (safety net) |
| Atomic write | | ✅ owns the transaction | SQLite transaction |
| Exactly one posting target (L1, L2) | | | structural `CHECK` |
| System postings only from domain operations (L1) | ✅ factories | requests never carry postings | |
| Balance, overdraft | ✅ derived | supplies the effective ledger | no column |
| Money as `bigint`, rates as exact text | ✅ | | `INTEGER` / `TEXT` |

Not delegated to the database, although expressible: the zero sum (a trigger), category signs, the
currency of account postings (a composite foreign key), and system role values. They are financial
rules, and the core is their only definition.

### 12. Tables

- **`transactions`:**
  - `id`, `date` (`YYYY-MM-DD`), `description`, `type`;
  - `exchange_rate` (nullable `TEXT`, L5);
  - `voided_at` (nullable);
  - `created_at`, `updated_at`.

  No total or balance column.
- **`postings`:** as in section 2. `position` keeps the core order, so a transaction read back
  equals the one the core built.

### 13. Migration strategy

*Approved direction (L6).*

**This strategy is mandatory** for every future migration that rebuilds an SQLite table with
foreign key dependencies (a table that references others, is referenced, or references itself).
It must always come with data-bearing migration tests. The runner applies it to every migration, so
authors do not opt in.

**Kinds of migration:**

- **Additive** (no rebuild): `CREATE TABLE`, including foreign keys to existing tables;
  `CREATE INDEX`; `ALTER TABLE … ADD COLUMN`, nullable or with a default. Slice 5's ledger
  migration is additive: it creates `transactions` and `postings` and touches no existing table.
- **Rebuild:** changing a column's type or nullability, adding or changing a `CHECK` or a foreign
  key, or dropping a constrained column. drizzle-kit's `__new_<table>` pattern fails on real data
  today (fact 4).

**The migration runner turns foreign keys off around the transaction and checks them before
committing.** `migrateDatabase` will:

1. write and verify the backup (unchanged);
2. `PRAGMA foreign_keys = OFF`, **before** the transaction;
3. `BEGIN`, apply every pending migration and record it in `__drizzle_migrations` exactly as
   Drizzle does;
4. run `PRAGMA foreign_key_check`, and roll back with an error if it returns any row;
5. `COMMIT`;
6. `PRAGMA foreign_keys = ON`, in a `finally`.

The runner reads the files with Drizzle's `readMigrationFiles`; the file format, `db:generate` and
the CI drift check do not change.

**Never:**
- edit a committed migration;
- turn foreign keys off at application runtime;
- add `CASCADE` or `DELETE` statements to make a migration pass;
- rely on `defer_foreign_keys` or on `NO ACTION` (fact 4).

**Procedure for migration authors:**

1. Run `npm run db:generate` and read the SQL. If it contains `__new_` or `DROP TABLE`, it is a
   rebuild: say so in the commit.
2. A migration that touches an existing table gets a test that:
   - migrates a database seeded at the previous migration with representative data (accounts with
     a limit above `Number.MAX_SAFE_INTEGER`, a category hierarchy, transactions in both currencies
     including a voided one, manual rates);
   - asserts every row is preserved, `foreign_key_check` is empty and foreign keys are on
     afterwards.
3. The runner has a test where a migration that would leave an orphan is rolled back entirely.

### 14. Balance dates

*Deferred.*

`calculateAccountBalance` ignores transaction dates: it sums every posting it receives, including a
transaction dated in the future. Slice 5 keeps this behaviour. Whether a balance is "as of today",
"as of a date" or includes future-dated facts is decided with planning, forecasts and Available to
Spend (Phases 5, 8 and 9). No approved rule in slice 5 requires changing it.

## Alternatives considered

| Topic | Option | Why not |
| --- | --- | --- |
| Atomicity | Repositories called in sequence | A failure between calls leaves half a transaction |
| Atomicity | A repository that opens its own transaction | The service's reads (archived, `*_IN_USE`, uniqueness) would sit outside it |
| Posting target | Two columns (`account_id`, `category_id`) | Cannot store `SYSTEM` postings |
| Posting target | `target_id` + `target_kind` without foreign keys | Loses referential integrity |
| Posting target | One table per target kind | A transaction split across three tables: harder to read in order, edit and test |
| Delete behaviour | `CASCADE` / `SET NULL` | Erases or orphans financial history |
| Rate validation | Exactly one clearing posting per currency | Stricter than the current core, which accepts several; the net is what defines the rate |
| Rate validation | Convert one leg with `convertMoney` and compare | Differs by cents on large amounts, because the rate is rounded from the legs |
| Transaction rates | Rows in `exchange_rates` with source `TRANSACTION` | Changes slice 4's reporting answers and conflicts with editing |
| Transaction rates | Two columns (`exchange_rate`, `exchange_rate_recorded_at`) with a both-or-neither `CHECK` | A second timestamp and a second constraint; `updatedAt` already says when the transaction version was recorded |
| FK safety net | Translate a foreign key violation into 409 | Hides a missing service check behind an expected-looking conflict |
| Editing | `PATCH` merge | Has to rebuild the operation from its postings; ambiguous; a second validation path |
| Removing transactions | Physical `DELETE` | Erases facts (BR-02); silently changes past reports and future links (planning, debts, installments) |
| Removing transactions | No removal at all | A duplicate or a wrong-type entry could never stop counting |
| Removing transactions | Reversal (BR-61) now | Creates postings, which on an archived account would conflict with section 4; BR-61 stays "Later" |
| Void | Reversible void, `voidedBy`, `reason` | Silent re-correction (BR-64); a single user; `reason` can be added later |
| Opening balances | Several per account | Turns them into adjustments, which belong to reconciliation (BR-64) |
| Opening balances | Mandatory, or required to be the oldest transaction | Contradicts current behaviour (zero is no opening) and adds a temporal rule nothing requires |
| Migrations | `defer_foreign_keys`, `NO ACTION` | Verified not to help (fact 4) |
| Migrations | Foreign keys off, check after commit, restore the backup on violation | Works, but a rollback becomes a restore |

## Consequences

- A transaction and its postings are always all there or not there at all.
- No transaction is ever deleted: not through accounts, categories, cascades, migrations or the
  transaction API. Mistakes are edited (BR-23, refined), which replaces the previous version of the
  operation (history of edits is deferred to Phase 12), or voided, which keeps everything.
- The rate stored on a transaction is always the one its legs imply. The core guarantees it,
  whoever builds the transaction.
- Derived values come from one effective ledger, so a voided transaction cannot leak into a balance
  through a forgotten filter.
- Future schema changes on tables with foreign keys become possible on real data, with an automatic
  integrity check and rollback.
- Ledger services are synchronous by design.

## Deferred concerns

| Concern | Where it belongs |
| --- | --- |
| Balances ignore dates (section 14) | Planning, forecast, Available to Spend (Phases 5, 8, 9) |
| History of edits (who changed what, previous versions) | Phase 12 (audit) |
| Reversal, refund, cashback (BR-60 to BR-62) | Later |
| Reconciliation adjustments (BR-64, `ADJUSTMENT`) | After the MVP |
| Using `TRANSACTION` rates for reporting; reporting in EUR (BR-12) | Phase 8 |
| SQL aggregation of balances | When needed, equal to the core (ADR-0002) |
| A `reason` for voids | Additive column, when wanted |

## Preconditions before slice 5 implementation

1. This ADR is accepted.
2. `business-rules.md` records the new and refined rules: BR-23 refined, the net-clearing rule, the
   two-currency restriction, at most one opening balance, and void. The ADR-0003 amendment for
   full replacement and void actions is written.
3. The order inside slice 5:
   1. core rules (5.1, L4b, opening balance uniqueness);
   2. the migration runner (L6);
   3. the ledger migration;
   4. repositories and services;
   5. API.

## Consequences for slice 5

**Slice 5 must:**

- **Core:**
  - add the net-clearing rule and the two-currency restriction to `assertValidTransaction`;
  - keep system postings created only by the factories (requests carry operations, never postings);
  - add the pure opening balance uniqueness rule;
  - check the existing fixtures against the new rule.
- **Persistence:**
  - create `transactions` (with `voided_at`) and `postings` in one additive migration, with
    `RESTRICT` foreign keys, the shape constraint and the indexes;
  - give repositories a `DbExecutor`;
  - add the single effective-ledger boundary (section 8); no calculation reads raw records.
- **Use cases:** create, edit (full replacement), void and read the six types, each atomic, with:
  - the archived transition rule (4);
  - the immutables;
  - no-op edits;
  - V1 to V9, with 409 `TRANSACTION_VOIDED` on editing a voided transaction, and `updatedAt`
    unchanged by a void.
- **Accounts and categories:** `ACCOUNT_IN_USE` and `CATEGORY_IN_USE` on delete, in the same pull
  request that persists postings.
- **API:**
  - `POST`, `GET`, `PUT` and `POST /:id/void` on `/api/transactions`, with no `DELETE`;
  - account balance and overdraft, derived from the effective ledger.
- **Tests:**
  - atomicity: a failure injected after the transaction row and the first posting leaves both
    tables untouched, for create and for edit;
  - the integrity test of at least two postings;
  - the archived transition table, for accounts and categories;
  - the valid and invalid rate examples of 5.1;
  - voiding is equivalent to never recording, for every derived value;
  - opening balance uniqueness, including after voiding;
  - `exchangeRate.recordedAt === updatedAt` for two-currency transactions, after create and edit;
  - a foreign key violation reaching the error handler returns 500, while `*_IN_USE` returns 409;
  - migration on data, and runner rollback.

**Not in slice 5:**

- planning, budgets, statements, installments, debts, goals or reconciliation;
- reversal, refund and cashback;
- `ADJUSTMENT`;
- reporting and analytics, including `TRANSACTION` rates for reporting;
- external rates;
- edit history;
- the UI;
- backup, restore and export (slice 6);
- changing balance date semantics;
- security hardening and the `PATCH` Content-Type fix (separate work).

## Decision log

| Id | Decision | Status |
| --- | --- | --- |
| L1 | Three mutually exclusive posting targets (`account_id`, `category_id`, `system_role`); `system_role` is internal, created only by domain operations | Approved 2026-10-03 |
| L2 | Structural `CHECK` constraints allowed; domain and financial invariants stay in the core | Approved 2026-10-03 |
| L3 | Keep, remove or change archived references; never add one; same rule for accounts and categories; refined BR-23 | Approved 2026-10-01 |
| L4 | Net-clearing rule; the stored rate equals the rate derived from the nets | Approved 2026-10-01 |
| L4b | Two currencies only for `CONVERSION` and foreign `EXPENSE` | Approved 2026-10-01 |
| L5 | One `exchange_rate` column; `exchangeRate.recordedAt === transaction.updatedAt` | Approved 2026-10-03 |
| L6 | Migration runner: foreign keys off before the transaction, `foreign_key_check` before commit, rollback on violation; mandatory, with data-bearing tests | Approved 2026-10-03 |
| L7-A | All six transaction types in slice 5 | Approved 2026-10-01 |
| L7-B | Creation pipeline; integrity test of at least two postings | Approved 2026-10-01 |
| L7-C | Editing by full replacement; `id`, `createdAt`, `type` immutable | Approved 2026-10-01 |
| L7-D | No physical delete; void | Approved 2026-10-01 |
| L7-E | `PUT` full replacement for transactions; `PATCH` stays for simple resources | Approved 2026-10-01 |
| L9 | Expected conflicts 409; foreign key violation from a defect 500 | Approved 2026-10-03 |
| L10 | At most one effective opening balance per account, optional, no temporal rule | Approved 2026-10-01 |
| V1–V8 | Void semantics (section 8) | Approved 2026-10-03 |
| Effective ledger | Financial calculations consume the effective ledger, never raw records | Approved 2026-10-03 |
| V9 | Voiding does not change `updatedAt`; `updatedAt` describes the operation, `voidedAt` its lifecycle | Approved 2026-10-03 |
