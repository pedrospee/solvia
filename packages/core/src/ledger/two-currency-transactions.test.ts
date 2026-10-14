import { describe, expect, it } from "vitest";
import { convertMoney, type ExchangeRate } from "../exchange/exchange-rate.ts";
import { parseLocalDate } from "../local-date.ts";
import { createMoney, formatMoney, type Money } from "../money/money.ts";
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
  feesCategory,
  foodCategory,
} from "./test-fixtures.ts";
import type { Posting, PostingTarget, Transaction, TransactionType } from "./transaction.ts";
import { createConversionTransaction, createExpenseTransaction } from "./transaction-factories.ts";
import { assertValidTransaction } from "./transaction-validation.ts";

const references = { accounts: allDemoAccounts, categories: allDemoCategories };

const account = (accountId: string): PostingTarget => ({ kind: "ACCOUNT", accountId });
const category = (categoryId: string): PostingTarget => ({ kind: "CATEGORY", categoryId });
const clearing: PostingTarget = { kind: "SYSTEM", role: "EXCHANGE_CLEARING" };
const posting = (target: PostingTarget, amount: Money): Posting => ({ target, amount });

function transactionRate(rate: string, overrides: Partial<ExchangeRate> = {}): ExchangeRate {
  return {
    baseCurrency: "EUR",
    quoteCurrency: "BRL",
    rate,
    effectiveDate: demoDate,
    source: "TRANSACTION",
    recordedAt: demoRecordedAt,
    ...overrides,
  };
}

/** A hand-built transaction: the core must judge it without trusting any factory. */
function handBuilt(
  type: TransactionType,
  postings: Posting[],
  exchangeRate?: ExchangeRate,
): Transaction {
  return {
    id: `t-${type.toLowerCase()}`,
    date: demoDate,
    description: "Hand-built",
    type,
    postings,
    ...(exchangeRate ? { exchangeRate } : {}),
  };
}

const accepts = (transaction: Transaction) =>
  expect(() => assertValidTransaction(transaction, references)).not.toThrow();
const rejects = (transaction: Transaction, message?: RegExp) =>
  expect(() => assertValidTransaction(transaction, references)).toThrowError(
    expect.objectContaining({
      code: "INVALID_TRANSACTION",
      ...(message ? { message: expect.stringMatching(message) } : {}),
    }),
  );

/** €100 → R$620 from the EUR bank to the BRL Wise account, as postings. */
const conversionPostings: Posting[] = [
  posting(account(demoBankEur.id), eur("-100.00")),
  posting(clearing, eur("100.00")),
  posting(clearing, brl("-620.00")),
  posting(account(demoWiseBrl.id), brl("620.00")),
];

describe("valid two-currency transactions (BR-84)", () => {
  it("accepts a conversion built by the factory, with the rate derived from its legs", () => {
    const conversion = createConversionTransaction({
      id: "t-conversion",
      date: demoDate,
      description: "EUR to BRL",
      from: demoBankEur,
      to: demoWiseBrl,
      sentAmount: eur("100.00"),
      receivedAmount: brl("620.00"),
      fee: { category: feesCategory, amount: eur("1.00") },
      recordedAt: demoRecordedAt,
    });

    accepts(conversion);
    expect(conversion.exchangeRate).toEqual(transactionRate("6.2"));
  });

  it("accepts a foreign-charge expense built by the factory", () => {
    const expense = createExpenseTransaction({
      id: "t-foreign",
      date: demoDate,
      description: "Dinner",
      paidFrom: demoCreditCard,
      category: foodCategory,
      amount: brl("120.00"),
      foreignCharge: { chargedAmount: eur("20.40"), recordedAt: demoRecordedAt },
    });

    accepts(expense);
    expect(expense.exchangeRate).toEqual(transactionRate("5.882353"));
  });

  it("accepts a hand-built conversion in either direction with the derived EUR/BRL rate", () => {
    accepts(handBuilt("CONVERSION", conversionPostings, transactionRate("6.2")));
    accepts(
      handBuilt(
        "CONVERSION",
        [
          posting(account(demoWiseBrl.id), brl("-620.00")),
          posting(clearing, brl("620.00")),
          posting(clearing, eur("-100.00")),
          posting(account(demoWiseEur.id), eur("100.00")),
        ],
        transactionRate("6.2"),
      ),
    );
  });

  it("accepts several clearing postings in one currency: their net defines the rate", () => {
    const split = [
      posting(account(demoBankEur.id), eur("-100.00")),
      posting(clearing, eur("60.00")),
      posting(clearing, eur("40.00")),
      posting(clearing, brl("-620.00")),
      posting(account(demoWiseBrl.id), brl("620.00")),
    ];

    accepts(handBuilt("CONVERSION", split, transactionRate("6.2")));
  });

  it("accepts the rate in any spelling of the same value (BR-83)", () => {
    accepts(handBuilt("CONVERSION", conversionPostings, transactionRate("6.20")));
  });
});

describe("the rate must be the executed rate of the clearing nets (BR-84)", () => {
  it("rejects a rate that does not match the legs", () => {
    rejects(handBuilt("CONVERSION", conversionPostings, transactionRate("9")), /executed rate/);
    rejects(
      handBuilt("CONVERSION", conversionPostings, transactionRate("6.200001")),
      /executed rate/,
    );
  });

  it("rejects a manual rate, even with the right value", () => {
    rejects(
      handBuilt("CONVERSION", conversionPostings, transactionRate("6.2", { source: "MANUAL" })),
      /executed rate/,
    );
  });

  it("rejects BRL/EUR as an independent pair, even with the inverse value", () => {
    rejects(
      handBuilt(
        "CONVERSION",
        conversionPostings,
        transactionRate("0.1612903226", { baseCurrency: "BRL", quoteCurrency: "EUR" }),
      ),
      /executed rate/,
    );
  });

  it("rejects a rate effective on another date than the transaction", () => {
    rejects(
      handBuilt(
        "CONVERSION",
        conversionPostings,
        transactionRate("6.2", { effectiveDate: parseLocalDate("2026-01-01") }),
      ),
      /executed rate/,
    );
  });

  it("rejects a two-currency transaction without a rate", () => {
    rejects(handBuilt("CONVERSION", conversionPostings), /rate it was executed at/);
  });

  it("rejects a rate that matches one clearing posting but not the net", () => {
    // Nets: EUR +100.00, BRL −620.00 → 6.2. The first BRL posting alone would give 6.5.
    const postings = [
      posting(account(demoBankEur.id), eur("-100.00")),
      posting(clearing, eur("100.00")),
      posting(clearing, brl("-650.00")),
      posting(clearing, brl("30.00")),
      posting(account(demoWiseBrl.id), brl("620.00")),
    ];

    rejects(handBuilt("CONVERSION", postings, transactionRate("6.5")), /executed rate/);
    accepts(handBuilt("CONVERSION", postings, transactionRate("6.2")));
  });
});

describe("the clearing postings must describe a real exchange (BR-84)", () => {
  it("rejects clearing postings that net to zero in EUR", () => {
    const postings = [
      posting(account(demoBankEur.id), eur("-100.00")),
      posting(account(demoWiseEur.id), eur("100.00")),
      posting(clearing, eur("5.00")),
      posting(clearing, eur("-5.00")),
      posting(clearing, brl("-620.00")),
      posting(account(demoWiseBrl.id), brl("620.00")),
    ];

    rejects(handBuilt("CONVERSION", postings, transactionRate("6.2")), /net to zero/);
  });

  it("rejects clearing postings that net to zero in BRL", () => {
    const postings = [
      posting(account(demoBankEur.id), eur("-100.00")),
      posting(clearing, eur("100.00")),
      posting(clearing, brl("-620.00")),
      posting(clearing, brl("620.00")),
      posting(account(demoWiseBrl.id), brl("-620.00")),
      posting(account(demoWiseBrl.id), brl("620.00")),
    ];

    rejects(handBuilt("CONVERSION", postings, transactionRate("6.2")), /net to zero/);
  });

  it("rejects clearing postings with the same sign: money would leave both accounts", () => {
    const postings = [
      posting(account(demoBankEur.id), eur("-100.00")),
      posting(clearing, eur("100.00")),
      posting(clearing, brl("620.00")),
      posting(account(demoWiseBrl.id), brl("-620.00")),
    ];

    rejects(handBuilt("CONVERSION", postings, transactionRate("6.2")), /opposite directions/);
  });

  it("rejects a foreign-charge expense with clearing in one currency only", () => {
    const postings = [
      posting(category(foodCategory.id), brl("120.00")),
      posting(account(demoWiseBrl.id), brl("-120.00")),
      posting(clearing, eur("20.40")),
      posting(account(demoCreditCard.id), eur("-20.40")),
    ];

    rejects(handBuilt("EXPENSE", postings, transactionRate("5.882353")), /net to zero/);
  });
});

describe("only a conversion or a foreign-charge expense involves two currencies (BR-84)", () => {
  // Balanced per currency and correctly cleared at EUR/BRL 6.2: only the type is wrong.
  const rate = transactionRate("6.2");

  it("rejects a two-currency INCOME", () => {
    const postings = [
      posting({ kind: "CATEGORY", categoryId: "salary" }, brl("-620.00")),
      posting(clearing, brl("620.00")),
      posting(clearing, eur("-100.00")),
      posting(account(demoBankEur.id), eur("100.00")),
    ];

    rejects(handBuilt("INCOME", postings, rate), /involves one currency/);
  });

  it("rejects a two-currency TRANSFER", () => {
    rejects(handBuilt("TRANSFER", conversionPostings, rate), /involves one currency/);
  });

  it("rejects a two-currency CARD_PAYMENT", () => {
    const postings = [
      posting(account(demoCreditCard.id), eur("100.00")),
      posting(clearing, eur("-100.00")),
      posting(clearing, brl("620.00")),
      posting(account(demoWiseBrl.id), brl("-620.00")),
    ];

    rejects(handBuilt("CARD_PAYMENT", postings, rate), /involves one currency/);
  });

  it("rejects a two-currency OPENING_BALANCE", () => {
    const postings = [
      posting(account(demoBankEur.id), eur("100.00")),
      posting(clearing, eur("-100.00")),
      posting(clearing, brl("620.00")),
      posting({ kind: "SYSTEM", role: "OPENING_BALANCE_EQUITY" }, brl("-620.00")),
    ];

    rejects(handBuilt("OPENING_BALANCE", postings, rate), /involves one currency/);
  });
});

describe("why the rate is re-derived instead of checked with convertMoney (BR-84)", () => {
  it("accepts €1,000,000.00 → R$5,882,352.94, although converting the EUR leg misses by six cents", () => {
    const conversion = createConversionTransaction({
      id: "t-large",
      date: demoDate,
      description: "Large conversion",
      from: demoBankEur,
      to: demoWiseBrl,
      sentAmount: eur("1000000.00"),
      receivedAmount: brl("5882352.94"),
      recordedAt: demoRecordedAt,
    });
    const rate = conversion.exchangeRate as ExchangeRate;

    accepts(conversion);
    expect(rate.rate).toBe("5.882353");
    // A convertMoney-based check would reject this valid transaction.
    expect(formatMoney(convertMoney(eur("1000000.00"), rate, "BRL"))).toBe("BRL 5882353.00");
  });
});

describe("property: every factory conversion is valid, and any other rate is not (BR-84)", () => {
  /** Deterministic pseudo-random amounts (a linear congruential generator), so failures reproduce. */
  function* generatedAmounts(count: number): Generator<[bigint, bigint]> {
    let seed = 20_261_005n;
    const next = (modulus: bigint) => {
      seed = (seed * 6_364_136_223_846_793_005n + 1_442_695_040_888_963_407n) % 2n ** 64n;
      return seed % modulus;
    };
    for (let index = 0; index < count; index++) {
      const eurMinor = next(10n ** BigInt(1 + Number(next(10n)))) + 1n;
      const brlMinor = next(10n ** BigInt(1 + Number(next(11n)))) + 1n;
      yield [eurMinor, brlMinor];
    }
  }

  it("holds for 500 generated conversions in both directions", () => {
    let checked = 0;
    for (const [eurMinor, brlMinor] of generatedAmounts(500)) {
      const sent = createMoney(eurMinor, "EUR");
      const received = createMoney(brlMinor, "BRL");
      let conversion: Transaction;
      try {
        conversion = createConversionTransaction({
          id: "t-generated",
          date: demoDate,
          description: "Generated",
          from: demoBankEur,
          to: demoWiseBrl,
          sentAmount: sent,
          receivedAmount: received,
          recordedAt: demoRecordedAt,
        });
      } catch {
        // A rate below 0.000001 rounds to zero at six decimals and is rejected by the factory.
        continue;
      }
      accepts(conversion);

      const rate = conversion.exchangeRate as ExchangeRate;
      const tampered = `${rate.rate}${rate.rate.includes(".") ? "" : "."}1`;
      rejects({ ...conversion, exchangeRate: { ...rate, rate: tampered } }, /executed rate/);
      checked++;
    }
    expect(checked).toBeGreaterThan(400);
  });
});
