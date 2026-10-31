import type { CurrencyJson, MoneyJson } from "@solvia/contracts";
import { formatDecimal, MINOR_UNIT_DIGITS, moneyFromDecimal } from "@solvia/core";

const LOCALE = "pt-BR";

/** The exact amount as a decimal string ("1234.56"), never a number (ADR-0005, D7). */
function toDecimal({ amountMinor, currency }: MoneyJson): string {
  return formatDecimal({ coefficient: BigInt(amountMinor), scale: MINOR_UNIT_DIGITS[currency] });
}

/** "R$ 1.234,56", "€ 1.234,56" (ADR-0005, D8). */
export function formatAmount(money: MoneyJson): string {
  // Intl formats a decimal string exactly; a number would round past 2^53.
  return new Intl.NumberFormat(LOCALE, { style: "currency", currency: money.currency }).format(
    toDecimal(money) as `${number}`,
  );
}

/** The amount as the user edits it: "1234,56", without thousands separators. */
export function toAmountInput(money: MoneyJson): string {
  return toDecimal(money).replace(".", ",");
}

export type AmountInput =
  | { ok: true; money: MoneyJson }
  | { ok: false; reason: "INVALID" | "TOO_MANY_DECIMALS" };

// "1.234,56", "1234,56", "1234" and their negatives: a comma before the cents, and dots
// only between groups of thousands. "12.50" is refused: in pt-BR it reads as 1250.
const AMOUNT_INPUT = /^(-?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?$/;

/**
 * Reads an amount typed in pt-BR. Only its form is checked: whether it may be negative or
 * zero is a financial rule, decided by the server.
 */
export function parseAmountInput(text: string, currency: CurrencyJson): AmountInput {
  const match = AMOUNT_INPUT.exec(text.trim());
  if (match === null) {
    return { ok: false, reason: "INVALID" };
  }
  const [, sign = "", integer = "", fraction] = match;
  if (fraction !== undefined && fraction.length > MINOR_UNIT_DIGITS[currency]) {
    return { ok: false, reason: "TOO_MANY_DECIMALS" };
  }

  const decimal = `${sign}${integer.replaceAll(".", "")}${fraction === undefined ? "" : `.${fraction}`}`;
  const money = moneyFromDecimal(decimal, currency);
  return { ok: true, money: { amountMinor: money.amountMinor.toString(), currency } };
}
