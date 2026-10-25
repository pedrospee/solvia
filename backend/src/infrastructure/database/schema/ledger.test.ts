import { parseLocalDate } from "@solvia/core";
import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../test-fixtures.ts";
import { accounts } from "./accounts.ts";
import { categories } from "./categories.ts";
import { postings } from "./postings.ts";
import { transactions } from "./transactions.ts";

// Structural guarantees of the ledger tables (ADR-0004, L1, L2, L9). Financial
// rules are tested in @solvia/core; nothing here duplicates one.

const ABOVE_MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER) * 1_000n + 7n;
const T = "2026-09-15T12:00:00.000Z";

let database: TestDatabase;

beforeEach(() => {
  database = createTestDatabase();
  const { db } = database;
  db.insert(accounts)
    .values({
      id: "bank",
      name: "Demo Bank",
      kind: "BANK",
      currency: "EUR",
      createdAt: T,
      updatedAt: T,
    })
    .run();
  db.insert(categories)
    .values({ id: "food", name: "Food", nature: "EXPENSE", createdAt: T, updatedAt: T })
    .run();
  db.insert(transactions)
    .values({
      id: "t1",
      date: parseLocalDate("2026-09-15"),
      description: "Groceries",
      type: "EXPENSE",
      createdAt: T,
      updatedAt: T,
    })
    .run();
});

afterEach(() => {
  database.sqlite.close();
});

type PostingRow = typeof postings.$inferInsert;

function insertPosting(row: Partial<PostingRow>) {
  database.db
    .insert(postings)
    .values({ transactionId: "t1", position: 0n, amountMinor: 1n, currency: "EUR", ...row })
    .run();
}

describe("postings", () => {
  it("store each kind of target, in order, with bigint amounts", () => {
    insertPosting({ position: 0n, categoryId: "food", amountMinor: ABOVE_MAX_SAFE_INTEGER });
    insertPosting({ position: 1n, accountId: "bank", amountMinor: -ABOVE_MAX_SAFE_INTEGER });
    insertPosting({ position: 2n, systemRole: "EXCHANGE_CLEARING", amountMinor: 5n });

    const rows = database.db
      .select()
      .from(postings)
      .where(eq(postings.transactionId, "t1"))
      .orderBy(asc(postings.position))
      .all();
    expect(
      rows.map(({ accountId, categoryId, systemRole }) => [accountId, categoryId, systemRole]),
    ).toEqual([
      [null, "food", null],
      ["bank", null, null],
      [null, null, "EXCHANGE_CLEARING"],
    ]);
    expect(rows.map(({ amountMinor }) => amountMinor)).toEqual([
      ABOVE_MAX_SAFE_INTEGER,
      -ABOVE_MAX_SAFE_INTEGER,
      5n,
    ]);
  });

  it("reject a posting with no target or with more than one (the only CHECK)", () => {
    const invalidTargets: Partial<PostingRow>[] = [
      {},
      { accountId: "bank", categoryId: "food" },
      { accountId: "bank", systemRole: "OPENING_BALANCE_EQUITY" },
      { accountId: "bank", categoryId: "food", systemRole: "EXCHANGE_CLEARING" },
    ];

    for (const target of invalidTargets) {
      expect(() => insertPosting(target)).toThrow(
        /CHECK constraint failed: postings_exactly_one_target/,
      );
    }
  });

  it("reject two postings at the same position of a transaction", () => {
    insertPosting({ position: 0n, accountId: "bank" });

    expect(() => insertPosting({ position: 0n, categoryId: "food" })).toThrow(/UNIQUE/);
  });

  it("reject references to a missing transaction, account or category", () => {
    const missing: Partial<PostingRow>[] = [
      { transactionId: "missing", accountId: "bank" },
      { accountId: "missing" },
      { categoryId: "missing" },
    ];

    for (const row of missing) {
      expect(() => insertPosting(row)).toThrow(/FOREIGN KEY/);
    }
  });

  it("keep the referenced transaction, account and category from being deleted (RESTRICT)", () => {
    insertPosting({ position: 0n, categoryId: "food" });
    insertPosting({ position: 1n, accountId: "bank" });
    const { db } = database;

    expect(() => db.delete(transactions).where(eq(transactions.id, "t1")).run()).toThrow(
      /FOREIGN KEY/,
    );
    expect(() => db.delete(accounts).where(eq(accounts.id, "bank")).run()).toThrow(/FOREIGN KEY/);
    expect(() => db.delete(categories).where(eq(categories.id, "food")).run()).toThrow(
      /FOREIGN KEY/,
    );
    expect(db.select().from(postings).all()).toHaveLength(2);
  });

  it("have indexes on account_id and category_id", () => {
    const indexed = database.sqlite
      .prepare(
        "SELECT ii.name FROM pragma_index_list('postings') AS il, pragma_index_info(il.name) AS ii WHERE il.origin = 'c' ORDER BY ii.name",
      )
      .pluck()
      .all();

    expect(indexed).toEqual(["account_id", "category_id"]);
  });
});

describe("transactions", () => {
  it("store a two-currency rate and a void as nullable text, with no balance column", () => {
    database.db
      .update(transactions)
      .set({ exchangeRate: "6.2", voidedAt: T })
      .where(eq(transactions.id, "t1"))
      .run();

    expect(database.db.select().from(transactions).get()).toEqual({
      id: "t1",
      date: "2026-09-15",
      description: "Groceries",
      type: "EXPENSE",
      exchangeRate: "6.2",
      voidedAt: T,
      createdAt: T,
      updatedAt: T,
    });
  });
});
