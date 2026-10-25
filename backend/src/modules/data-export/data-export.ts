import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  accountResponseSchema,
  categoryResponseSchema,
  exchangeRateResponseSchema,
  transactionResponseSchema,
} from "@solvia/contracts";
import { z } from "zod";
import { accountToJson } from "../../http/mappers/account.ts";
import { categoryToJson } from "../../http/mappers/category.ts";
import { exchangeRateToJson } from "../../http/mappers/exchange-rate.ts";
import { transactionToJson } from "../../http/mappers/transaction.ts";
import type { AppDatabase } from "../../infrastructure/database/client.ts";
import {
  ensurePrivateDirectory,
  makePrivateFile,
} from "../../infrastructure/files/private-files.ts";
import { createAccountRepository } from "../accounts/account-repository.ts";
import { createCategoryRepository } from "../categories/category-repository.ts";
import { createExchangeRateRepository } from "../exchange-rates/exchange-rate-repository.ts";
import { createTransactionRepository } from "../transactions/transaction-repository.ts";

/**
 * A complete, readable copy of the data (ADR-0002, slice 6): every account, category,
 * manual rate and transaction, archived and voided ones included, in the same JSON
 * shape as the API's responses. Derived values (balances, overdraft) are left out:
 * they are recalculated from the transactions. A backup, not this file, is what
 * `db:restore` reads.
 */
export const dataExportSchema = z.strictObject({
  format: z.literal("solvia-data-export"),
  version: z.literal(1),
  exportedAt: z.iso.datetime(),
  accounts: z.array(accountResponseSchema),
  categories: z.array(categoryResponseSchema),
  exchangeRates: z.array(exchangeRateResponseSchema),
  transactions: z.array(transactionResponseSchema),
});

export type DataExport = z.infer<typeof dataExportSchema>;

/** Reads everything in one database transaction, so the export is one consistent snapshot. */
export function exportData(db: AppDatabase, now: Date = new Date()): DataExport {
  return db.transaction((tx) => ({
    format: "solvia-data-export" as const,
    version: 1 as const,
    exportedAt: now.toISOString(),
    accounts: createAccountRepository(tx).list({ includeArchived: true }).map(accountToJson),
    categories: createCategoryRepository(tx).list({ includeArchived: true }).map(categoryToJson),
    exchangeRates: createExchangeRateRepository(tx).list().map(exchangeRateToJson),
    transactions: createTransactionRepository(tx)
      .list({ includeVoided: true })
      .map(transactionToJson),
  }));
}

/**
 * Writes the export to `exportDir` as `solvia-export-<timestamp>.json`, private (700
 * directory, 600 file, docs/security.md), and never over an existing file.
 * Returns the path of the file.
 */
export function writeDataExport(
  db: AppDatabase,
  exportDir: string,
  now: Date = new Date(),
): string {
  ensurePrivateDirectory(exportDir);
  const timestamp = now.toISOString().replaceAll(":", "-").replace(".", "-");
  const path = join(exportDir, `solvia-export-${timestamp}.json`);

  writeFileSync(path, `${JSON.stringify(exportData(db, now), null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  makePrivateFile(path);
  return path;
}
