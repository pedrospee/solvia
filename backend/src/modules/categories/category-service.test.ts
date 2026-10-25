import { parseLocalDate } from "@solvia/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
} from "../../infrastructure/database/test-fixtures.ts";
import { createAccountService } from "../accounts/account-service.ts";
import { createTransactionService } from "../transactions/transaction-service.ts";
import { createCategoryService } from "./category-service.ts";

let database: TestDatabase;
let clock: Date;

function service() {
  return createCategoryService(database.db, {
    now: () => clock,
    // Sequential ids (c1, c2…), so tests can refer to them.
    newId: (() => {
      let sequence = 0;
      return () => `c${++sequence}`;
    })(),
  });
}

const code = (expected: string) => expect.objectContaining({ code: expected });

beforeEach(() => {
  database = createTestDatabase();
  clock = new Date("2026-09-01T10:00:00.000Z");
});

afterEach(() => {
  database.sqlite.close();
});

/** Food (c1) with the child Groceries (c2), and Housing (c3), all EXPENSE; Salary (c4), INCOME. */
function seeded() {
  const categories = service();
  const food = categories.create({ name: "Food", nature: "EXPENSE" }).category;
  const groceries = categories.create({
    name: "Groceries",
    nature: "EXPENSE",
    parentId: food.id,
  }).category;
  const housing = categories.create({ name: "Housing", nature: "EXPENSE" }).category;
  const salary = categories.create({ name: "Salary", nature: "INCOME" }).category;
  return { categories, food, groceries, housing, salary };
}

describe("creating categories", () => {
  it("creates top-level and child categories through the core, with timestamps", () => {
    const { categories, groceries } = seeded();

    expect(categories.get(groceries.id)).toEqual({
      category: { id: "c2", name: "Groceries", nature: "EXPENSE", parentId: "c1" },
      archivedAt: null,
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    });
  });

  it("rejects a missing parent with CATEGORY_NOT_FOUND", () => {
    const categories = service();

    expect(() =>
      categories.create({ name: "Groceries", nature: "EXPENSE", parentId: "missing" }),
    ).toThrowError(code("CATEGORY_NOT_FOUND"));
  });

  it("lets the core reject a child of another nature (BR-70) or a third level (BR-71)", () => {
    const { categories, food, groceries } = seeded();

    expect(() =>
      categories.create({ name: "Bonus", nature: "INCOME", parentId: food.id }),
    ).toThrowError(code("INVALID_CATEGORY"));
    expect(() =>
      categories.create({ name: "Organic", nature: "EXPENSE", parentId: groceries.id }),
    ).toThrowError(code("INVALID_CATEGORY"));
    expect(categories.list({ includeArchived: true })).toHaveLength(4);
  });

  it("rejects a child under an archived parent", () => {
    const { categories, housing } = seeded();
    categories.archive(housing.id);

    expect(() =>
      categories.create({ name: "Rent", nature: "EXPENSE", parentId: housing.id }),
    ).toThrowError(code("CATEGORY_PARENT_ARCHIVED"));
  });
});

describe("updating categories", () => {
  it("renames and moves a category, keeping createdAt and moving updatedAt", () => {
    const { categories, groceries, housing } = seeded();
    clock = new Date("2026-09-02T10:00:00.000Z");

    const updated = categories.update(groceries.id, {
      name: "Home supplies",
      parentId: housing.id,
    });

    expect(updated.category).toEqual({
      id: groceries.id,
      name: "Home supplies",
      nature: "EXPENSE",
      parentId: housing.id,
    });
    expect(updated.createdAt).toBe("2026-09-01T10:00:00.000Z");
    expect(updated.updatedAt).toBe("2026-09-02T10:00:00.000Z");
  });

  it("moves a category to the top level with parentId null", () => {
    const { categories, groceries } = seeded();

    expect(categories.update(groceries.id, { parentId: null }).category).toEqual({
      id: groceries.id,
      name: "Groceries",
      nature: "EXPENSE",
    });
  });

  it("validates the resulting tree: a category with children cannot become a child", () => {
    const { categories, food, housing } = seeded();

    expect(() => categories.update(food.id, { parentId: housing.id })).toThrowError(
      code("INVALID_CATEGORY"),
    );
    expect(categories.get(food.id).category.parentId).toBeUndefined();
  });

  it("rejects a move under a parent of another nature, a missing or an archived parent", () => {
    const { categories, groceries, housing, salary } = seeded();

    expect(() => categories.update(groceries.id, { parentId: salary.id })).toThrowError(
      code("INVALID_CATEGORY"),
    );
    expect(() => categories.update(groceries.id, { parentId: "missing" })).toThrowError(
      code("CATEGORY_NOT_FOUND"),
    );
    categories.archive(housing.id);
    expect(() => categories.update(groceries.id, { parentId: housing.id })).toThrowError(
      code("CATEGORY_PARENT_ARCHIVED"),
    );
  });

  it("treats an update that changes nothing as a no-op, leaving updatedAt untouched", () => {
    const { categories, groceries, food } = seeded();
    const before = categories.get(groceries.id);
    clock = new Date("2026-09-02T10:00:00.000Z");

    expect(categories.update(groceries.id, {})).toEqual(before);
    expect(categories.update(groceries.id, { name: " Groceries ", parentId: food.id })).toEqual(
      before,
    );
    expect(categories.get(groceries.id)).toEqual(before);
  });
});

describe("archiving categories", () => {
  it("archives and unarchives, reversibly and idempotently", () => {
    const { categories, housing } = seeded();
    clock = new Date("2026-09-03T10:00:00.000Z");

    const archived = categories.archive(housing.id);
    clock = new Date("2026-09-04T10:00:00.000Z");

    expect(archived.archivedAt).toBe("2026-09-03T10:00:00.000Z");
    expect(categories.archive(housing.id)).toEqual(archived);
    const restored = categories.unarchive(housing.id);
    expect(restored.archivedAt).toBeNull();
    expect(categories.unarchive(housing.id)).toEqual(restored);
  });

  it("refuses to archive a parent with active children, without cascading", () => {
    const { categories, food, groceries } = seeded();

    expect(() => categories.archive(food.id)).toThrowError(code("CATEGORY_HAS_ACTIVE_CHILDREN"));
    expect(categories.get(groceries.id).archivedAt).toBeNull();

    categories.archive(groceries.id);
    expect(categories.archive(food.id).archivedAt).not.toBeNull();
  });

  it("refuses to unarchive a child while its parent is archived", () => {
    const { categories, food, groceries } = seeded();
    categories.archive(groceries.id);
    categories.archive(food.id);

    expect(() => categories.unarchive(groceries.id)).toThrowError(code("CATEGORY_PARENT_ARCHIVED"));

    categories.unarchive(food.id);
    expect(categories.unarchive(groceries.id).archivedAt).toBeNull();
  });
});

describe("deleting categories", () => {
  it("deletes a category without children", () => {
    const { categories, housing } = seeded();

    categories.delete(housing.id);

    expect(() => categories.get(housing.id)).toThrowError(code("CATEGORY_NOT_FOUND"));
  });

  it("refuses to delete a parent, even with only archived children, and never cascades", () => {
    const { categories, food, groceries } = seeded();
    categories.archive(groceries.id);

    expect(() => categories.delete(food.id)).toThrowError(code("CATEGORY_HAS_CHILDREN"));
    expect(categories.get(groceries.id)).toBeDefined();
  });

  it("refuses to delete a category with transactions, voided ones included (CATEGORY_IN_USE)", () => {
    const { categories, food, groceries, housing } = seeded();
    const { account } = createAccountService(database.db).create({
      name: "Demo Bank",
      kind: "BANK",
      currency: "EUR",
    });
    const transactions = createTransactionService(database.db, { now: () => clock });
    const expense = (categoryId: string) =>
      transactions.create({
        type: "EXPENSE",
        date: parseLocalDate("2026-09-01"),
        description: "Fictitious",
        paidFromAccountId: account.id,
        categoryId,
        amount: { amountMinor: 1_000n, currency: "EUR" },
      });
    transactions.void(expense(housing.id).transaction.id);
    expense(food.id);

    expect(() => categories.delete(housing.id)).toThrowError(code("CATEGORY_IN_USE"));
    // Children take precedence over postings.
    expect(() => categories.delete(food.id)).toThrowError(code("CATEGORY_HAS_CHILDREN"));
    expect(() => categories.delete(groceries.id)).not.toThrow();
  });

  it("reports a missing category as CATEGORY_NOT_FOUND in every operation", () => {
    const categories = service();
    const operations = [
      () => categories.get("missing"),
      () => categories.update("missing", { name: "x" }),
      () => categories.archive("missing"),
      () => categories.unarchive("missing"),
      () => categories.delete("missing"),
    ];

    for (const operation of operations) {
      expect(operation).toThrowError(code("CATEGORY_NOT_FOUND"));
    }
  });
});
