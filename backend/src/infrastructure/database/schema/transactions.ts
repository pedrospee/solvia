import type { LocalDate, TransactionType } from "@solvia/core";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

// Every financial rule (balance per currency, types, signs, rates) lives in @solvia/core
// and runs before a write (ADR-0004, L2). No total or balance column: balances are
// derived from the effective ledger, never stored.
export const transactions = sqliteTable("transactions", {
  id: text("id").primaryKey(),
  date: text("date").$type<LocalDate>().notNull(),
  description: text("description").notNull(),
  type: text("type").$type<TransactionType>().notNull(),
  // Only the EUR/BRL rate of a two-currency transaction, as an exact decimal string. The
  // rest of the core ExchangeRate is rebuilt on read: TRANSACTION, effective on `date`,
  // recorded at `updated_at` (ADR-0004, L5).
  exchangeRate: text("exchange_rate"),
  // Void, never delete (BR-24): a voided transaction keeps its postings but no longer counts.
  voidedAt: text("voided_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
