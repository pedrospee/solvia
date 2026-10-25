import { dirname, resolve } from "node:path";
import { loadEnvironment } from "../infrastructure/config/environment.ts";
import { InvalidBackupError, restoreDatabase } from "../infrastructure/database/restore.ts";
import { ensurePrivateDirectory } from "../infrastructure/files/private-files.ts";

// npm run db:restore -- <backup file> — replaces the database with a backup, after a
// verified "pre-restore" backup of the current one. Stop the server first.
const backupPath = process.argv[2];
if (backupPath === undefined) {
  console.error("Usage: npm run db:restore -- <path to a backup file>");
  process.exit(1);
}

const environment = loadEnvironment();
ensurePrivateDirectory(dirname(environment.DATABASE_PATH));
try {
  const result = await restoreDatabase({
    databasePath: environment.DATABASE_PATH,
    backupPath: resolve(backupPath),
    backupDir: environment.BACKUP_DIR,
  });
  console.log(`Restored ${resolve(backupPath)}.`);
  console.log(
    result.safetyBackupPath
      ? `The previous database was backed up to ${result.safetyBackupPath}.`
      : "There was no previous data to back up.",
  );
  if (result.pendingMigrations > 0) {
    console.log(
      `The backup is ${result.pendingMigrations} migration(s) behind: run \`npm run db:migrate\` before starting Solvia.`,
    );
  }
} catch (error) {
  if (error instanceof InvalidBackupError) {
    console.error(`Nothing was restored: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
