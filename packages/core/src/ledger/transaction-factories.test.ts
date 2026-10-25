import { describe, expect, it } from "vitest";
import {
  brl,
  demoBankEur,
  demoCreditCard,
  demoDate,
  demoRecordedAt,
  demoWiseBrl,
  demoWiseEur,
  eur,
  feesCategory,
  foodCategory,
  salaryCategory,
} from "./test-fixtures.ts";
import type { Transaction } from "./transaction.ts";
import {
  createCardPaymentTransaction,
  createConversionTransaction,
  createExpenseTransaction,
  createIncomeTransaction,
  createOpeningBalanceTransaction,
  createTransferTransaction,
} from "./transaction-factories.ts";

const details = (id: string) => ({ id, date: demoDate, description: "Fictitious operation" });

/** Each posting as "TARGET CURRENCY AMOUNT", in the order the factory produced them. */
function shape(transaction: Transaction): string[] {
  return transaction.postings.map(({ target, amount }) => {
    const name =
      target.kind === "ACCOUNT"
        ? target.accountId
        : target.kind === "CATEGORY"
          ? target.categoryId
          : target.role;
    return `${target.kind}:${name} ${amount.currency} ${amount.amountMinor}`;
  });
}

describe("the six transaction types, as the factories build them", () => {
  it("OPENING_BALANCE: one account and the opening-balance equity, one currency", () => {
    const opening = createOpeningBalanceTransaction({
      ...details("t-opening"),
      account: demoBankEur,
      balance: eur("1000.00"),
    });

    expect(shape(opening)).toEqual([
      "ACCOUNT:demo-bank-eur EUR 100000",
      "SYSTEM:OPENING_BALANCE_EQUITY EUR -100000",
    ]);
    expect(opening.exchangeRate).toBeUndefined();
  });

  it("INCOME: an asset account and an income category, one currency", () => {
    const income = createIncomeTransaction({
      ...details("t-income"),
      account: demoBankEur,
      category: salaryCategory,
      amount: eur("2500.00"),
    });

    expect(shape(income)).toEqual([
      "ACCOUNT:demo-bank-eur EUR 250000",
      "CATEGORY:salary EUR -250000",
    ]);
  });

  it("EXPENSE in the account's currency: an expense category and the account", () => {
    const expense = createExpenseTransaction({
      ...details("t-expense"),
      paidFrom: demoCreditCard,
      category: foodCategory,
      amount: eur("50.00"),
    });

    expect(shape(expense)).toEqual([
      "CATEGORY:food EUR 5000",
      "ACCOUNT:demo-credit-card EUR -5000",
    ]);
    expect(expense.exchangeRate).toBeUndefined();
  });

  it("EXPENSE with a foreign charge: four postings bridged by exchange clearing", () => {
    const expense = createExpenseTransaction({
      ...details("t-foreign"),
      paidFrom: demoCreditCard,
      category: foodCategory,
      amount: brl("120.00"),
      foreignCharge: { chargedAmount: eur("20.40"), recordedAt: demoRecordedAt },
    });

    expect(shape(expense)).toEqual([
      "CATEGORY:food BRL 12000",
      "SYSTEM:EXCHANGE_CLEARING BRL -12000",
      "SYSTEM:EXCHANGE_CLEARING EUR 2040",
      "ACCOUNT:demo-credit-card EUR -2040",
    ]);
    expect(expense.exchangeRate).toMatchObject({ rate: "5.882353", source: "TRANSACTION" });
  });

  it("TRANSFER: two distinct asset accounts, one currency", () => {
    const transfer = createTransferTransaction({
      ...details("t-transfer"),
      from: demoBankEur,
      to: demoWiseEur,
      amount: eur("300.00"),
    });

    expect(shape(transfer)).toEqual([
      "ACCOUNT:demo-bank-eur EUR -30000",
      "ACCOUNT:demo-wise-eur EUR 30000",
    ]);
  });

  it("CARD_PAYMENT: an asset account and a credit card, one currency", () => {
    const payment = createCardPaymentTransaction({
      ...details("t-card-payment"),
      from: demoBankEur,
      card: demoCreditCard,
      amount: eur("500.00"),
    });

    expect(shape(payment)).toEqual([
      "ACCOUNT:demo-bank-eur EUR -50000",
      "ACCOUNT:demo-credit-card EUR 50000",
    ]);
  });

  it("CONVERSION: two asset accounts and two clearing postings, plus an optional fee", () => {
    const withoutFee = createConversionTransaction({
      ...details("t-conversion"),
      from: demoWiseBrl,
      to: demoWiseEur,
      sentAmount: brl("620.00"),
      receivedAmount: eur("100.00"),
      recordedAt: demoRecordedAt,
    });
    const withFee = createConversionTransaction({
      ...details("t-conversion-fee"),
      from: demoBankEur,
      to: demoWiseBrl,
      sentAmount: eur("100.00"),
      receivedAmount: brl("620.00"),
      fee: { category: feesCategory, amount: eur("1.00") },
      recordedAt: demoRecordedAt,
    });

    expect(shape(withoutFee)).toEqual([
      "ACCOUNT:demo-wise-brl BRL -62000",
      "SYSTEM:EXCHANGE_CLEARING BRL 62000",
      "SYSTEM:EXCHANGE_CLEARING EUR -10000",
      "ACCOUNT:demo-wise-eur EUR 10000",
    ]);
    expect(shape(withFee)).toEqual([
      "ACCOUNT:demo-bank-eur EUR -10100",
      "SYSTEM:EXCHANGE_CLEARING EUR 10000",
      "SYSTEM:EXCHANGE_CLEARING BRL -62000",
      "ACCOUNT:demo-wise-brl BRL 62000",
      "CATEGORY:fees EUR 100",
    ]);
    // The same EUR/BRL rate in both directions (BR-80).
    expect(withoutFee.exchangeRate).toMatchObject({
      baseCurrency: "EUR",
      quoteCurrency: "BRL",
      rate: "6.2",
    });
    expect(withFee.exchangeRate).toMatchObject({
      baseCurrency: "EUR",
      quoteCurrency: "BRL",
      rate: "6.2",
    });
  });
});

describe("operation inputs the factories never ignore", () => {
  it("rejects a charged amount on an expense in the account's own currency", () => {
    expect(() =>
      createExpenseTransaction({
        ...details("t-same-currency-charge"),
        paidFrom: demoBankEur,
        category: foodCategory,
        amount: eur("10.00"),
        foreignCharge: { chargedAmount: eur("99.00"), recordedAt: demoRecordedAt },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_TRANSACTION",
        message: expect.stringMatching(/no foreign charge/),
      }),
    );
  });
});
