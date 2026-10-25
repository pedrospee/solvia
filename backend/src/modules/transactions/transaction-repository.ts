import {
  CANONICAL_EXCHANGE_RATE_PAIR,
  createMoney,
  type ExchangeRate,
  type Posting,
  type PostingTarget,
  type Transaction,
} from "@solvia/core";
import { asc, eq, isNull, type SQL } from "drizzle-orm";
import type { DbExecutor } from "../../infrastructure/database/client.ts";
import { postings } from "../../infrastructure/database/schema/postings.ts";
import { transactions } from "../../infrastructure/database/schema/transactions.ts";

/**
 * A transaction as persisted: the core Transaction plus its lifecycle timestamps.
 * It may be voided, so it is never calculation input: calculations take the
 * effective ledger from loadEffectiveLedger (ADR-0004, section 8).
 */
export type TransactionRecord = Readonly<{
  transaction: Transaction;
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

type TransactionRow = typeof transactions.$inferSelect;
type PostingRow = typeof postings.$inferSelect;

/**
 * The effective condition (BR-24): the only place it is written. Every financial
 * calculation reads through loadEffectiveLedger, never its own voided_at filter.
 */
const effective = isNull(transactions.voidedAt);

export type TransactionRepository = ReturnType<typeof createTransactionRepository>;

/**
 * Ledger persistence. It writes what the service built through the core and never
 * opens a transaction: the service runs it inside one, so a transaction row and its
 * postings are always written together.
 */
export function createTransactionRepository(db: DbExecutor) {
  /** Transactions matching `where`, with their postings in the core's order. */
  function load(where: SQL | undefined): TransactionRecord[] {
    const rows = db
      .select()
      .from(transactions)
      .where(where)
      .orderBy(asc(transactions.date), asc(transactions.createdAt), asc(transactions.id))
      .all();
    const postingRows = db
      .select({ posting: postings })
      .from(postings)
      .innerJoin(transactions, eq(postings.transactionId, transactions.id))
      .where(where)
      .orderBy(asc(postings.transactionId), asc(postings.position))
      .all();

    const postingsById = new Map<string, Posting[]>();
    for (const { posting } of postingRows) {
      const list = postingsById.get(posting.transactionId) ?? [];
      list.push(fromPostingRow(posting));
      postingsById.set(posting.transactionId, list);
    }
    return rows.map((row) => fromRow(row, postingsById.get(row.id) ?? []));
  }

  function insertPostings(transaction: Transaction): void {
    db.insert(postings)
      .values(
        transaction.postings.map((posting, index) => toPostingRow(transaction.id, index, posting)),
      )
      .run();
  }

  return {
    insert(record: TransactionRecord): void {
      db.insert(transactions).values(toRow(record)).run();
      insertPostings(record.transaction);
    },

    /** Writes a new version of the operation: the row, then its postings, replaced. */
    replace(record: TransactionRecord): void {
      const { date, description, exchangeRate, updatedAt } = toRow(record);
      db.update(transactions)
        .set({ date, description, exchangeRate, updatedAt })
        .where(eq(transactions.id, record.transaction.id))
        .run();
      db.delete(postings).where(eq(postings.transactionId, record.transaction.id)).run();
      insertPostings(record.transaction);
    },

    /** Only voided_at changes: postings stay, updated_at stays (V9). */
    markVoided(id: string, voidedAt: string): void {
      db.update(transactions).set({ voidedAt }).where(eq(transactions.id, id)).run();
    },

    /** Voided or not (V8). */
    findById(id: string): TransactionRecord | undefined {
      return load(eq(transactions.id, id))[0];
    },

    /** Oldest date first. Voided transactions only when asked for (V8). */
    list(options: { includeVoided: boolean }): TransactionRecord[] {
      return load(options.includeVoided ? undefined : effective);
    },

    /** The effective ledger: the non-voided transactions, as the core calculates on them. */
    loadEffectiveLedger(): readonly Transaction[] {
      return load(effective).map(({ transaction }) => transaction);
    },

    /** Any posting, voided transactions included: their postings are kept (L9). */
    isAccountReferenced(accountId: string): boolean {
      return isReferenced(db, eq(postings.accountId, accountId));
    },

    isCategoryReferenced(categoryId: string): boolean {
      return isReferenced(db, eq(postings.categoryId, categoryId));
    },
  };
}

function isReferenced(db: DbExecutor, condition: SQL): boolean {
  const row = db
    .select({ transactionId: postings.transactionId })
    .from(postings)
    .where(condition)
    .limit(1)
    .get();
  return row !== undefined;
}

function toRow({ transaction, voidedAt, createdAt, updatedAt }: TransactionRecord): TransactionRow {
  return {
    id: transaction.id,
    date: transaction.date,
    description: transaction.description,
    type: transaction.type,
    exchangeRate: transaction.exchangeRate?.rate ?? null,
    voidedAt,
    createdAt,
    updatedAt,
  };
}

/**
 * Only the rate value is stored (L5). The rest of the core ExchangeRate is implied:
 * EUR/BRL, executed (TRANSACTION), effective on the transaction date, recorded when
 * this version of the transaction was (updated_at).
 */
function fromRow(row: TransactionRow, rowPostings: Posting[]): TransactionRecord {
  const exchangeRate: ExchangeRate | undefined =
    row.exchangeRate === null
      ? undefined
      : {
          ...CANONICAL_EXCHANGE_RATE_PAIR,
          rate: row.exchangeRate,
          effectiveDate: row.date,
          source: "TRANSACTION",
          recordedAt: row.updatedAt,
        };
  const transaction: Transaction = {
    id: row.id,
    date: row.date,
    description: row.description,
    type: row.type,
    postings: rowPostings,
    ...(exchangeRate === undefined ? {} : { exchangeRate }),
  };
  return {
    transaction,
    voidedAt: row.voidedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPostingRow(
  transactionId: string,
  index: number,
  { target, amount }: Posting,
): PostingRow {
  return {
    transactionId,
    position: BigInt(index),
    accountId: target.kind === "ACCOUNT" ? target.accountId : null,
    categoryId: target.kind === "CATEGORY" ? target.categoryId : null,
    systemRole: target.kind === "SYSTEM" ? target.role : null,
    amountMinor: amount.amountMinor,
    currency: amount.currency,
  };
}

function fromPostingRow(row: PostingRow): Posting {
  return { target: targetOf(row), amount: createMoney(row.amountMinor, row.currency) };
}

/** The CHECK guarantees exactly one of the three columns is set. */
function targetOf({ accountId, categoryId, systemRole }: PostingRow): PostingTarget {
  if (accountId !== null) {
    return { kind: "ACCOUNT", accountId };
  }
  if (categoryId !== null) {
    return { kind: "CATEGORY", categoryId };
  }
  if (systemRole !== null) {
    return { kind: "SYSTEM", role: systemRole };
  }
  throw new Error("A posting row has no target; the postings_exactly_one_target CHECK is missing.");
}
