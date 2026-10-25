import { DomainError, parseLocalDate } from "@solvia/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
} from "../../infrastructure/database/test-fixtures.ts";
import { ConflictError, NotFoundError } from "../errors.ts";
import { createTransactionService } from "../transactions/transaction-service.ts";
import { createAccountService } from "./account-service.ts";

const eur = (amountMinor: bigint) => ({ amountMinor, currency: "EUR" as const });

let database: TestDatabase;
let clock: Date;

function service() {
  let sequence = 0;
  return createAccountService(database.db, {
    now: () => clock,
    newId: () => `fictitious-id-${++sequence}`,
  });
}

beforeEach(() => {
  database = createTestDatabase();
  clock = new Date("2026-09-01T10:00:00.000Z");
});

afterEach(() => {
  database.sqlite.close();
});

describe("account service", () => {
  it("creates an account through the core, with an id and timestamps", () => {
    const accounts = service();

    const created = accounts.create({
      name: "  Demo Bank  ",
      kind: "BANK",
      currency: "EUR",
      overdraftLimit: eur(50_000n),
    });

    expect(created).toEqual({
      account: {
        id: "fictitious-id-1",
        name: "Demo Bank",
        kind: "BANK",
        currency: "EUR",
        overdraftLimit: eur(50_000n),
      },
      archivedAt: null,
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    });
    expect(accounts.get("fictitious-id-1")).toEqual(created);
  });

  it("lets the core reject invalid accounts and persists nothing", () => {
    const accounts = service();

    expect(() =>
      accounts.create({ name: "Demo", kind: "CASH", currency: "EUR", overdraftLimit: eur(100n) }),
    ).toThrowError(DomainError);
    expect(accounts.list({ includeArchived: true })).toEqual([]);
  });

  it("updates editable fields, keeps createdAt and moves updatedAt", () => {
    const accounts = service();
    const created = accounts.create({
      name: "Demo",
      institution: "Example",
      kind: "BANK",
      currency: "EUR",
    });
    clock = new Date("2026-09-02T10:00:00.000Z");

    const updated = accounts.update(created.account.id, {
      name: "Renamed",
      institution: null,
      overdraftLimit: eur(20_000n),
    });

    expect(updated.account).toEqual({
      id: created.account.id,
      name: "Renamed",
      kind: "BANK",
      currency: "EUR",
      overdraftLimit: eur(20_000n),
    });
    expect(updated.createdAt).toBe("2026-09-01T10:00:00.000Z");
    expect(updated.updatedAt).toBe("2026-09-02T10:00:00.000Z");
    expect(accounts.get(created.account.id)).toEqual(updated);
  });

  it("keeps fields left out of an update, and removes the limit with null", () => {
    const accounts = service();
    const { account } = accounts.create({
      name: "Demo",
      institution: "Example",
      kind: "BANK",
      currency: "EUR",
      overdraftLimit: eur(20_000n),
    });

    expect(accounts.update(account.id, {}).account).toEqual(account);
    const { overdraftLimit: _, ...withoutLimit } = account;
    expect(accounts.update(account.id, { overdraftLimit: null }).account).toEqual(withoutLimit);
  });

  it("treats an update that changes nothing as a no-op, leaving updatedAt untouched", () => {
    const accounts = service();
    const created = accounts.create({
      name: "Demo",
      institution: "Example",
      kind: "BANK",
      currency: "EUR",
      overdraftLimit: eur(20_000n),
    });
    clock = new Date("2026-09-02T10:00:00.000Z");
    const id = created.account.id;

    expect(accounts.update(id, {})).toEqual(created);
    expect(
      accounts.update(id, { name: " Demo ", institution: "Example", overdraftLimit: eur(20_000n) }),
    ).toEqual(created);
    expect(accounts.get(id)).toEqual(created);
  });

  it("revalidates an update through the core", () => {
    const accounts = service();
    const { account } = accounts.create({ name: "Demo", kind: "WISE", currency: "EUR" });

    expect(() => accounts.update(account.id, { overdraftLimit: eur(100n) })).toThrowError(
      DomainError,
    );
    expect(accounts.get(account.id).account).toEqual(account);
  });

  it("archives and unarchives, reversibly and idempotently", () => {
    const accounts = service();
    const { account } = accounts.create({ name: "Demo", kind: "BANK", currency: "EUR" });
    clock = new Date("2026-09-03T10:00:00.000Z");

    const archived = accounts.archive(account.id);
    clock = new Date("2026-09-04T10:00:00.000Z");

    expect(archived.archivedAt).toBe("2026-09-03T10:00:00.000Z");
    expect(accounts.archive(account.id)).toEqual(archived);
    expect(accounts.list({ includeArchived: false })).toEqual([]);
    expect(accounts.list({ includeArchived: true })).toEqual([archived]);

    const restored = accounts.unarchive(account.id);
    expect(restored.archivedAt).toBeNull();
    expect(restored.updatedAt).toBe("2026-09-04T10:00:00.000Z");
    expect(accounts.unarchive(account.id)).toEqual(restored);
  });

  it("deletes an account", () => {
    const accounts = service();
    const { account } = accounts.create({ name: "Demo", kind: "BANK", currency: "EUR" });

    accounts.delete(account.id);

    expect(() => accounts.get(account.id)).toThrowError(NotFoundError);
  });

  it("refuses to delete an account with transactions, voided ones included (ACCOUNT_IN_USE)", () => {
    const accounts = service();
    const { account } = accounts.create({ name: "Demo", kind: "BANK", currency: "EUR" });
    const transactions = createTransactionService(database.db, { now: () => clock });
    const { transaction } = transactions.create({
      type: "OPENING_BALANCE",
      date: parseLocalDate("2026-09-01"),
      description: "Fictitious opening",
      accountId: account.id,
      balance: eur(10_000n),
    });
    transactions.void(transaction.id);

    expect(() => accounts.delete(account.id)).toThrowError(
      expect.objectContaining({ code: "ACCOUNT_IN_USE" }),
    );
    expect(() => accounts.delete(account.id)).toThrow(ConflictError);
    expect(accounts.get(account.id).account).toEqual(account);
  });

  it("reports a missing account as ACCOUNT_NOT_FOUND in every operation", () => {
    const accounts = service();
    const operations = [
      () => accounts.get("missing"),
      () => accounts.update("missing", { name: "x" }),
      () => accounts.archive("missing"),
      () => accounts.unarchive("missing"),
      () => accounts.delete("missing"),
    ];

    for (const operation of operations) {
      expect(operation).toThrowError(expect.objectContaining({ code: "ACCOUNT_NOT_FOUND" }));
    }
  });
});
