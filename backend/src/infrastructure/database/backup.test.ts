import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupDatabase } from "./backup.ts";
import { openSqlite } from "./client.ts";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "solvia-backup-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("backupDatabase", () => {
  it("writes a verified copy, including uncheckpointed WAL writes", () => {
    const sqlite = openSqlite(join(workDir, "solvia.db"));
    sqlite.exec("CREATE TABLE notes (id TEXT PRIMARY KEY)");
    sqlite.prepare("INSERT INTO notes (id) VALUES ('fictitious-note')").run();
    const backupDir = join(workDir, "backups");

    const backupPath = backupDatabase(
      sqlite,
      backupDir,
      "manual",
      new Date("2026-01-02T03:04:05.678Z"),
    );

    expect(readdirSync(backupDir)).toEqual(["solvia-2026-01-02T03-04-05-678Z-manual.db"]);
    const backup = openSqlite(backupPath, { readonly: true });
    expect(backup.prepare("SELECT id FROM notes").pluck().all()).toEqual(["fictitious-note"]);
    backup.close();
    sqlite.close();
  });

  it("never overwrites an existing backup", () => {
    const sqlite = openSqlite(":memory:");
    const backupDir = join(workDir, "backups");
    const now = new Date("2026-01-02T03:04:05.678Z");
    backupDatabase(sqlite, backupDir, "manual", now);

    expect(() => backupDatabase(sqlite, backupDir, "manual", now)).toThrow(/already exists/);
    sqlite.close();
  });

  it("keeps the backup directory and every backup private (700 and 600)", () => {
    const sqlite = openSqlite(join(workDir, "solvia.db"));
    sqlite.exec("CREATE TABLE notes (id TEXT PRIMARY KEY)");
    const backupDir = join(workDir, "backups");
    mkdirSync(backupDir);
    chmodSync(backupDir, 0o755);

    const backupPath = backupDatabase(sqlite, backupDir, "manual");

    expect(statSync(backupDir).mode & 0o777).toBe(0o700);
    expect(statSync(backupPath).mode & 0o777).toBe(0o600);
    sqlite.close();
  });
});
