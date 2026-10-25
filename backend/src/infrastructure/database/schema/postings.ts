import type { Currency, SystemPostingRole } from "@solvia/core";
import { sql } from "drizzle-orm";
import { check, index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { accounts } from "./accounts.ts";
import { categories } from "./categories.ts";
import { bigintInteger } from "./columns.ts";
import { transactions } from "./transactions.ts";

/**
 * One line of a transaction, in the core's order (`position`). The target is one of
 * three nullable columns, mapped to the core PostingTarget union (ADR-0004, L1).
 * Foreign keys are RESTRICT, never CASCADE: no financial row is ever deleted with
 * another, and a violation is a safety net, not how conflicts are reported (L9).
 */
export const postings = sqliteTable(
  "postings",
  {
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "restrict" }),
    position: bigintInteger("position").notNull(),
    accountId: text("account_id").references(() => accounts.id, { onDelete: "restrict" }),
    categoryId: text("category_id").references(() => categories.id, { onDelete: "restrict" }),
    // Internal target, written only from postings the core factories created.
    systemRole: text("system_role").$type<SystemPostingRole>(),
    amountMinor: bigintInteger("amount_minor").notNull(),
    currency: text("currency").$type<Currency>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.transactionId, table.position] }),
    // The only CHECK of the ledger, and a structural one (L2): the three nullable
    // columns represent one target. Which targets a type may use is a core rule.
    check(
      "postings_exactly_one_target",
      sql`(${table.accountId} IS NOT NULL) + (${table.categoryId} IS NOT NULL) + (${table.systemRole} IS NOT NULL) = 1`,
    ),
    // For the RESTRICT checks on delete, *_IN_USE and balance reads.
    index("postings_account_id_idx").on(table.accountId),
    index("postings_category_id_idx").on(table.categoryId),
  ],
);
