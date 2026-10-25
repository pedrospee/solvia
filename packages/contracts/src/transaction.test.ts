import { describe, expect, it } from "vitest";
import { listTransactionsQuerySchema, transactionOperationSchema } from "./transaction.ts";

const eur = (amountMinor: string) => ({ amountMinor, currency: "EUR" });
const brl = (amountMinor: string) => ({ amountMinor, currency: "BRL" });
const details = { date: "2026-09-15", description: "Fictitious" };

const validOperations = [
  { type: "OPENING_BALANCE", ...details, accountId: "bank", balance: eur("100000") },
  { type: "INCOME", ...details, accountId: "bank", categoryId: "salary", amount: eur("300000") },
  {
    type: "EXPENSE",
    ...details,
    paidFromAccountId: "bank",
    categoryId: "food",
    amount: eur("4590"),
  },
  {
    type: "EXPENSE",
    ...details,
    paidFromAccountId: "card",
    categoryId: "food",
    amount: brl("12000"),
    chargedAmount: eur("2040"),
  },
  {
    type: "TRANSFER",
    ...details,
    fromAccountId: "bank",
    toAccountId: "wise",
    amount: eur("30000"),
  },
  {
    type: "CARD_PAYMENT",
    ...details,
    fromAccountId: "bank",
    cardAccountId: "card",
    amount: eur("50000"),
  },
  {
    type: "CONVERSION",
    ...details,
    fromAccountId: "wise-eur",
    toAccountId: "wise-brl",
    sentAmount: eur("10000"),
    receivedAmount: brl("62000"),
    fee: { categoryId: "fees", amount: eur("100") },
  },
];

describe("transactionOperationSchema", () => {
  it("accepts one operation of each of the six types", () => {
    for (const operation of validOperations) {
      expect(transactionOperationSchema.safeParse(operation).success).toBe(true);
    }
  });

  it("rejects postings, a rate or server fields: requests describe operations (ADR-0004)", () => {
    const expense = validOperations[2] ?? {};
    const forbidden = [
      { postings: [] },
      { exchangeRate: { rate: "6.2" } },
      { id: "chosen-by-client" },
      { createdAt: "2026-09-15T12:00:00.000Z" },
    ];

    for (const extra of forbidden) {
      expect(transactionOperationSchema.safeParse({ ...expense, ...extra }).success).toBe(false);
    }
  });

  it("rejects an unknown type and fields of another type", () => {
    expect(
      transactionOperationSchema.safeParse({ ...details, type: "REFUND", amount: eur("1") })
        .success,
    ).toBe(false);
    expect(
      transactionOperationSchema.safeParse({
        type: "TRANSFER",
        ...details,
        fromAccountId: "bank",
        toAccountId: "wise",
        amount: eur("100"),
        categoryId: "food",
      }).success,
    ).toBe(false);
  });

  it("checks only the representation of amounts and dates", () => {
    const income = validOperations[1] ?? {};

    expect(transactionOperationSchema.safeParse({ ...income, amount: eur("10.50") }).success).toBe(
      false,
    );
    expect(transactionOperationSchema.safeParse({ ...income, date: "15/09/2026" }).success).toBe(
      false,
    );
    // Negative amounts and impossible dates are rules of @solvia/core, not of the contract.
    expect(transactionOperationSchema.safeParse({ ...income, amount: eur("-100") }).success).toBe(
      true,
    );
    expect(transactionOperationSchema.safeParse({ ...income, date: "2026-02-30" }).success).toBe(
      true,
    );
  });
});

describe("listTransactionsQuerySchema", () => {
  it("leaves voided transactions out unless includeVoided=true", () => {
    expect(listTransactionsQuerySchema.parse({})).toEqual({ includeVoided: false });
    expect(listTransactionsQuerySchema.parse({ includeVoided: "true" })).toEqual({
      includeVoided: true,
    });
    expect(listTransactionsQuerySchema.safeParse({ includeVoided: "yes" }).success).toBe(false);
  });
});
