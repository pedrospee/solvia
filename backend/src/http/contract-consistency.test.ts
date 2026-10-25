import {
  type AccountKindJson,
  accountKindSchema,
  type CategoryNatureJson,
  type CurrencyJson,
  currencySchema,
  type ExchangeRateSourceJson,
  exchangeRateSourceSchema,
  type SystemPostingRoleJson,
  type TransactionTypeJson,
  transactionTypeSchema,
} from "@solvia/contracts";
import {
  type AccountKind,
  ASSET_ACCOUNT_KINDS,
  type CategoryNature,
  CURRENCIES,
  type Currency,
  EXCHANGE_RATE_SOURCES,
  type ExchangeRateSource,
  LIABILITY_ACCOUNT_KINDS,
  type SystemPostingRole,
  TRANSACTION_TYPES,
  type TransactionType,
} from "@solvia/core";
import { describe, expect, expectTypeOf, it } from "vitest";

// @solvia/contracts deliberately does not depend on @solvia/core (ADR-0003), so the
// values both packages define are duplicated. The backend sees both and checks they
// stay identical: the type assertions fail `npm run typecheck`, the others fail tests.
describe("contracts stay consistent with the core", () => {
  it("currencies", () => {
    expectTypeOf<CurrencyJson>().toEqualTypeOf<Currency>();
    expect(currencySchema.options).toEqual(CURRENCIES);
  });

  it("account kinds", () => {
    expectTypeOf<AccountKindJson>().toEqualTypeOf<AccountKind>();
    expect(accountKindSchema.options).toEqual([...ASSET_ACCOUNT_KINDS, ...LIABILITY_ACCOUNT_KINDS]);
  });

  it("category natures", () => {
    // The core has no runtime list of natures, so the type check is the guard.
    expectTypeOf<CategoryNatureJson>().toEqualTypeOf<CategoryNature>();
  });

  it("transaction types and system posting roles", () => {
    expectTypeOf<TransactionTypeJson>().toEqualTypeOf<TransactionType>();
    expect(transactionTypeSchema.options).toEqual(TRANSACTION_TYPES);
    // The core has no runtime list of system roles, so the type check is the guard.
    expectTypeOf<SystemPostingRoleJson>().toEqualTypeOf<SystemPostingRole>();
  });

  it("exchange rate sources", () => {
    expectTypeOf<ExchangeRateSourceJson>().toEqualTypeOf<ExchangeRateSource>();
    expect(exchangeRateSourceSchema.options).toEqual(EXCHANGE_RATE_SOURCES);
  });
});
