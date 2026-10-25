import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openSqlite, type SqliteConnection } from "./client.ts";
import {
  assertNoPendingMigrations,
  countPendingMigrations,
  ForeignKeyViolationError,
  MIGRATIONS_FOLDER,
  migrateDatabase,
  PendingMigrationsError,
} from "./migrations.ts";

// Fictitious migrations, written the way drizzle-kit writes them.
const FIRST = {
  tag: "0000_first",
  when: 1_000,
  sql: "CREATE TABLE `notes` (`id` text PRIMARY KEY);",
};
const SECOND = { tag: "0001_second", when: 2_000, sql: "ALTER TABLE `notes` ADD `body` text;" };

let workDir: string;
let backupDir: string;
const openConnections: SqliteConnection[] = [];

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "solvia-migrations-"));
  backupDir = join(workDir, "backups");
});

afterEach(() => {
  for (const sqlite of openConnections.splice(0)) {
    sqlite.close();
  }
  rmSync(workDir, { recursive: true, force: true });
});

function writeMigrations(migrations: (typeof FIRST)[]): string {
  const folder = join(workDir, `migrations-${migrations.length}`);
  mkdirSync(join(folder, "meta"), { recursive: true });
  const entries = migrations.map(({ tag, when }, idx) => ({
    idx,
    version: "6",
    when,
    tag,
    breakpoints: true,
  }));
  writeFileSync(
    join(folder, "meta", "_journal.json"),
    JSON.stringify({ version: "7", dialect: "sqlite", entries }),
  );
  for (const { tag, sql } of migrations) {
    writeFileSync(join(folder, `${tag}.sql`), sql);
  }
  return folder;
}

/** A copy of the first `count` committed migrations, to upgrade a database with data. */
function committedMigrationsUpTo(count: number): string {
  const folder = join(workDir, `committed-${count}`);
  mkdirSync(join(folder, "meta"), { recursive: true });
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"),
  ) as { entries: { tag: string }[] };
  const entries = journal.entries.slice(0, count);
  writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
  for (const { tag } of entries) {
    copyFileSync(join(MIGRATIONS_FOLDER, `${tag}.sql`), join(folder, `${tag}.sql`));
  }
  return folder;
}

function openFileDatabase(): SqliteConnection {
  const sqlite = openSqlite(join(workDir, "solvia.db"));
  openConnections.push(sqlite);
  return sqlite;
}

function backupFiles(): string[] {
  try {
    return readdirSync(backupDir);
  } catch {
    return [];
  }
}

describe("committed migrations", () => {
  it("apply successfully to an empty in-memory database", () => {
    const sqlite = openSqlite(":memory:");
    openConnections.push(sqlite);

    migrateDatabase(sqlite, { backupDir });

    expect(countPendingMigrations(sqlite, MIGRATIONS_FOLDER)).toBe(0);
    expect(backupFiles()).toEqual([]);
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name <> '__drizzle_migrations'",
      )
      .pluck()
      .all();
    expect(tables).toEqual(["accounts", "categories", "exchange_rates"]);
  });

  it("add exchange_rates to a database with data, keeping every row and foreign key", () => {
    const sqlite = openFileDatabase();
    migrateDatabase(sqlite, { backupDir, migrationsFolder: committedMigrationsUpTo(2) });
    const t = "2026-09-01T10:00:00.000Z";
    sqlite
      .prepare(
        "INSERT INTO accounts VALUES ('a1', 'Demo Bank', NULL, 'BANK', 'EUR', ?, NULL, ?, ?)",
      )
      .run(90_071_992_547_409_930n, t, t);
    sqlite
      .prepare("INSERT INTO categories VALUES ('food', 'Food', 'EXPENSE', NULL, NULL, ?, ?)")
      .run(t, t);
    sqlite
      .prepare(
        "INSERT INTO categories VALUES ('groceries', 'Groceries', 'EXPENSE', 'food', ?, ?, ?)",
      )
      .run(t, t, t);
    const snapshot = () => ({
      accounts: sqlite.prepare("SELECT * FROM accounts").all(),
      categories: sqlite.prepare("SELECT * FROM categories ORDER BY id").all(),
    });
    const before = snapshot();

    const result = migrateDatabase(sqlite, { backupDir });

    expect(result).toMatchObject({ status: "migrated", applied: 1 });
    expect(backupFiles()).toHaveLength(1);
    expect(snapshot()).toEqual(before);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1n);
    expect(() => sqlite.prepare("DELETE FROM categories WHERE id = 'food'").run()).toThrow(
      /FOREIGN KEY/,
    );
    expect(countPendingMigrations(sqlite)).toBe(0);
  });
});

describe("migrateDatabase", () => {
  it("migrates a new database without creating a backup", () => {
    const sqlite = openFileDatabase();
    const folder = writeMigrations([FIRST]);

    const result = migrateDatabase(sqlite, { backupDir, migrationsFolder: folder });

    expect(result).toEqual({ status: "migrated", applied: 1 });
    expect(backupFiles()).toEqual([]);
  });

  it("does nothing, and creates no backup, when no migration is pending", () => {
    const sqlite = openFileDatabase();
    const folder = writeMigrations([FIRST]);
    migrateDatabase(sqlite, { backupDir, migrationsFolder: folder });

    const result = migrateDatabase(sqlite, { backupDir, migrationsFolder: folder });

    expect(result).toEqual({ status: "up-to-date" });
    expect(backupFiles()).toEqual([]);
  });

  it("backs up an existing database before applying pending migrations", () => {
    const sqlite = openFileDatabase();
    migrateDatabase(sqlite, { backupDir, migrationsFolder: writeMigrations([FIRST]) });
    sqlite.prepare("INSERT INTO notes (id) VALUES ('fictitious-note')").run();

    const result = migrateDatabase(sqlite, {
      backupDir,
      migrationsFolder: writeMigrations([FIRST, SECOND]),
    });

    expect(result.status).toBe("migrated");
    expect(result).toMatchObject({ applied: 1 });
    expect(backupFiles()).toHaveLength(1);

    // The backup holds the data and the schema from before the migration.
    const backup = openSqlite(join(backupDir, backupFiles()[0] ?? ""), { readonly: true });
    openConnections.push(backup);
    const columns = backup.prepare("SELECT name FROM pragma_table_info('notes')").pluck().all();
    expect(columns).toEqual(["id"]);
    expect(backup.prepare("SELECT id FROM notes").pluck().all()).toEqual(["fictitious-note"]);
  });

  it("does not migrate when the backup cannot be written", () => {
    const sqlite = openFileDatabase();
    migrateDatabase(sqlite, { backupDir, migrationsFolder: writeMigrations([FIRST]) });
    writeFileSync(backupDir, "a file where the backup directory should be");

    expect(() =>
      migrateDatabase(sqlite, { backupDir, migrationsFolder: writeMigrations([FIRST, SECOND]) }),
    ).toThrow();

    const columns = sqlite.prepare("SELECT name FROM pragma_table_info('notes')").pluck().all();
    expect(columns).toEqual(["id"]);
  });
});

describe("a failing migration", () => {
  it("is rolled back entirely, leaving the schema and the data as they were", () => {
    const sqlite = openFileDatabase();
    migrateDatabase(sqlite, { backupDir, migrationsFolder: writeMigrations([FIRST]) });
    sqlite.prepare("INSERT INTO notes (id) VALUES ('fictitious-note')").run();
    const failing = {
      tag: "0001_failing",
      when: 2_000,
      sql: "CREATE TABLE `extra` (`id` text);--> statement-breakpoint\nINSERT INTO `missing_table` VALUES (1);",
    };

    expect(() =>
      migrateDatabase(sqlite, { backupDir, migrationsFolder: writeMigrations([FIRST, failing]) }),
    ).toThrow();

    const tables = sqlite
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .pluck()
      .all();
    expect(tables).toEqual(["__drizzle_migrations", "notes"]);
    expect(sqlite.prepare("SELECT id FROM notes").pluck().all()).toEqual(["fictitious-note"]);
    expect(countPendingMigrations(sqlite, writeMigrations([FIRST, failing]))).toBe(1);
    expect(backupFiles()).toHaveLength(1);
  });
});

describe("foreign keys during migrations (ADR-0004, L6)", () => {
  // A self-referencing table, like categories.parent_id.
  const TREE = {
    tag: "0000_tree",
    when: 1_000,
    sql: "CREATE TABLE `nodes` (`id` text PRIMARY KEY NOT NULL, `parent_id` text, FOREIGN KEY (`parent_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE restrict);",
  };

  /** A table rebuild exactly as drizzle-kit generates it, copying the rows `where` selects. */
  function rebuild(where = ""): typeof FIRST {
    return {
      tag: "0001_rebuild",
      when: 2_000,
      sql: [
        "PRAGMA foreign_keys=OFF;",
        "CREATE TABLE `__new_nodes` (`id` text PRIMARY KEY NOT NULL, `parent_id` text, `label` text DEFAULT '' NOT NULL, FOREIGN KEY (`parent_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE restrict);",
        `INSERT INTO \`__new_nodes\`("id", "parent_id") SELECT "id", "parent_id" FROM \`nodes\`${where};`,
        "DROP TABLE `nodes`;",
        "ALTER TABLE `__new_nodes` RENAME TO `nodes`;",
        "PRAGMA foreign_keys=ON;",
      ].join("--> statement-breakpoint\n"),
    };
  }

  function databaseWithTree(): SqliteConnection {
    const sqlite = openFileDatabase();
    migrateDatabase(sqlite, { backupDir, migrationsFolder: writeMigrations([TREE]) });
    sqlite.prepare("INSERT INTO nodes VALUES ('root', NULL), ('leaf', 'root')").run();
    return sqlite;
  }

  const rows = (sqlite: SqliteConnection) =>
    sqlite.prepare("SELECT id, parent_id FROM nodes ORDER BY id").all();
  const columns = (sqlite: SqliteConnection) =>
    sqlite.prepare("SELECT name FROM pragma_table_info('nodes')").pluck().all();

  it("rebuilds a referenced table that holds data, keeping every row and foreign key", () => {
    const sqlite = databaseWithTree();
    const before = rows(sqlite);

    const result = migrateDatabase(sqlite, {
      backupDir,
      migrationsFolder: writeMigrations([TREE, rebuild()]),
    });

    expect(result).toMatchObject({ status: "migrated", applied: 1 });
    expect(columns(sqlite)).toEqual(["id", "parent_id", "label"]);
    expect(rows(sqlite)).toEqual(before);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1n);
    expect(() => sqlite.prepare("DELETE FROM nodes WHERE id = 'root'").run()).toThrow(
      /FOREIGN KEY/,
    );
  });

  it("rolls back entirely a migration that would leave an orphan", () => {
    const sqlite = databaseWithTree();
    const before = rows(sqlite);
    const losingRoot = writeMigrations([TREE, rebuild(" WHERE id <> 'root'")]);

    expect(() => migrateDatabase(sqlite, { backupDir, migrationsFolder: losingRoot })).toThrow(
      ForeignKeyViolationError,
    );

    expect(columns(sqlite)).toEqual(["id", "parent_id"]);
    expect(rows(sqlite)).toEqual(before);
    expect(countPendingMigrations(sqlite, losingRoot)).toBe(1);
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1n);
  });

  it("turns foreign keys back on after a migration fails for any reason", () => {
    const sqlite = databaseWithTree();
    const failing = { ...rebuild(), sql: "INSERT INTO `missing_table` VALUES (1);" };

    expect(() =>
      migrateDatabase(sqlite, { backupDir, migrationsFolder: writeMigrations([TREE, failing]) }),
    ).toThrow(/missing_table/);

    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1n);
  });

  it("records applied migrations exactly as Drizzle's migrator does", () => {
    const folder = writeMigrations([FIRST, SECOND]);
    const ours = openSqlite(":memory:");
    const drizzles = openSqlite(":memory:");
    openConnections.push(ours, drizzles);

    migrateDatabase(ours, { backupDir, migrationsFolder: folder });
    migrate(drizzle(drizzles), { migrationsFolder: folder });

    const recorded = (sqlite: SqliteConnection) => ({
      table: sqlite
        .prepare("SELECT sql FROM sqlite_schema WHERE name = '__drizzle_migrations'")
        .pluck()
        .get(),
      rows: sqlite.prepare("SELECT id, hash, created_at FROM __drizzle_migrations").all(),
    });
    expect(recorded(ours)).toEqual(recorded(drizzles));
  });
});

describe("assertNoPendingMigrations", () => {
  it("rejects a database with pending migrations and points to db:migrate", () => {
    const sqlite = openFileDatabase();
    const folder = writeMigrations([FIRST]);

    expect(() => assertNoPendingMigrations(sqlite, folder)).toThrow(PendingMigrationsError);
    expect(() => assertNoPendingMigrations(sqlite, folder)).toThrow(/npm run db:migrate/);
  });

  it("accepts a fully migrated database", () => {
    const sqlite = openFileDatabase();
    const folder = writeMigrations([FIRST]);
    migrateDatabase(sqlite, { backupDir, migrationsFolder: folder });

    expect(() => assertNoPendingMigrations(sqlite, folder)).not.toThrow();
  });
});
