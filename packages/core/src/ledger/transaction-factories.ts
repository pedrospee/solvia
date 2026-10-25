import { DomainError } from "../domain-error.ts";
import { calculateExecutedRate } from "../exchange/exchange-rate.ts";
import type { LocalDate } from "../local-date.ts";
import { addMoney, formatMoney, type Money, negateMoney } from "../money/money.ts";
import { type Account, getAccountNature } from "./account.ts";
import type { Category } from "./category.ts";
import type { Posting, SystemPostingRole, Transaction } from "./transaction.ts";
import { assertValidTransaction } from "./transaction-validation.ts";

/*
 * Each factory turns a human operation ("I paid €500 with the card") into a
 * balanced, validated transaction. Callers never build postings by hand.
 */

type TransactionDetails = Readonly<{ id: string; date: LocalDate; description: string }>;

/**
 * Starting point of an account. `balance` is expressed as the user sees it:
 * money held for assets (negative = overdraft), money owed for liabilities.
 */
export function createOpeningBalanceTransaction(
  details: TransactionDetails & { account: Account; balance: Money },
): Transaction {
  const { account, balance } = details;
  const ledgerAmount = getAccountNature(account.kind) === "ASSET" ? balance : negateMoney(balance);

  return buildValidTransaction(
    details,
    "OPENING_BALANCE",
    [
      accountPosting(account, ledgerAmount),
      systemPosting("OPENING_BALANCE_EQUITY", negateMoney(ledgerAmount)),
    ],
    { accounts: [account], categories: [] },
  );
}

export function createIncomeTransaction(
  details: TransactionDetails & { account: Account; category: Category; amount: Money },
): Transaction {
  const { account, category, amount } = details;
  assertPositive(amount, "income amount");

  return buildValidTransaction(
    details,
    "INCOME",
    [accountPosting(account, amount), categoryPosting(category, negateMoney(amount))],
    { accounts: [account], categories: [category] },
  );
}

/**
 * An expense paid from any account, including a credit card (which creates debt
 * instead of reducing the bank balance). When the purchase currency differs from
 * the account currency, `foreignCharge` gives the amount actually charged; the
 * original amount is kept on the expense and the executed rate is recorded.
 */
export function createExpenseTransaction(
  details: TransactionDetails & {
    paidFrom: Account;
    category: Category;
    amount: Money;
    foreignCharge?: { chargedAmount: Money; recordedAt: string };
  },
): Transaction {
  const { paidFrom, category, amount, foreignCharge } = details;
  const references = { accounts: [paidFrom], categories: [category] };
  assertPositive(amount, "expense amount");

  if (amount.currency === paidFrom.currency) {
    if (foreignCharge) {
      throw new DomainError(
        "INVALID_TRANSACTION",
        `A ${amount.currency} expense paid from a ${paidFrom.currency} account has no foreign charge; leave the charged amount out.`,
      );
    }
    return buildValidTransaction(
      details,
      "EXPENSE",
      [categoryPosting(category, amount), accountPosting(paidFrom, negateMoney(amount))],
      references,
    );
  }

  if (!foreignCharge) {
    throw new DomainError(
      "INVALID_TRANSACTION",
      `A ${amount.currency} expense paid from a ${paidFrom.currency} account needs the amount actually charged.`,
    );
  }

  const { chargedAmount, recordedAt } = foreignCharge;
  assertPositive(chargedAmount, "charged amount");

  return buildValidTransaction(
    details,
    "EXPENSE",
    [
      categoryPosting(category, amount),
      systemPosting("EXCHANGE_CLEARING", negateMoney(amount)),
      systemPosting("EXCHANGE_CLEARING", chargedAmount),
      accountPosting(paidFrom, negateMoney(chargedAmount)),
    ],
    references,
    calculateExecutedRate(amount, chargedAmount, { effectiveDate: details.date, recordedAt }),
  );
}

/** Moves money between own accounts: balances change, income and expense stay at zero. */
export function createTransferTransaction(
  details: TransactionDetails & { from: Account; to: Account; amount: Money },
): Transaction {
  const { from, to, amount } = details;
  assertPositive(amount, "transfer amount");

  return buildValidTransaction(
    details,
    "TRANSFER",
    [accountPosting(from, negateMoney(amount)), accountPosting(to, amount)],
    { accounts: [from, to], categories: [] },
  );
}

/** Pays a credit card from an asset account: cash decreases and card debt decreases. */
export function createCardPaymentTransaction(
  details: TransactionDetails & { from: Account; card: Account; amount: Money },
): Transaction {
  const { from, card, amount } = details;
  assertPositive(amount, "payment amount");

  return buildValidTransaction(
    details,
    "CARD_PAYMENT",
    [accountPosting(from, negateMoney(amount)), accountPosting(card, amount)],
    { accounts: [from, card], categories: [] },
  );
}

/**
 * Converts money between own accounts in different currencies. The real amounts
 * sent and received are the source of truth; the executed rate is derived from
 * them. An optional fee is charged to the source account as a separate expense.
 */
export function createConversionTransaction(
  details: TransactionDetails & {
    from: Account;
    to: Account;
    sentAmount: Money;
    receivedAmount: Money;
    fee?: { category: Category; amount: Money };
    recordedAt: string;
  },
): Transaction {
  const { from, to, sentAmount, receivedAmount, fee, recordedAt } = details;
  assertPositive(sentAmount, "sent amount");
  assertPositive(receivedAmount, "received amount");
  if (fee) {
    assertPositive(fee.amount, "fee");
  }

  const totalDebited = fee ? addMoney(sentAmount, fee.amount) : sentAmount;
  const postings: Posting[] = [
    accountPosting(from, negateMoney(totalDebited)),
    systemPosting("EXCHANGE_CLEARING", sentAmount),
    systemPosting("EXCHANGE_CLEARING", negateMoney(receivedAmount)),
    accountPosting(to, receivedAmount),
  ];
  if (fee) {
    postings.push(categoryPosting(fee.category, fee.amount));
  }

  return buildValidTransaction(
    details,
    "CONVERSION",
    postings,
    { accounts: [from, to], categories: fee ? [fee.category] : [] },
    calculateExecutedRate(sentAmount, receivedAmount, { effectiveDate: details.date, recordedAt }),
  );
}

function buildValidTransaction(
  details: TransactionDetails,
  type: Transaction["type"],
  postings: Posting[],
  references: Parameters<typeof assertValidTransaction>[1],
  exchangeRate?: Transaction["exchangeRate"],
): Transaction {
  const transaction: Transaction = {
    id: details.id,
    date: details.date,
    description: details.description,
    type,
    postings,
    ...(exchangeRate ? { exchangeRate } : {}),
  };
  assertValidTransaction(transaction, references);
  return transaction;
}

function accountPosting(account: Account, amount: Money): Posting {
  return { target: { kind: "ACCOUNT", accountId: account.id }, amount };
}

function categoryPosting(category: Category, amount: Money): Posting {
  return { target: { kind: "CATEGORY", categoryId: category.id }, amount };
}

function systemPosting(role: SystemPostingRole, amount: Money): Posting {
  return { target: { kind: "SYSTEM", role }, amount };
}

function assertPositive(amount: Money, label: string): void {
  if (amount.amountMinor <= 0n) {
    throw new DomainError(
      "INVALID_AMOUNT",
      `The ${label} must be positive, got ${formatMoney(amount)}.`,
    );
  }
}
