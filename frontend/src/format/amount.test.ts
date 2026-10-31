import { describe, expect, it } from "vitest";
import { formatAmount, parseAmountInput, toAmountInput } from "./amount.ts";

// Intl puts a no-break space between the symbol and the number.
const NBSP = " ";

describe("formatAmount", () => {
  it("formats both currencies the pt-BR way", () => {
    expect(formatAmount({ amountMinor: "123456", currency: "EUR" })).toBe(`€${NBSP}1.234,56`);
    expect(formatAmount({ amountMinor: "-123456", currency: "BRL" })).toBe(`-R$${NBSP}1.234,56`);
    expect(formatAmount({ amountMinor: "5", currency: "EUR" })).toBe(`€${NBSP}0,05`);
  });

  it("stays exact beyond what a number can hold", () => {
    expect(formatAmount({ amountMinor: "9223372036854775807", currency: "BRL" })).toBe(
      `R$${NBSP}92.233.720.368.547.758,07`,
    );
  });
});

describe("parseAmountInput", () => {
  it("reads cents after a comma, with or without thousands separators", () => {
    for (const [text, amountMinor] of [
      ["1.234,56", "123456"],
      ["1234,56", "123456"],
      ["1234", "123400"],
      ["0,5", "50"],
      [" 12,30 ", "1230"],
      ["-1.500,00", "-150000"],
      ["1.234.567,89", "123456789"],
    ] as const) {
      expect(parseAmountInput(text, "EUR")).toEqual({
        ok: true,
        money: { amountMinor, currency: "EUR" },
      });
    }
  });

  it("refuses what pt-BR would read differently, or not at all", () => {
    for (const text of ["", "12.50", "1.23,00", "1,234.56", "R$ 10", "10,", ",50", "1e3", "--1"]) {
      expect(parseAmountInput(text, "BRL")).toEqual({ ok: false, reason: "INVALID" });
    }
  });

  it("refuses more decimal places than the currency has", () => {
    expect(parseAmountInput("10,505", "EUR")).toEqual({ ok: false, reason: "TOO_MANY_DECIMALS" });
  });
});

describe("toAmountInput", () => {
  it("gives back what parseAmountInput reads", () => {
    const money = { amountMinor: "-123456", currency: "BRL" } as const;

    expect(toAmountInput(money)).toBe("-1234,56");
    expect(parseAmountInput(toAmountInput(money), "BRL")).toEqual({ ok: true, money });
  });
});
