import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseLocalDate } from "@solvia/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
} from "../../infrastructure/database/test-fixtures.ts";
import { createAccountService } from "../accounts/account-service.ts";
import { createCategoryService } from "../categories/category-service.ts";
import { createExchangeRateRepository } from "../exchange-rates/exchange-rate-repository.ts";
import { createExchangeRateService } from "../exchange-rates/exchange-rate-service.ts";
import { createTransactionService } from "../transactions/transaction-service.ts";
import { dataExportSchema, exportData, writeDataExport } from "./data-export.ts";

const ABOVE_MAX_SAFE_INTEGER = 90_071_992_547_409_930n;
const NOW = new Date("2026-10-25T12:00:00.000Z");

let database: TestDatabase;
let workDir: string;

beforeEach(() => {
  database = createTestDatabase();
  workDir = mkdtempSync(join(tmpdir(), "solvia-export-"));
  const { db } = database;
  const accounts = createAccountService(db);
  const categories = createCategoryService(db);
  const transactions = createTransactionService(db);

  const bank = accounts.create({
    name: "Demo Bank",
    kind: "BANK",
    currency: "EUR",
    overdraftLimit: { amountMinor: ABOVE_MAX_SAFE_INTEGER, currency: "EUR" },
  });
  const old = accounts.create({ name: "Old Account", kind: "CASH", currency: "EUR" });
  accounts.archive(old.account.id);
  const food = categories.create({ name: "Food", nature: "EXPENSE" });
  const retired = categories.create({ name: "Retired", nature: "EXPENSE" });
  categories.archive(retired.category.id);
  createExchangeRateService(createExchangeRateRepository(db)).create({
    baseCurrency: "EUR",
    quoteCurrency: "BRL",
    rate: "6.2",
    effectiveDate: parseLocalDate("2026-10-01"),
  });
  const expense = (description: string) =>
    transactions.create({
      type: "EXPENSE",
      date: parseLocalDate("2026-10-02"),
      description,
      paidFromAccountId: bank.account.id,
      categoryId: food.category.id,
      amount: { amountMinor: 4_590n, currency: "EUR" },
    });
  expense("Kept");
  transactions.void(expense("Voided").transaction.id);
});

afterEach(() => {
  database.sqlite.close();
  rmSync(workDir, { recursive: true, force: true });
});

describe("exportData", () => {
  it("exports every record, archived and voided ones included, in the API's JSON shape", () => {
    const exported = exportData(database.db, NOW);

    expect(dataExportSchema.parse(exported)).toEqual(exported);
    expect(exported).toMatchObject({
      format: "solvia-data-export",
      version: 1,
      exportedAt: NOW.toISOString(),
    });
    expect(exported.accounts.map(({ name, archivedAt }) => [name, archivedAt !== null])).toEqual([
      ["Demo Bank", false],
      ["Old Account", true],
    ]);
    expect(exported.accounts[0]?.overdraftLimit?.amountMinor).toBe(String(ABOVE_MAX_SAFE_INTEGER));
    expect(exported.categories.map(({ name }) => name).sort()).toEqual(["Food", "Retired"]);
    expect(exported.exchangeRates.map(({ rate }) => rate)).toEqual(["6.2"]);
    expect(
      exported.transactions.map(({ description, voidedAt }) => [description, voidedAt !== null]),
    ).toEqual(
      expect.arrayContaining([
        ["Kept", false],
        ["Voided", true],
      ]),
    );
    expect(exported.transactions[0]?.postings).toHaveLength(2);
  });

  it("stores no derived value: balances are recalculated from the transactions", () => {
    const text = JSON.stringify(exportData(database.db, NOW));

    expect(text).not.toMatch(/"balance"|"overdraft"/);
  });
});

describe("writeDataExport", () => {
  it("writes a private file (600) in a private directory (700), never overwriting one", () => {
    const exportDir = join(workDir, "exports");

    const path = writeDataExport(database.db, exportDir, NOW);

    expect(path).toBe(join(exportDir, "solvia-export-2026-10-25T12-00-00-000Z.json"));
    expect(statSync(exportDir).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(exportData(database.db, NOW));
    expect(() => writeDataExport(database.db, exportDir, NOW)).toThrow(/EEXIST/);
  });
});
