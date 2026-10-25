import { randomUUID } from "node:crypto";
import {
  type Account,
  assertOneOpeningBalancePerAccount,
  type Category,
  createCardPaymentTransaction,
  createConversionTransaction,
  createExpenseTransaction,
  createIncomeTransaction,
  createOpeningBalanceTransaction,
  createTransferTransaction,
  type LocalDate,
  type Money,
  type Posting,
  type PostingTarget,
  type Transaction,
} from "@solvia/core";
import type { AppDatabase, DbExecutor } from "../../infrastructure/database/client.ts";
import { createAccountRepository } from "../accounts/account-repository.ts";
import { createCategoryRepository } from "../categories/category-repository.ts";
import { ConflictError, NotFoundError } from "../errors.ts";
import { createTransactionRepository, type TransactionRecord } from "./transaction-repository.ts";

/**
 * One human operation, as the user describes it: never postings (ADR-0004, section 9).
 * The matching core factory turns it into postings and validates them.
 */
export type TransactionOperation = Readonly<{ date: LocalDate; description: string }> &
  (
    | Readonly<{ type: "OPENING_BALANCE"; accountId: string; balance: Money }>
    | Readonly<{ type: "INCOME"; accountId: string; categoryId: string; amount: Money }>
    | Readonly<{
        type: "EXPENSE";
        paidFromAccountId: string;
        categoryId: string;
        amount: Money;
        /** What the account was actually charged, when `amount` is in another currency. */
        chargedAmount?: Money;
      }>
    | Readonly<{ type: "TRANSFER"; fromAccountId: string; toAccountId: string; amount: Money }>
    | Readonly<{
        type: "CARD_PAYMENT";
        fromAccountId: string;
        cardAccountId: string;
        amount: Money;
      }>
    | Readonly<{
        type: "CONVERSION";
        fromAccountId: string;
        toAccountId: string;
        sentAmount: Money;
        receivedAmount: Money;
        fee?: Readonly<{ categoryId: string; amount: Money }>;
      }>
  );

type References = Readonly<{ accountIds: readonly string[]; categoryIds: readonly string[] }>;
type LoadedReferences = Readonly<{
  accounts: ReadonlyMap<string, Account>;
  categories: ReadonlyMap<string, Category>;
}>;

export type TransactionService = ReturnType<typeof createTransactionService>;

/**
 * Ledger use cases (ADR-0004). Every write runs in one `BEGIN IMMEDIATE` database
 * transaction: what is read to decide (references, archived state, the current
 * version, the effective ledger) cannot change before the write, and any error rolls
 * every row back. The core builds and validates; this service decides which
 * transactions are effective, the archived rule, immutables, no-op edits and voids.
 */
export function createTransactionService(
  db: AppDatabase,
  options: { now?: () => Date; newId?: () => string } = {},
) {
  const now = () => (options.now ?? (() => new Date()))().toISOString();
  const newId = options.newId ?? randomUUID;

  function inTransaction<T>(work: (tx: DbExecutor) => T): T {
    return db.transaction((tx) => work(tx), { behavior: "immediate" });
  }

  function load(tx: DbExecutor, id: string): TransactionRecord {
    const record = createTransactionRepository(tx).findById(id);
    if (record === undefined) {
      throw new NotFoundError("TRANSACTION_NOT_FOUND", `No transaction with id "${id}".`);
    }
    return record;
  }

  return {
    create(operation: TransactionOperation): TransactionRecord {
      return inTransaction((tx) => {
        const references = loadReferences(tx, referencesOf(operation));
        const timestamp = now();
        const transaction = build(operation, newId(), timestamp, references);
        const transactions = createTransactionRepository(tx);
        if (transaction.type === "OPENING_BALANCE") {
          assertOneOpeningBalancePerAccount([...transactions.loadEffectiveLedger(), transaction]);
        }
        const record = { transaction, voidedAt: null, createdAt: timestamp, updatedAt: timestamp };
        transactions.insert(record);
        return record;
      });
    },

    /**
     * Full replacement of the operation (BR-23). `id`, `type` and `createdAt` never
     * change; an unchanged operation changes nothing, `updatedAt` included.
     */
    edit(id: string, operation: TransactionOperation): TransactionRecord {
      return inTransaction((tx) => {
        const current = load(tx, id);
        if (current.voidedAt !== null) {
          throw new ConflictError("TRANSACTION_VOIDED", "A voided transaction cannot be edited.");
        }
        if (operation.type !== current.transaction.type) {
          throw new ConflictError(
            "TRANSACTION_TYPE_IMMUTABLE",
            `A ${current.transaction.type} transaction cannot become ${operation.type}; void it and record a new one.`,
          );
        }

        const references = loadReferences(
          tx,
          referencesOf(operation),
          referencesOfTransaction(current.transaction),
        );
        const timestamp = now();
        const transaction = build(operation, id, timestamp, references);
        if (isSameOperation(transaction, current.transaction)) {
          return current;
        }

        const transactions = createTransactionRepository(tx);
        if (transaction.type === "OPENING_BALANCE") {
          assertOneOpeningBalancePerAccount(
            transactions.loadEffectiveLedger().map((t) => (t.id === id ? transaction : t)),
          );
        }
        const record = { ...current, transaction, updatedAt: timestamp };
        transactions.replace(record);
        return record;
      });
    },

    /** Irreversible and idempotent (V1, V5); allowed with archived references (V6). */
    void(id: string): TransactionRecord {
      return inTransaction((tx) => {
        const current = load(tx, id);
        if (current.voidedAt !== null) {
          return current;
        }
        const voidedAt = now();
        createTransactionRepository(tx).markVoided(id, voidedAt);
        return { ...current, voidedAt };
      });
    },

    /** Voided or not (V8). */
    get(id: string): TransactionRecord {
      return load(db, id);
    },

    list(listOptions: { includeVoided: boolean }): TransactionRecord[] {
      return createTransactionRepository(db).list(listOptions);
    },
  };
}

/**
 * Loads every referenced account and category. A new reference to an archived one
 * is a conflict; one the current version already has may stay (ADR-0004, section 4).
 */
function loadReferences(
  tx: DbExecutor,
  wanted: References,
  existing: References = { accountIds: [], categoryIds: [] },
): LoadedReferences {
  const accountRepository = createAccountRepository(tx);
  const categoryRepository = createCategoryRepository(tx);

  const accounts = new Map<string, Account>();
  for (const id of wanted.accountIds) {
    const record = accountRepository.findById(id);
    if (record === undefined) {
      throw new NotFoundError("ACCOUNT_NOT_FOUND", `No account with id "${id}".`);
    }
    if (record.archivedAt !== null && !existing.accountIds.includes(id)) {
      throw new ConflictError(
        "ACCOUNT_ARCHIVED",
        `The account "${record.account.name}" is archived; a transaction cannot start using it.`,
      );
    }
    accounts.set(id, record.account);
  }

  const categories = new Map<string, Category>();
  for (const id of wanted.categoryIds) {
    const record = categoryRepository.findById(id);
    if (record === undefined) {
      throw new NotFoundError("CATEGORY_NOT_FOUND", `No category with id "${id}".`);
    }
    if (record.archivedAt !== null && !existing.categoryIds.includes(id)) {
      throw new ConflictError(
        "CATEGORY_ARCHIVED",
        `The category "${record.category.name}" is archived; a transaction cannot start using it.`,
      );
    }
    categories.set(id, record.category);
  }

  return { accounts, categories };
}

function referencesOf(operation: TransactionOperation): References {
  switch (operation.type) {
    case "OPENING_BALANCE":
      return { accountIds: [operation.accountId], categoryIds: [] };
    case "INCOME":
      return { accountIds: [operation.accountId], categoryIds: [operation.categoryId] };
    case "EXPENSE":
      return { accountIds: [operation.paidFromAccountId], categoryIds: [operation.categoryId] };
    case "TRANSFER":
      return { accountIds: [operation.fromAccountId, operation.toAccountId], categoryIds: [] };
    case "CARD_PAYMENT":
      return { accountIds: [operation.fromAccountId, operation.cardAccountId], categoryIds: [] };
    case "CONVERSION":
      return {
        accountIds: [operation.fromAccountId, operation.toAccountId],
        categoryIds: operation.fee ? [operation.fee.categoryId] : [],
      };
  }
}

function referencesOfTransaction({ postings }: Transaction): References {
  const accountIds: string[] = [];
  const categoryIds: string[] = [];
  for (const { target } of postings) {
    if (target.kind === "ACCOUNT") {
      accountIds.push(target.accountId);
    } else if (target.kind === "CATEGORY") {
      categoryIds.push(target.categoryId);
    }
  }
  return { accountIds, categoryIds };
}

/**
 * The matching core factory builds and validates the transaction. `recordedAt` is
 * the version timestamp, so a two-currency rate is recorded when the transaction
 * version is: exchangeRate.recordedAt === updatedAt (ADR-0004, L5).
 */
function build(
  operation: TransactionOperation,
  id: string,
  recordedAt: string,
  { accounts, categories }: LoadedReferences,
): Transaction {
  const details = { id, date: operation.date, description: operation.description };
  const account = (accountId: string) => required(accounts, accountId);
  const category = (categoryId: string) => required(categories, categoryId);

  switch (operation.type) {
    case "OPENING_BALANCE":
      return createOpeningBalanceTransaction({
        ...details,
        account: account(operation.accountId),
        balance: operation.balance,
      });
    case "INCOME":
      return createIncomeTransaction({
        ...details,
        account: account(operation.accountId),
        category: category(operation.categoryId),
        amount: operation.amount,
      });
    case "EXPENSE":
      return createExpenseTransaction({
        ...details,
        paidFrom: account(operation.paidFromAccountId),
        category: category(operation.categoryId),
        amount: operation.amount,
        ...(operation.chargedAmount === undefined
          ? {}
          : { foreignCharge: { chargedAmount: operation.chargedAmount, recordedAt } }),
      });
    case "TRANSFER":
      return createTransferTransaction({
        ...details,
        from: account(operation.fromAccountId),
        to: account(operation.toAccountId),
        amount: operation.amount,
      });
    case "CARD_PAYMENT":
      return createCardPaymentTransaction({
        ...details,
        from: account(operation.fromAccountId),
        card: account(operation.cardAccountId),
        amount: operation.amount,
      });
    case "CONVERSION":
      return createConversionTransaction({
        ...details,
        from: account(operation.fromAccountId),
        to: account(operation.toAccountId),
        sentAmount: operation.sentAmount,
        receivedAmount: operation.receivedAmount,
        recordedAt,
        ...(operation.fee === undefined
          ? {}
          : {
              fee: { category: category(operation.fee.categoryId), amount: operation.fee.amount },
            }),
      });
  }
}

function required<T>(loaded: ReadonlyMap<string, T>, id: string): T {
  const value = loaded.get(id);
  if (value === undefined) {
    throw new Error(`Reference "${id}" was not loaded before building the transaction.`);
  }
  return value;
}

/** Same date, description, postings and rate value; the rate's recordedAt aside. */
function isSameOperation(left: Transaction, right: Transaction): boolean {
  return (
    left.date === right.date &&
    left.description === right.description &&
    left.exchangeRate?.rate === right.exchangeRate?.rate &&
    left.postings.length === right.postings.length &&
    left.postings.every((posting, index) => {
      const other = right.postings[index];
      return other !== undefined && isSamePosting(posting, other);
    })
  );
}

function isSamePosting(left: Posting, right: Posting): boolean {
  return (
    targetKey(left.target) === targetKey(right.target) &&
    left.amount.amountMinor === right.amount.amountMinor &&
    left.amount.currency === right.amount.currency
  );
}

function targetKey(target: PostingTarget): string {
  switch (target.kind) {
    case "ACCOUNT":
      return `ACCOUNT:${target.accountId}`;
    case "CATEGORY":
      return `CATEGORY:${target.categoryId}`;
    case "SYSTEM":
      return `SYSTEM:${target.role}`;
  }
}
