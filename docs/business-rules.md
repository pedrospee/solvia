# Business Rules

Every approved financial rule, with the phase that implements it. A rule is ✅ only when automated tests cover it; the test file is listed.

## General

| ID | Rule | Status |
| --- | --- | --- |
| BR-01 | The system informs and simulates; it never makes financial decisions. Debt, cash flow, liquidity, future commitments and payment capacity are priority metrics. | Principle |
| BR-02 | A ledger transaction is always something that happened. Planned items never count as actual. | ✅ Structural (ledger has no "planned" state) · planning in Phase 5 |
| BR-03 | Every transaction keeps the ledger balanced; invalid transactions are rejected. | ✅ `transaction-validation.test.ts` |
| BR-04 | Values that can be either real or calculated are labelled **Actual** or **Estimated**. | Phase 3+ |
| BR-05 | Only fictitious data in code, seeds and tests. | ✅ `test-fixtures.ts` |

## Money and currencies

| ID | Rule | Status |
| --- | --- | --- |
| BR-10 | Money is integer minor units (`bigint`) plus currency. No floating point. | ✅ `money.test.ts` |
| BR-11 | EUR and BRL are both native; BRL is never permanently converted to EUR. | ✅ `exchange-rate.test.ts` |
| BR-12 | Reporting currency is EUR (net worth, dashboard, projections), configurable later. | Phase 8 |
| BR-13 | `EUR/BRL = 6.00` means `1 EUR = 6 BRL`, everywhere. | ✅ `exchange-rate.test.ts` |
| BR-14 | Division is deterministic; the remainder goes explicitly to the last parts: €1,000 / 3 = 333.33 + 333.33 + 333.34. Conversions round half away from zero. | ✅ `money.test.ts`, `decimal.test.ts` |
| BR-15 | Same-currency transactions store one currency only. A rate is stored only for real cross-currency operations (conversion, foreign purchase). | ✅ `transaction-validation.test.ts`, `financial-scenarios.test.ts` |
| BR-16 | In a real conversion, the actual amounts of both legs are the truth; the executed rate is derived from them. Fees are recorded separately. | ✅ `financial-scenarios.test.ts` |
| BR-17 | Current reports use the rate in force today; historical analysis uses the rate in force on that date. The original amount is never replaced. | ✅ `exchange-rate-history.test.ts` |
| BR-18 | A conversion is neither income nor expense (its fee is an expense). | ✅ `financial-scenarios.test.ts` |
| BR-19 | Value changes caused only by rate movements are an **FX effect**, never income or expense. Analytics separate cash flow, operating result, FX effect and investment performance. | Mechanism ✅ `exchange-rate-history.test.ts` · reporting Phase 8 |

## Exchange rates

| ID | Rule | Status |
| --- | --- | --- |
| BR-80 | EUR/BRL is the one representation of a rate: EUR is the base, BRL the quote (`6.2` means 1 EUR = 6.20 BRL). Manual and executed rates are recorded as EUR/BRL; a BRL/EUR rate is never recorded, it is derived (BR-82). Manual rates are typed in by the user, with source `MANUAL`; `TRANSACTION` rates come from real operations (slice 5); external rates are not supported (Phase 11). | ✅ `exchange-rate.test.ts`, `exchange-rate-service.test.ts` |
| BR-81 | Manual rates are append-only: a correction is a new rate, and the original stays in the history. Several rates may share a date; the one recorded last (`recordedAt`, set by the server) is in force for that date. A rate is never edited or deleted. | ✅ `exchange-rate-service.test.ts`, `exchange-rates.test.ts` |
| BR-82 | The inverse of a rate (`1 / rate`) is a domain operation, rounded half away from zero to ten decimal places: EUR/BRL 6.2 → BRL/EUR 0.1612903226. Inverting twice returns the original only within that precision. Converting money is always `convertMoney`, which reads a rate in either direction without inverting it. | ✅ `exchange-rate.test.ts` |
| BR-83 | A rate is an exact decimal string, positive, with at most ten decimal places of value, in canonical form: no leading or trailing zeros (`06.20` → `6.2`), so one value has one spelling. A manual rate must be invertible within that precision. | ✅ `exchange-rate.test.ts` |
| BR-84 | Only EUR and BRL exist, and only `CONVERSION` and an `EXPENSE` with a foreign charge may involve both; every other type is single-currency. In a two-currency transaction, `netEUR` and `netBRL` (the sums of its `EXCHANGE_CLEARING` postings in each currency) are both non-zero and of opposite signs, and the stored rate is exactly the executed rate derived from `abs(netEUR)` and `abs(netBRL)`: EUR/BRL, source `TRANSACTION`, `effectiveDate` equal to the transaction date, with the precision and rounding of `calculateExecutedRate`. The rate is never validated by converting a leg with `convertMoney`. The number of clearing postings per currency is not restricted. | Slice 5 ([ADR-0004](adr/0004-ledger-persistence.md)) |

## Accounts and transfers

| ID | Rule | Status |
| --- | --- | --- |
| BR-20 | Balances are derived from the ledger, starting from an opening-balance transaction. | ✅ `financial-scenarios.test.ts` |
| BR-21 | An internal transfer changes balances with zero income, zero expense and unchanged total. Transfers are only between own asset accounts in the same currency. | ✅ `financial-scenarios.test.ts`, `transaction-validation.test.ts` |
| BR-22 | Overdraft is a negative balance of the bank account itself, with a limit; no separate liability. Only `BANK` accounts may have an `overdraftLimit`: in the account's currency, greater than zero; absent means no limit. Derived: `used = max(0, −balance)`, `remaining = max(0, limit − used)`, `exceeded = max(0, used − limit)`, `availableIncludingOverdraft = max(0, balance + limit)` (not BR-65's Available to Spend). Without a limit the derived values are null. The limit never blocks the ledger: going beyond it is recorded and shows as `exceeded`. | ✅ `overdraft.test.ts`, `financial-scenarios.test.ts` |
| BR-23 | Past transactions can be edited in the MVP, as a full replacement of the operation (`PUT`). An edit passes the same domain validation as creation, keeps the ledger balanced, and recalculates every derived value, including postings and the transaction rate. `id`, `type` and `createdAt` never change. An edit may keep or remove a reference to an archived account or category, or change it to an active one, but never adds a new reference to an archived one. An edit replaces the current version of the operation; history of versions is deferred to Phase 12. `updatedAt` changes only when the operation changes. A voided transaction cannot be edited (BR-24), and a transaction is never physically deleted. | Slice 5 ([ADR-0004](adr/0004-ledger-persistence.md)) |
| BR-24 | A mistaken transaction is **voided**, never deleted. Its postings stay persisted and it remains identifiable, but it no longer counts: every financial calculation (balances, overdraft, reports) uses only the **effective ledger**, the non-voided transactions. Voiding creates no postings, is irreversible (there is no unvoid) and idempotent, and is allowed on a transaction referencing an archived account or category. A voided transaction cannot be edited. Lists leave voided transactions out unless `includeVoided=true`; one is always retrievable by id. `voidedAt` is the only void state in the MVP. Timestamps: `createdAt` is when the operation was created, `updatedAt` its latest change, `voidedAt` when it was voided. Voiding does not change `updatedAt` and does not recalculate the exchange rate. | Slice 5 ([ADR-0004](adr/0004-ledger-persistence.md)) |
| BR-25 | An account has at most one **effective** `OPENING_BALANCE` (voided ones do not count). It is optional: a zero opening balance means no opening transaction (refines BR-20). It does not have to be the account's earliest transaction. It can be edited (BR-23); uniqueness is then checked over the effective ledger as it will be after the write, with the current version replaced by the new one. It is voided like any other transaction (BR-24). | Slice 5 ([ADR-0004](adr/0004-ledger-persistence.md)) |

## Categories

| ID | Rule | Status |
| --- | --- | --- |
| BR-70 | A child category has the same `nature` (`INCOME` or `EXPENSE`) as its parent. | ✅ `category.test.ts` |
| BR-71 | Categories have at most two levels, parent → child. A parent is a top-level category, so a category with children cannot become a child. The whole resulting tree is validated, never a change in isolation. | ✅ `category.test.ts` |

A posting may target a parent category directly, even when it has children. How reports aggregate
a parent with its children is decided with analytics (Phase 8); no posting is ever counted twice
because of the hierarchy (`category.test.ts`).

## Debts

| ID | Rule | Status |
| --- | --- | --- |
| BR-30 | Every obligation is a liability account. `DebtTerms` describe it and never hold a second balance. | Liability accounts ✅ · terms in Phase 3 |
| BR-31 | All debt types (credit card, overdraft, loan, financing, informal, personal, other) share behaviour driven by account nature and terms. | ✅ `getAccountNature` · terms in Phase 3 |
| BR-32 | Persisted statuses: `ACTIVE`, `RENEGOTIATED`, `CANCELLED`, `PAID_OFF`. Overdue, progress and % paid are derived. | Phase 3 |
| BR-33 | A payment decreases cash and the liability, and never creates a second expense. | ✅ card payments · debt payments in Phase 3 |
| BR-34 | Interest is reconciled from statements (`previous + interest + charges − payment = current`), not computed in the ledger. Calculated interest is only for simulations. | Phase 3, 6 |

## Credit cards

| ID | Rule | Status |
| --- | --- | --- |
| BR-40 | A card purchase creates a liability; the bank balance is unchanged. | ✅ `financial-scenarios.test.ts` |
| BR-41 | Installments: the budget gets the installment amount each month; the committed limit and the liability equal the total still unpaid; the schedule controls due dates. | Phase 4 |
| BR-42 | A purchase belongs to the statement whose period contains its date; a purchase on the closing day belongs to the statement being closed. Configurable per card later. | Phase 4 |
| BR-43 | Financial periods use local dates (`YYYY-MM-DD`), never time or time zone. | ✅ `local-date.test.ts` |

## Goals

| ID | Rule | Status |
| --- | --- | --- |
| BR-50 | A goal is a virtual allocation by default. It may be linked to an account without duplicating money. Physical money and virtual allocations are distinguished. | Phase 7 |

## Future-ready

The ledger must support these without structural change.

| ID | Rule | Status |
| --- | --- | --- |
| BR-60 | Refund: economically reverses the original expense. | Later |
| BR-61 | Reversal: corrects an operation without deleting history. | Later |
| BR-62 | Cashback: an inflow, not a silent reduction of the original expense. | Later |
| BR-63 | Split transaction: several categories summing exactly to the total. | Supported by postings · UI later |
| BR-64 | Reconciliation: compare system and bank balances and record an explicit adjustment; never correct silently. | After MVP |
| BR-65 | **Available to Spend** = available cash − upcoming obligations − planned debt payments − required goal contributions − minimum reserve. Always an estimate with its assumptions; never called "safe". | Phase 8–9 |
| BR-66 | Monthly snapshots are historical photographs for analytics; they never replace the ledger. | Phase 8 |
| BR-67 | Scenarios are simulations and never change real data. | Phase 6+ |
