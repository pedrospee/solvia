import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { makePrivateFile } from "../files/private-files.ts";
import { backupDatabase, hasSameContents } from "./backup.ts";
import { openSqlite, type SqliteConnection } from "./client.ts";
import {
  countPendingMigrations,
  isEmptyDatabase,
  lastAppliedMigrationMillis,
  MIGRATIONS_FOLDER,
} from "./migrations.ts";

/** The file cannot be restored; nothing was changed and no backup was written. */
export class InvalidBackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBackupError";
  }
}

export type RestoreResult = Readonly<{
  /** The verified backup of the database the restore replaced; absent if it was empty. */
  safetyBackupPath?: string;
  /** Migrations the restored database still needs: run `npm run db:migrate`. */
  pendingMigrations: number;
}>;

/**
 * Replaces the database with a backup (ADR-0002, slice 6). The backup is checked
 * first: a valid SQLite file, intact, with no broken foreign keys, made by Solvia,
 * and not by a newer version than this code. The current database is then backed up
 * and verified ("pre-restore"), so a restore can itself be undone. SQLite's online
 * backup copies the file into place in one step, which a running server's connection
 * also sees, and the result is compared with the backup.
 */
export async function restoreDatabase(options: {
  databasePath: string;
  backupPath: string;
  backupDir: string;
  migrationsFolder?: string;
}): Promise<RestoreResult> {
  const { databasePath, backupPath, backupDir } = options;
  const migrationsFolder = options.migrationsFolder ?? MIGRATIONS_FOLDER;

  if (resolve(databasePath) === resolve(backupPath)) {
    throw new InvalidBackupError("A database cannot be restored onto itself.");
  }
  if (!existsSync(backupPath)) {
    throw new InvalidBackupError(`No backup at ${backupPath}.`);
  }

  const backup = openBackup(backupPath);
  try {
    assertRestorable(backup, migrationsFolder);

    const target = openSqlite(databasePath);
    try {
      const safetyBackupPath = isEmptyDatabase(target)
        ? undefined
        : backupDatabase(target, backupDir, "pre-restore");

      await backup.backup(databasePath);
      makePrivateFile(databasePath);
      if (!hasSameContents(backup, target)) {
        throw new Error(
          `The restored database does not match the backup. The previous database is at ${safetyBackupPath ?? "(none: it was empty)"}.`,
        );
      }

      return {
        ...(safetyBackupPath === undefined ? {} : { safetyBackupPath }),
        pendingMigrations: countPendingMigrations(target, migrationsFolder),
      };
    } finally {
      target.close();
    }
  } finally {
    backup.close();
  }
}

function openBackup(backupPath: string): SqliteConnection {
  try {
    return openSqlite(backupPath, { readonly: true, fileMustExist: true });
  } catch (error) {
    throw notADatabase(backupPath, error);
  }
}

function assertRestorable(backup: SqliteConnection, migrationsFolder: string): void {
  let integrity: unknown;
  try {
    integrity = backup.pragma("integrity_check", { simple: true });
  } catch (error) {
    throw notADatabase(backup.name, error);
  }
  if (integrity !== "ok") {
    throw new InvalidBackupError(
      `The backup is damaged: integrity check returned "${String(integrity)}".`,
    );
  }

  const lastApplied = lastAppliedMigrationMillis(backup);
  if (lastApplied === undefined) {
    throw new InvalidBackupError("The file is not a Solvia database: it has no migration history.");
  }
  const newestKnown = readMigrationFiles({ migrationsFolder }).reduce(
    (newest, { folderMillis }) => (BigInt(folderMillis) > newest ? BigInt(folderMillis) : newest),
    0n,
  );
  if (lastApplied > newestKnown) {
    throw new InvalidBackupError(
      "The backup was made by a newer version of Solvia; update the code before restoring it.",
    );
  }

  if ((backup.pragma("foreign_key_check") as unknown[]).length > 0) {
    throw new InvalidBackupError("The backup has rows that reference missing rows.");
  }
}

function notADatabase(path: string, cause: unknown): InvalidBackupError {
  const error = new InvalidBackupError(`${path} is not a valid SQLite database.`);
  error.cause = cause;
  return error;
}
