import { fileURLToPath } from "node:url";
import { type MigrationMeta, readMigrationFiles } from "drizzle-orm/migrator";
import { backupDatabase } from "./backup.ts";
import type { SqliteConnection } from "./client.ts";

/** Committed migrations. `npm run build` copies them next to the compiled code. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("./migrations", import.meta.url));

const MIGRATIONS_TABLE = "__drizzle_migrations";

export type MigrationResult =
  | Readonly<{ status: "up-to-date" }>
  | Readonly<{ status: "migrated"; applied: number; backupPath?: string }>;

export class PendingMigrationsError extends Error {
  constructor(pending: number) {
    super(
      `The database has ${pending} pending migration(s). Run \`npm run db:migrate\` before starting Solvia.`,
    );
    this.name = "PendingMigrationsError";
  }
}

/** One row of `PRAGMA foreign_key_check`: a row of `table` whose parent row is missing. */
type ForeignKeyViolation = Readonly<{ table: string; rowid: bigint | null; parent: string }>;

/** A migration would have left rows that reference missing rows; nothing was applied. */
export class ForeignKeyViolationError extends Error {
  readonly violations: readonly ForeignKeyViolation[];

  constructor(violations: readonly ForeignKeyViolation[]) {
    const examples = violations
      .slice(0, 3)
      .map(({ table, rowid, parent }) => `${table} row ${rowid} → ${parent}`)
      .join(", ");
    super(
      `Migration rolled back: it would leave ${violations.length} row(s) referencing missing rows (${examples}).`,
    );
    this.name = "ForeignKeyViolationError";
    this.violations = violations;
  }
}

/**
 * Applies pending migrations. An existing database is backed up (and the
 * backup verified) first; a brand-new, empty database is not. Nothing happens
 * when there is nothing to apply.
 */
export function migrateDatabase(
  sqlite: SqliteConnection,
  options: { backupDir: string; migrationsFolder?: string },
): MigrationResult {
  const migrationsFolder = options.migrationsFolder ?? MIGRATIONS_FOLDER;
  const pending = countPendingMigrations(sqlite, migrationsFolder);
  if (pending === 0) {
    return { status: "up-to-date" };
  }

  const backupPath = isEmptyDatabase(sqlite)
    ? undefined
    : backupDatabase(sqlite, options.backupDir, "pre-migration");

  applyPendingMigrations(sqlite, migrationsFolder);

  return { status: "migrated", applied: pending, ...(backupPath ? { backupPath } : {}) };
}

/**
 * ADR-0004, L6. Applies the pending migrations as Drizzle's migrator does (same
 * files, statements and `__drizzle_migrations` rows), with foreign keys turned off
 * around the transaction: inside it, `PRAGMA foreign_keys = OFF` is a no-op, and
 * the `__new_<table>` rebuilds drizzle-kit generates fail on a referenced table
 * with data. `foreign_key_check` replaces the per-statement checks before commit.
 */
function applyPendingMigrations(sqlite: SqliteConnection, migrationsFolder: string): void {
  const migrations = pendingMigrations(sqlite, migrationsFolder);

  sqlite.pragma("foreign_keys = OFF");
  try {
    sqlite.exec(
      `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (\n\t\t\t\tid SERIAL PRIMARY KEY,\n\t\t\t\thash text NOT NULL,\n\t\t\t\tcreated_at numeric\n\t\t\t)`,
    );
    const record = sqlite.prepare(
      `INSERT INTO "${MIGRATIONS_TABLE}" ("hash", "created_at") VALUES (?, ?)`,
    );

    sqlite.transaction(() => {
      for (const migration of migrations) {
        for (const statement of migration.sql) {
          sqlite.prepare(statement).run();
        }
        record.run(migration.hash, migration.folderMillis);
      }
      const violations = sqlite.pragma("foreign_key_check") as ForeignKeyViolation[];
      if (violations.length > 0) {
        throw new ForeignKeyViolationError(violations);
      }
    })();
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }
}

/** Refuses to continue when the schema is behind the committed migrations. */
export function assertNoPendingMigrations(
  sqlite: SqliteConnection,
  migrationsFolder: string = MIGRATIONS_FOLDER,
): void {
  const pending = countPendingMigrations(sqlite, migrationsFolder);
  if (pending > 0) {
    throw new PendingMigrationsError(pending);
  }
}

/**
 * Uses the same rule as Drizzle's migrator: a migration is pending when it was
 * generated after the most recently applied one.
 */
export function countPendingMigrations(
  sqlite: SqliteConnection,
  migrationsFolder: string = MIGRATIONS_FOLDER,
): number {
  return pendingMigrations(sqlite, migrationsFolder).length;
}

function pendingMigrations(sqlite: SqliteConnection, migrationsFolder: string): MigrationMeta[] {
  const lastApplied = lastAppliedMigrationMillis(sqlite);
  return readMigrationFiles({ migrationsFolder }).filter(
    (migration) => lastApplied === undefined || BigInt(migration.folderMillis) > lastApplied,
  );
}

function lastAppliedMigrationMillis(sqlite: SqliteConnection): bigint | undefined {
  if (!hasMigrationsTable(sqlite)) {
    return undefined;
  }
  const row = sqlite
    .prepare(`SELECT created_at FROM ${MIGRATIONS_TABLE} ORDER BY created_at DESC LIMIT 1`)
    .get() as { created_at: bigint | number } | undefined;
  return row === undefined ? undefined : BigInt(row.created_at);
}

function hasMigrationsTable(sqlite: SqliteConnection): boolean {
  const row = sqlite
    .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?")
    .get(MIGRATIONS_TABLE);
  return row !== undefined;
}

function isEmptyDatabase(sqlite: SqliteConnection): boolean {
  const row = sqlite.prepare("SELECT count(*) AS total FROM sqlite_schema").get() as {
    total: bigint;
  };
  return row.total === 0n;
}
