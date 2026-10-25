import { DomainError } from "../domain-error.ts";
import {
  CANONICAL_EXCHANGE_RATE_PAIR,
  calculateExecutedRate,
  createExchangeRate,
  type ExchangeRate,
} from "../exchange/exchange-rate.ts";
import { CURRENCIES, type Currency } from "../money/currency.ts";
import { createMoney, formatMoney, type Money, sumMoney } from "../money/money.ts";
import { type Account, getAccountNature } from "./account.ts";
import type { Category } from "./category.ts";
import type { Posting, SystemPostingRole, Transaction, TransactionType } from "./transaction.ts";

/** The accounts and categories a transaction may reference. */
export type LedgerReferences = Readonly<{
  accounts: readonly Account[];
  categories: readonly Category[];
}>;

type ResolvedPosting =
  | { kind: "ACCOUNT"; amount: Money; account: Account }
  | { kind: "CATEGORY"; amount: Money; category: Category }
  | { kind: "SYSTEM"; amount: Money; role: SystemPostingRole };

const MINIMUM_POSTINGS = 2;
const MAXIMUM_CURRENCIES = 2;
const SYSTEM_POSTING_ROLES: readonly SystemPostingRole[] = [
  "OPENING_BALANCE_EQUITY",
  "EXCHANGE_CLEARING",
];
/** BR-84: the only types that may involve two currencies. */
const TWO_CURRENCY_TYPES: readonly TransactionType[] = ["CONVERSION", "EXPENSE"];

/**
 * Rejects any transaction that would break the ledger. Throws a DomainError
 * describing the first violated rule; returns normally when the transaction is valid.
 */
export function assertValidTransaction(
  transaction: Transaction,
  references: LedgerReferences,
): void {
  if (transaction.id.trim() === "" || transaction.description.trim() === "") {
    throw invalid(transaction, "id and description must not be empty.");
  }

  const postings = resolvePostings(transaction, references);
  assertBalancedPerCurrency(transaction, postings);
  assertCurrencyExchangeRules(transaction, postings);
  assertCategorySigns(transaction, postings);

  const violation = TYPE_RULES[transaction.type](postings);
  if (violation) {
    throw invalid(transaction, violation);
  }
}

function resolvePostings(
  transaction: Transaction,
  references: LedgerReferences,
): ResolvedPosting[] {
  if (transaction.postings.length < MINIMUM_POSTINGS) {
    throw invalid(transaction, `needs at least ${MINIMUM_POSTINGS} postings.`);
  }

  return transaction.postings.map((posting): ResolvedPosting => {
    assertPostingShape(transaction, posting);
    const { target, amount } = posting;
    if (amount.amountMinor === 0n) {
      throw invalid(transaction, "postings must not have a zero amount.");
    }

    if (target.kind === "SYSTEM") {
      return { kind: "SYSTEM", amount, role: target.role };
    }

    if (target.kind === "CATEGORY") {
      const category = references.categories.find(({ id }) => id === target.categoryId);
      if (!category) {
        throw invalid(transaction, `unknown category "${target.categoryId}".`);
      }
      return { kind: "CATEGORY", amount, category };
    }

    const account = references.accounts.find(({ id }) => id === target.accountId);
    if (!account) {
      throw invalid(transaction, `unknown account "${target.accountId}".`);
    }
    if (account.currency !== amount.currency) {
      throw new DomainError(
        "CURRENCY_MISMATCH",
        `Transaction ${transaction.id}: account "${account.name}" holds ${account.currency}, not ${amount.currency}.`,
      );
    }
    return { kind: "ACCOUNT", amount, account };
  });
}

/**
 * Rejects postings whose runtime shape the type system would not allow: amounts
 * that are not bigint minor units in a supported currency, and targets that are
 * missing, unknown, or name more than one destination.
 */
function assertPostingShape(transaction: Transaction, posting: Posting): void {
  const { amount } = posting;
  if (typeof amount?.amountMinor !== "bigint") {
    throw new DomainError(
      "INVALID_AMOUNT",
      `Transaction ${transaction.id}: posting amounts must be integer minor units (bigint).`,
    );
  }
  if (!(CURRENCIES as readonly string[]).includes(amount.currency)) {
    throw invalid(transaction, `unsupported currency "${String(amount.currency)}".`);
  }

  const target: Record<string, unknown> | undefined = posting.target;
  const fields = target === undefined || target === null ? [] : Object.keys(target).sort();
  const expectedFields: Record<string, string> = {
    ACCOUNT: "accountId,kind",
    CATEGORY: "categoryId,kind",
    SYSTEM: "kind,role",
  };
  const kind = target?.kind;
  if (typeof kind !== "string" || expectedFields[kind] !== fields.join(",")) {
    throw invalid(
      transaction,
      "every posting has exactly one target: an account, a category or a system role.",
    );
  }
  if (kind === "SYSTEM" && !SYSTEM_POSTING_ROLES.includes(target?.role as SystemPostingRole)) {
    throw invalid(transaction, `unknown system role "${String(target?.role)}".`);
  }
}

function assertBalancedPerCurrency(transaction: Transaction, postings: ResolvedPosting[]): void {
  for (const currency of currenciesOf(postings)) {
    const amounts = postings.filter((p) => p.amount.currency === currency).map((p) => p.amount);
    const total = sumMoney(amounts, currency);

    if (total.amountMinor !== 0n) {
      throw new DomainError(
        "UNBALANCED_TRANSACTION",
        `Transaction ${transaction.id}: ${currency} postings sum to ${formatMoney(total)} instead of zero.`,
      );
    }
  }
}

/**
 * Single-currency: no exchange at all. Two currencies (BR-84): only a conversion
 * or a foreign-charge expense, whose exchange clearing postings net to non-zero
 * amounts of opposite signs in EUR and BRL, and whose rate is exactly the
 * executed rate derived from those nets. The rate is re-derived, never checked
 * by converting a leg: a rate rounded from the legs can miss them by cents.
 */
function assertCurrencyExchangeRules(transaction: Transaction, postings: ResolvedPosting[]): void {
  const currencies = currenciesOf(postings);
  const clearingPostings = postings.filter(
    (p) => p.kind === "SYSTEM" && p.role === "EXCHANGE_CLEARING",
  );

  if (currencies.length > MAXIMUM_CURRENCIES) {
    throw invalid(transaction, `involves more than ${MAXIMUM_CURRENCIES} currencies.`);
  }

  if (currencies.length === 1) {
    if (clearingPostings.length > 0 || transaction.exchangeRate) {
      throw invalid(transaction, "a single-currency transaction must not record an exchange.");
    }
    return;
  }

  if (!TWO_CURRENCY_TYPES.includes(transaction.type)) {
    throw invalid(
      transaction,
      `a ${transaction.type} transaction involves one currency; only a conversion or a foreign-charge expense involves two.`,
    );
  }

  const { baseCurrency, quoteCurrency } = CANONICAL_EXCHANGE_RATE_PAIR;
  const netOf = (currency: Currency) =>
    sumMoney(
      clearingPostings.filter((p) => p.amount.currency === currency).map((p) => p.amount),
      currency,
    ).amountMinor;
  const netBase = netOf(baseCurrency);
  const netQuote = netOf(quoteCurrency);
  if (netBase === 0n || netQuote === 0n) {
    throw invalid(
      transaction,
      `the exchange clearing postings must not net to zero in ${baseCurrency} or ${quoteCurrency}.`,
    );
  }
  if (netBase > 0n === netQuote > 0n) {
    throw invalid(
      transaction,
      "the exchange clearing postings must move in opposite directions in the two currencies.",
    );
  }

  const stored = transaction.exchangeRate;
  if (!stored) {
    throw invalid(
      transaction,
      `needs the ${baseCurrency}/${quoteCurrency} rate it was executed at.`,
    );
  }
  const actual = createExchangeRate(stored);
  const expected = calculateExecutedRate(
    createMoney(absolute(netBase), baseCurrency),
    createMoney(absolute(netQuote), quoteCurrency),
    { effectiveDate: transaction.date, recordedAt: stored.recordedAt },
  );
  if (!isSameRate(actual, expected)) {
    throw invalid(
      transaction,
      `the exchange rate must be the executed rate of its clearing postings, ${describeRate(expected)}; got ${describeRate(actual)}.`,
    );
  }
}

function isSameRate(left: ExchangeRate, right: ExchangeRate): boolean {
  return (
    left.baseCurrency === right.baseCurrency &&
    left.quoteCurrency === right.quoteCurrency &&
    left.rate === right.rate &&
    left.source === right.source &&
    left.effectiveDate === right.effectiveDate
  );
}

function describeRate({ baseCurrency, quoteCurrency, rate, source, effectiveDate }: ExchangeRate) {
  return `${baseCurrency}/${quoteCurrency} ${rate} (${source}, ${effectiveDate})`;
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/** Expense categories only increase (positive) and income categories only increase (negative). */
function assertCategorySigns(transaction: Transaction, postings: ResolvedPosting[]): void {
  for (const posting of postings) {
    if (posting.kind !== "CATEGORY") {
      continue;
    }
    const isPositive = posting.amount.amountMinor > 0n;
    const hasExpectedSign = posting.category.nature === "EXPENSE" ? isPositive : !isPositive;
    if (!hasExpectedSign) {
      throw invalid(
        transaction,
        `category "${posting.category.name}" has an amount in the wrong direction.`,
      );
    }
  }
}

type TypeRule = (postings: ResolvedPosting[]) => string | undefined;

const TYPE_RULES: Readonly<Record<TransactionType, TypeRule>> = {
  OPENING_BALANCE: (postings) => {
    const accounts = accountPostings(postings);
    const equity = postings.filter(
      (p) => p.kind === "SYSTEM" && p.role === "OPENING_BALANCE_EQUITY",
    );
    return accounts.length === 1 && equity.length === 1 && postings.length === 2
      ? undefined
      : "an opening balance has exactly one account and one opening-balance posting.";
  },

  INCOME: (postings) =>
    firstViolation([
      withoutOpeningEquity(postings),
      hasCategory(postings, "INCOME") ? undefined : "income needs an income category.",
      hasCategory(postings, "EXPENSE") ? "income cannot use an expense category." : undefined,
      onlyAssetAccounts(postings, "income can only be received into asset accounts."),
    ]),

  EXPENSE: (postings) =>
    firstViolation([
      withoutOpeningEquity(postings),
      hasCategory(postings, "EXPENSE") ? undefined : "an expense needs an expense category.",
      hasCategory(postings, "INCOME") ? "an expense cannot use an income category." : undefined,
    ]),

  TRANSFER: (postings) =>
    firstViolation([
      withoutOpeningEquity(postings),
      postings.some((p) => p.kind !== "ACCOUNT")
        ? "a transfer moves money between accounts only; it has no income or expense."
        : undefined,
      onlyAssetAccounts(
        postings,
        "a transfer is between own asset accounts; use CARD_PAYMENT for cards.",
      ),
      new Set(accountPostings(postings).map((p) => p.account.id)).size < 2
        ? "a transfer needs two different accounts."
        : undefined,
    ]),

  /** BR-44: card postings only reduce card debt; the money leaves own asset accounts. */
  CARD_PAYMENT: (postings) => {
    const accounts = accountPostings(postings);
    const cards = accounts.filter((p) => p.account.kind === "CREDIT_CARD");
    const otherAccounts = accounts.filter((p) => p.account.kind !== "CREDIT_CARD");
    return firstViolation([
      withoutOpeningEquity(postings),
      postings.some((p) => p.kind === "CATEGORY") ? "a card payment has no category." : undefined,
      cards.some((p) => p.amount.amountMinor > 0n)
        ? undefined
        : "a card payment must reduce a credit card balance.",
      cards.every((p) => p.amount.amountMinor > 0n)
        ? undefined
        : "a card payment only reduces credit card balances; a card is never paid with another card.",
      otherAccounts.every((p) => getAccountNature(p.account.kind) === "ASSET")
        ? undefined
        : "a card payment is paid from asset accounts.",
      otherAccounts.some((p) => p.amount.amountMinor < 0n)
        ? undefined
        : "a card payment is paid from at least one asset account.",
    ]);
  },

  CONVERSION: (postings) =>
    firstViolation([
      withoutOpeningEquity(postings),
      currenciesOf(postings).length === 2 ? undefined : "a conversion involves two currencies.",
      hasCategory(postings, "INCOME") ? "a conversion is never income." : undefined,
      onlyAssetAccounts(postings, "a conversion is between own asset accounts."),
    ]),
};

function accountPostings(postings: ResolvedPosting[]) {
  return postings.filter(
    (p): p is Extract<ResolvedPosting, { kind: "ACCOUNT" }> => p.kind === "ACCOUNT",
  );
}

function hasCategory(postings: ResolvedPosting[], nature: Category["nature"]): boolean {
  return postings.some((p) => p.kind === "CATEGORY" && p.category.nature === nature);
}

function onlyAssetAccounts(postings: ResolvedPosting[], violation: string): string | undefined {
  const allAssets = accountPostings(postings).every(
    (p) => getAccountNature(p.account.kind) === "ASSET",
  );
  return allAssets ? undefined : violation;
}

function withoutOpeningEquity(postings: ResolvedPosting[]): string | undefined {
  const hasOpeningEquity = postings.some(
    (p) => p.kind === "SYSTEM" && p.role === "OPENING_BALANCE_EQUITY",
  );
  return hasOpeningEquity
    ? "only an opening balance may use the opening-balance posting."
    : undefined;
}

function firstViolation(checks: (string | undefined)[]): string | undefined {
  return checks.find((violation) => violation !== undefined);
}

function currenciesOf(postings: ResolvedPosting[]): Currency[] {
  return [...new Set(postings.map((p) => p.amount.currency))];
}

function invalid(transaction: Transaction, reason: string): DomainError {
  return new DomainError("INVALID_TRANSACTION", `Transaction ${transaction.id}: ${reason}`);
}
