import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupDatabase } from "./backup.ts";
import { openSqlite, type SqliteConnection } from "./client.ts";
import { migrateDatabase } from "./migrations.ts";
import { InvalidBackupError, restoreDatabase } from "./restore.ts";

// Fictitious migrations, written the way drizzle-kit writes them.
const FIRST = {
  tag: "0000_first",
  when: 1_000,
  sql: "CREATE TABLE `notes` (`id` text PRIMARY KEY);",
};
const SECOND = { tag: "0001_second", when: 2_000, sql: "ALTER TABLE `notes` ADD `body` text;" };

let workDir: string;
let backupDir: string;
let databasePath: string;
const open: SqliteConnection[] = [];

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "solvia-restore-"));
  backupDir = join(workDir, "backups");
  databasePath = join(workDir, "solvia.db");
});

afterEach(() => {
  for (const sqlite of open.splice(0)) {
    sqlite.close();
  }
  rmSync(workDir, { recursive: true, force: true });
});

function migrations(list: (typeof FIRST)[]): string {
  const folder = join(workDir, `migrations-${list.length}`);
  mkdirSync(join(folder, "meta"), { recursive: true });
  const entries = list.map(({ tag, when }, idx) => ({
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
  for (const { tag, sql } of list) {
    writeFileSync(join(folder, `${tag}.sql`), sql);
  }
  return folder;
}

function connect(path: string): SqliteConnection {
  const sqlite = openSqlite(path);
  open.push(sqlite);
  return sqlite;
}

/** A database at the given migrations holding the given notes, backed up, then changed. */
function backedUpDatabase(
  folder: string,
  notes: string[],
): { sqlite: SqliteConnection; backupPath: string } {
  const sqlite = connect(databasePath);
  migrateDatabase(sqlite, { backupDir, migrationsFolder: folder });
  for (const id of notes) {
    sqlite.prepare("INSERT INTO notes (id) VALUES (?)").run(id);
  }
  const backupPath = backupDatabase(
    sqlite,
    backupDir,
    "manual",
    new Date("2026-10-01T10:00:00.000Z"),
  );
  sqlite.prepare("INSERT INTO notes (id) VALUES ('after-backup')").run();
  return { sqlite, backupPath };
}

const notesIn = (sqlite: SqliteConnection) =>
  sqlite.prepare("SELECT id FROM notes ORDER BY id").pluck().all();

describe("restoreDatabase", () => {
  it("replaces the database with the backup, after a verified backup of what it replaces", async () => {
    const folder = migrations([FIRST]);
    const { sqlite, backupPath } = backedUpDatabase(folder, ["kept"]);

    const result = await restoreDatabase({
      databasePath,
      backupPath,
      backupDir,
      migrationsFolder: folder,
    });

    // The connection that stayed open (a running server) reads the restored data.
    expect(notesIn(sqlite)).toEqual(["kept"]);
    expect(result).toEqual({ safetyBackupPath: expect.any(String), pendingMigrations: 0 });
    const safety = openSqlite(result.safetyBackupPath ?? "", { readonly: true });
    open.push(safety);
    expect(notesIn(safety)).toEqual(["after-backup", "kept"]);
    expect(result.safetyBackupPath).toMatch(/pre-restore\.db$/);
    expect(statSync(databasePath).mode & 0o777).toBe(0o600);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("creates a missing database from the backup, with nothing to back up first", async () => {
    const folder = migrations([FIRST]);
    const { sqlite, backupPath } = backedUpDatabase(folder, ["kept"]);
    sqlite.close();
    open.splice(0);
    for (const suffix of ["", "-wal", "-shm"]) {
      rmSync(`${databasePath}${suffix}`, { force: true });
    }

    const result = await restoreDatabase({
      databasePath,
      backupPath,
      backupDir,
      migrationsFolder: folder,
    });

    expect(result).toEqual({ pendingMigrations: 0 });
    expect(notesIn(connect(databasePath))).toEqual(["kept"]);
  });

  it("restores an older backup and reports the migrations it needs", async () => {
    const { backupPath } = backedUpDatabase(migrations([FIRST]), ["kept"]);
    const newer = migrations([FIRST, SECOND]);
    migrateDatabase(open[0] as SqliteConnection, { backupDir, migrationsFolder: newer });

    const result = await restoreDatabase({
      databasePath,
      backupPath,
      backupDir,
      migrationsFolder: newer,
    });

    expect(result.pendingMigrations).toBe(1);
  });

  describe("refuses, changing nothing and writing no backup", () => {
    async function expectRefused(backupPath: string, folder: string, message: RegExp) {
      const before = readdirSync(backupDir);

      await expect(
        restoreDatabase({ databasePath, backupPath, backupDir, migrationsFolder: folder }),
      ).rejects.toThrow(InvalidBackupError);
      await expect(
        restoreDatabase({ databasePath, backupPath, backupDir, migrationsFolder: folder }),
      ).rejects.toThrow(message);
      expect(readdirSync(backupDir)).toEqual(before);
      expect(notesIn(open[0] as SqliteConnection)).toEqual(["after-backup", "kept"]);
    }

    it("a missing file", async () => {
      const folder = migrations([FIRST]);
      backedUpDatabase(folder, ["kept"]);

      await expectRefused(join(workDir, "missing.db"), folder, /No backup/);
    });

    it("a file that is not a database", async () => {
      const folder = migrations([FIRST]);
      backedUpDatabase(folder, ["kept"]);
      const garbage = join(workDir, "garbage.db");
      writeFileSync(garbage, "not a database, just fictitious bytes ".repeat(200));

      await expectRefused(garbage, folder, /not a valid SQLite database/);
    });

    it("a database that is not Solvia's", async () => {
      const folder = migrations([FIRST]);
      backedUpDatabase(folder, ["kept"]);
      const other = connect(join(workDir, "other.db"));
      other.exec("CREATE TABLE unrelated (id TEXT)");

      await expectRefused(join(workDir, "other.db"), folder, /not a Solvia database/);
    });

    it("a backup from a newer version of Solvia", async () => {
      const older = migrations([FIRST]);
      backedUpDatabase(older, ["kept"]);
      const future = connect(join(workDir, "future.db"));
      migrateDatabase(future, {
        backupDir: join(workDir, "unused"),
        migrationsFolder: migrations([FIRST, SECOND]),
      });

      await expectRefused(join(workDir, "future.db"), older, /newer version/);
    });

    it("the database itself", async () => {
      const folder = migrations([FIRST]);
      backedUpDatabase(folder, ["kept"]);

      await expectRefused(databasePath, folder, /onto itself/);
    });
  });
});
