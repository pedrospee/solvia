import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openSqlite } from "./client.ts";

describe("openSqlite", () => {
  it("enforces foreign keys and reads integers as bigint", () => {
    const sqlite = openSqlite(":memory:");

    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1n);
    expect(sqlite.prepare("SELECT 9007199254740993 AS value").get()).toEqual({
      value: 9_007_199_254_740_993n,
    });
    sqlite.close();
  });

  it("uses WAL for file databases", () => {
    const directory = mkdtempSync(join(tmpdir(), "solvia-client-"));
    const sqlite = openSqlite(join(directory, "solvia.db"));

    expect(sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("keeps a file database and its WAL files private (600), tightening an existing one", () => {
    const dir = mkdtempSync(join(tmpdir(), "solvia-client-"));
    const path = join(dir, "solvia.db");
    writeFileSync(path, "");
    chmodSync(path, 0o644);

    const sqlite = openSqlite(path);
    sqlite.exec("CREATE TABLE notes (id TEXT PRIMARY KEY); INSERT INTO notes VALUES ('a')");

    for (const file of [path, `${path}-wal`, `${path}-shm`]) {
      expect(statSync(file).mode & 0o777, file).toBe(0o600);
    }
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
