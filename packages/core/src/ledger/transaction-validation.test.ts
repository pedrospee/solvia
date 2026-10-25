import { describe, expect, it } from "vitest";
import { createExchangeRate } from "../exchange/exchange-rate.ts";
import { negateMoney } from "../money/money.ts";
import { createAccount, getAccountNature } from "./account.ts";
import { createCategory } from "./category.ts";
import {
  allDemoAccounts,
  allDemoCategories,
  brl,
  demoBankEur,
  demoCreditCard,
  demoDate,
  demoRecordedAt,
  demoWiseBrl,
  demoWiseEur,
  eur,
  foodCategory,
  salaryCategory,
} from "./test-fixtures.ts";
import type { Posting, Transaction } from "./transaction.ts";
import {
  createExpenseTransaction,
  createIncomeTransaction,
  createTransferTransaction,
} from "./transaction-factories.ts";
import { assertValidTransaction, type LedgerReferences } from "./transaction-validation.ts";

const references: LedgerReferences = { accounts: allDemoAccounts, categories: allDemoCategories };

function transactionWith(postings: Posting[], overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "t-test",
    date: demoDate,
    description: "Test",
    type: "EXPENSE",
    postings,
    ...overrides,
  };
}

const bankPosting = (amount: ReturnType<typeof eur>): Posting => ({
  target: { kind: "ACCOUNT", accountId: demoBankEur.id },
  amount,
});
const foodPosting = (amount: ReturnType<typeof eur>): Posting => ({
  target: { kind: "CATEGORY", categoryId: foodCategory.id },
  amount,
});

function expectRejection(transaction: Transaction, code: string) {
  expect(() => assertValidTransaction(transaction, references)).toThrowError(
    expect.objectContaining({ code }),
  );
}

describe("ledger balance (BR-03)", () => {
  it("accepts a balanced transaction", () => {
    const valid = transactionWith([foodPosting(eur("10.00")), bankPosting(eur("-10.00"))]);

    expect(() => assertValidTransaction(valid, references)).not.toThrow();
  });

  it("rejects postings that do not sum to zero", () => {
    expectRejection(
      transactionWith([foodPosting(eur("10.00")), bankPosting(eur("-9.99"))]),
      "UNBALANCED_TRANSACTION",
    );
  });

  it("rejects fewer than two postings and zero amounts", () => {
    expectRejection(transactionWith([foodPosting(eur("10.00"))]), "INVALID_TRANSACTION");
    expectRejection(
      transactionWith([foodPosting(eur("0")), bankPosting(eur("0"))]),
      "INVALID_TRANSACTION",
    );
  });

  it("rejects an empty description", () => {
    expectRejection(
      transactionWith([foodPosting(eur("1")), bankPosting(eur("-1"))], { description: "  " }),
      "INVALID_TRANSACTION",
    );
  });
});

describe("references", () => {
  it("rejects unknown accounts and categories", () => {
    expectRejection(
      transactionWith([
        foodPosting(eur("1")),
        { target: { kind: "ACCOUNT", accountId: "missing" }, amount: eur("-1") },
      ]),
      "INVALID_TRANSACTION",
    );
    expectRejection(
      transactionWith([
        { target: { kind: "CATEGORY", categoryId: "missing" }, amount: eur("1") },
        bankPosting(eur("-1")),
      ]),
      "INVALID_TRANSACTION",
    );
  });

  it("rejects an amount in a currency the account does not hold", () => {
    expectRejection(
      transactionWith([
        { target: { kind: "CATEGORY", categoryId: foodCategory.id }, amount: brl("1") },
        { target: { kind: "ACCOUNT", accountId: demoBankEur.id }, amount: brl("-1") },
      ]),
      "CURRENCY_MISMATCH",
    );
  });
});

describe("currencies and exchange (BR-15)", () => {
  const foreignPostings: Posting[] = [
    { target: { kind: "CATEGORY", categoryId: foodCategory.id }, amount: brl("60.00") },
    { target: { kind: "SYSTEM", role: "EXCHANGE_CLEARING" }, amount: brl("-60.00") },
    { target: { kind: "SYSTEM", role: "EXCHANGE_CLEARING" }, amount: eur("10.00") },
    bankPosting(eur("-10.00")),
  ];
  const rate = createExchangeRate({
    baseCurrency: "EUR",
    quoteCurrency: "BRL",
    rate: "6",
    effectiveDate: demoDate,
    source: "TRANSACTION",
    recordedAt: demoRecordedAt,
  });

  it("requires the exchange rate when two currencies are involved", () => {
    expectRejection(transactionWith(foreignPostings), "INVALID_TRANSACTION");
    expect(() =>
      assertValidTransaction(transactionWith(foreignPostings, { exchangeRate: rate }), references),
    ).not.toThrow();
  });

  it("does not store an exchange rate on a single-currency transaction", () => {
    expectRejection(
      transactionWith([foodPosting(eur("1")), bankPosting(eur("-1"))], { exchangeRate: rate }),
      "INVALID_TRANSACTION",
    );
  });

  it("requires the amount charged when an expense is paid in another currency", () => {
    expect(() =>
      createExpenseTransaction({
        id: "t-foreign",
        date: demoDate,
        description: "Foreign purchase",
        paidFrom: demoBankEur,
        category: foodCategory,
        amount: brl("60.00"),
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_TRANSACTION" }));
  });
});

describe("transaction types", () => {
  it("rejects a transfer to a credit card (that is a card payment)", () => {
    expect(() =>
      createTransferTransaction({
        id: "t-transfer-card",
        date: demoDate,
        description: "Wrong type",
        from: demoBankEur,
        to: demoCreditCard,
        amount: eur("50.00"),
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_TRANSACTION" }));
  });

  it("rejects a transfer between accounts in different currencies (that is a conversion)", () => {
    expect(() =>
      createTransferTransaction({
        id: "t-transfer-fx",
        date: demoDate,
        description: "Wrong type",
        from: demoWiseEur,
        to: demoWiseBrl,
        amount: eur("50.00"),
      }),
    ).toThrowError(expect.objectContaining({ code: "CURRENCY_MISMATCH" }));
  });

  it("rejects a transfer to the same account", () => {
    expect(() =>
      createTransferTransaction({
        id: "t-transfer-self",
        date: demoDate,
        description: "Same account",
        from: demoBankEur,
        to: demoBankEur,
        amount: eur("50.00"),
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_TRANSACTION" }));
  });

  describe("card payments (BR-44)", () => {
    const otherCard = createAccount({
      id: "demo-other-card",
      name: "Other Card",
      kind: "CREDIT_CARD",
      currency: "EUR",
    });
    const accountPosting = (accountId: string, amount: ReturnType<typeof eur>): Posting => ({
      target: { kind: "ACCOUNT", accountId },
      amount,
    });
    const cardPayment = (postings: Posting[]) =>
      transactionWith(postings, { type: "CARD_PAYMENT" });
    const withOtherCard: LedgerReferences = {
      ...references,
      accounts: [...references.accounts, otherCard],
    };

    it("accepts a card paid from asset accounts", () => {
      const valid = cardPayment([
        accountPosting(demoCreditCard.id, eur("80.00")),
        bankPosting(eur("-50.00")),
        accountPosting(demoWiseEur.id, eur("-30.00")),
      ]);

      expect(() => assertValidTransaction(valid, references)).not.toThrow();
    });

    it("rejects a card paid with another card", () => {
      const cardWithCard = cardPayment([
        accountPosting(otherCard.id, eur("100.00")),
        accountPosting(demoCreditCard.id, eur("-100.00")),
      ]);

      expect(() => assertValidTransaction(cardWithCard, withOtherCard)).toThrowError(
        expect.objectContaining({
          code: "INVALID_TRANSACTION",
          message: expect.stringMatching(/never paid with another card/),
        }),
      );
    });

    it("rejects a card paid partly with another card", () => {
      const partlyWithCard = cardPayment([
        accountPosting(otherCard.id, eur("100.00")),
        bankPosting(eur("-60.00")),
        accountPosting(demoCreditCard.id, eur("-40.00")),
      ]);

      expect(() => assertValidTransaction(partlyWithCard, withOtherCard)).toThrowError(
        expect.objectContaining({ code: "INVALID_TRANSACTION" }),
      );
    });

    it("rejects a payment that cancels out on the same card", () => {
      expectRejection(
        cardPayment([
          accountPosting(demoCreditCard.id, eur("100.00")),
          accountPosting(demoCreditCard.id, eur("-100.00")),
        ]),
        "INVALID_TRANSACTION",
      );
    });

    it("rejects a payment where no money leaves an asset account", () => {
      expect(() =>
        assertValidTransaction(
          cardPayment([
            accountPosting(demoCreditCard.id, eur("100.00")),
            accountPosting(otherCard.id, eur("50.00")),
            accountPosting(demoCreditCard.id, eur("-150.00")),
          ]),
          withOtherCard,
        ),
      ).toThrowError(expect.objectContaining({ code: "INVALID_TRANSACTION" }));
    });
  });

  it("rejects income received into a liability account", () => {
    expect(() =>
      createIncomeTransaction({
        id: "t-income-card",
        date: demoDate,
        description: "Wrong account",
        account: demoCreditCard,
        category: salaryCategory,
        amount: eur("50.00"),
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_TRANSACTION" }));
  });

  it("rejects an expense category moving in the income direction", () => {
    expectRejection(
      transactionWith([foodPosting(eur("-5")), bankPosting(eur("5"))]),
      "INVALID_TRANSACTION",
    );
  });

  it("allows the opening-balance posting only in opening balances", () => {
    expectRejection(
      transactionWith([
        foodPosting(eur("5")),
        bankPosting(eur("-5")),
        { target: { kind: "SYSTEM", role: "OPENING_BALANCE_EQUITY" }, amount: eur("1") },
        { target: { kind: "SYSTEM", role: "OPENING_BALANCE_EQUITY" }, amount: eur("-1") },
      ]),
      "INVALID_TRANSACTION",
    );
  });

  it("rejects an opening balance that is not exactly one account and the opening-balance equity", () => {
    const equity = (amount: ReturnType<typeof eur>): Posting => ({
      target: { kind: "SYSTEM", role: "OPENING_BALANCE_EQUITY" },
      amount,
    });
    const wisePosting = (amount: ReturnType<typeof eur>): Posting => ({
      target: { kind: "ACCOUNT", accountId: demoWiseEur.id },
      amount,
    });
    const notOneAndOne = [
      // an income category instead of the equity posting
      [
        bankPosting(eur("10.00")),
        { target: { kind: "CATEGORY", categoryId: salaryCategory.id }, amount: eur("-10.00") },
      ],
      // two accounts
      [bankPosting(eur("10.00")), wisePosting(eur("5.00")), equity(eur("-15.00"))],
      // two equity postings
      [bankPosting(eur("10.00")), equity(eur("-5.00")), equity(eur("-5.00"))],
    ] satisfies Posting[][];

    for (const postings of notOneAndOne) {
      expect(() =>
        assertValidTransaction(transactionWith(postings, { type: "OPENING_BALANCE" }), references),
      ).toThrowError(
        expect.objectContaining({
          code: "INVALID_TRANSACTION",
          message: expect.stringMatching(/exactly one account and one opening-balance posting/),
        }),
      );
    }
  });

  it("rejects non-positive amounts in user operations", () => {
    expect(() =>
      createTransferTransaction({
        id: "t-negative",
        date: demoDate,
        description: "Negative",
        from: demoBankEur,
        to: demoWiseEur,
        amount: negateMoney(eur("10.00")),
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_AMOUNT" }));
  });
});

describe("posting shape: exactly one target, integer minor units, a supported currency", () => {
  /** Builds a posting the type system would not allow, as hand-built or deserialised data could. */
  const raw = (posting: unknown) => posting as Posting;

  it("rejects a posting without a target", () => {
    expectRejection(
      transactionWith([foodPosting(eur("1")), raw({ amount: eur("-1") })]),
      "INVALID_TRANSACTION",
    );
  });

  it("rejects a target that names more than one destination", () => {
    for (const target of [
      { kind: "ACCOUNT", accountId: demoBankEur.id, categoryId: foodCategory.id },
      { kind: "CATEGORY", categoryId: foodCategory.id, role: "EXCHANGE_CLEARING" },
      { kind: "SYSTEM", role: "EXCHANGE_CLEARING", accountId: demoBankEur.id },
    ]) {
      expectRejection(
        transactionWith([foodPosting(eur("1")), raw({ target, amount: eur("-1") })]),
        "INVALID_TRANSACTION",
      );
    }
  });

  it("rejects an unknown target kind and an unknown system role", () => {
    expectRejection(
      transactionWith([
        foodPosting(eur("1")),
        raw({ target: { kind: "GOAL", goalId: "g" }, amount: eur("-1") }),
      ]),
      "INVALID_TRANSACTION",
    );
    expectRejection(
      transactionWith([
        foodPosting(eur("1")),
        raw({ target: { kind: "SYSTEM", role: "SUSPENSE" }, amount: eur("-1") }),
      ]),
      "INVALID_TRANSACTION",
    );
  });

  it("rejects an unsupported currency", () => {
    expectRejection(
      transactionWith([
        raw({
          target: { kind: "CATEGORY", categoryId: foodCategory.id },
          amount: { amountMinor: 100n, currency: "USD" },
        }),
        raw({
          target: { kind: "SYSTEM", role: "EXCHANGE_CLEARING" },
          amount: { amountMinor: -100n, currency: "USD" },
        }),
      ]),
      "INVALID_TRANSACTION",
    );
  });

  it("rejects an amount that is not bigint minor units (BR-10)", () => {
    expectRejection(
      transactionWith([
        raw({
          target: { kind: "CATEGORY", categoryId: foodCategory.id },
          amount: { amountMinor: 10.5, currency: "EUR" },
        }),
        bankPosting(eur("-10.50")),
      ]),
      "INVALID_AMOUNT",
    );
  });
});

describe("accounts and categories", () => {
  it("derives asset or liability nature from the account kind", () => {
    expect(getAccountNature("BANK")).toBe("ASSET");
    expect(getAccountNature("WISE")).toBe("ASSET");
    expect(getAccountNature("CREDIT_CARD")).toBe("LIABILITY");
    expect(getAccountNature("INFORMAL_DEBT")).toBe("LIABILITY");
  });

  it("rejects accounts and categories without a name", () => {
    expect(() => createAccount({ id: "a", name: " ", kind: "CASH", currency: "EUR" })).toThrowError(
      expect.objectContaining({ code: "INVALID_ACCOUNT" }),
    );
    expect(() => createCategory({ id: "c", name: "", nature: "EXPENSE" })).toThrowError(
      expect.objectContaining({ code: "INVALID_CATEGORY" }),
    );
  });
});
