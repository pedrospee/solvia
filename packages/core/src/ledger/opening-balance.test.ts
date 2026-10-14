import { describe, expect, it } from "vitest";
import { assertOneOpeningBalancePerAccount } from "./opening-balance.ts";
import { demoBankEur, demoDate, demoWiseEur, eur, foodCategory } from "./test-fixtures.ts";
import type { Transaction } from "./transaction.ts";
import {
  createExpenseTransaction,
  createOpeningBalanceTransaction,
} from "./transaction-factories.ts";

const opening = (id: string, account = demoBankEur, balance = "1000.00"): Transaction =>
  createOpeningBalanceTransaction({
    id,
    date: demoDate,
    description: "Opening balance",
    account,
    balance: eur(balance),
  });

const expense = createExpenseTransaction({
  id: "t-expense",
  date: demoDate,
  description: "Groceries",
  paidFrom: demoBankEur,
  category: foodCategory,
  amount: eur("10.00"),
});

describe("at most one opening balance per account (BR-25)", () => {
  it("accepts no opening balance at all: it is optional", () => {
    expect(() => assertOneOpeningBalancePerAccount([expense])).not.toThrow();
    expect(() => assertOneOpeningBalancePerAccount([])).not.toThrow();
  });

  it("accepts one opening balance per account, in any position in the ledger", () => {
    const ledger = [expense, opening("t-open-bank"), opening("t-open-wise", demoWiseEur)];

    expect(() => assertOneOpeningBalancePerAccount(ledger)).not.toThrow();
  });

  it("rejects a second opening balance for the same account", () => {
    const ledger = [opening("t-open-1"), expense, opening("t-open-2", demoBankEur, "500.00")];

    expect(() => assertOneOpeningBalancePerAccount(ledger)).toThrowError(
      expect.objectContaining({
        code: "INVALID_TRANSACTION",
        message: expect.stringMatching(/t-open-2/),
      }),
    );
  });

  it("judges only the transactions it is given: the caller passes the effective ledger", () => {
    // The service leaves voided transactions out, and replaces an edited one by its new version.
    const voidedLeftOut = [opening("t-open-new")];
    const editedReplaced = [opening("t-open-1", demoBankEur, "1200.00"), expense];

    expect(() => assertOneOpeningBalancePerAccount(voidedLeftOut)).not.toThrow();
    expect(() => assertOneOpeningBalancePerAccount(editedReplaced)).not.toThrow();
  });
});
