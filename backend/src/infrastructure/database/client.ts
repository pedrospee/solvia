import Database, { type RunResult } from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import * as schema from "./schema/index.ts";

export type SqliteConnection = Database.Database;
export type AppDatabase = BetterSQLite3Database<typeof schema>;

/**
 * What repositories run their queries on: the database itself, or the transaction a
 * service opened with `db.transaction(...)`, so every write of a use case commits or
 * rolls back together (ADR-0004, section 1).
 */
export type DbExecutor = BaseSQLiteDatabase<"sync", RunResult, typeof schema>;

/**
 * Opens a SQLite connection configured for Solvia:
 * - foreign keys enforced (SQLite leaves them off per connection by default);
 * - WAL journal for file databases, so reads never block the single writer;
 * - safe integers, so every INTEGER column is read as `bigint` and money
 *   never passes through a JavaScript `number` (ADR-0002).
 */
export function openSqlite(
  path: string,
  options: { fileMustExist?: boolean; readonly?: boolean } = {},
): SqliteConnection {
  const sqlite = new Database(path, options);
  sqlite.defaultSafeIntegers(true);
  sqlite.pragma("foreign_keys = ON");
  if (!options.readonly && path !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
  }
  return sqlite;
}

export function createDatabase(sqlite: SqliteConnection): AppDatabase {
  return drizzle(sqlite, { schema });
}
