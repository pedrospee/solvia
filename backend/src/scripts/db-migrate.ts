import { dirname } from "node:path";
import { loadEnvironment } from "../infrastructure/config/environment.ts";
import { openSqlite } from "../infrastructure/database/client.ts";
import { migrateDatabase } from "../infrastructure/database/migrations.ts";
import { ensurePrivateDirectory } from "../infrastructure/files/private-files.ts";

// npm run db:migrate — the only operation that changes the database schema.
const environment = loadEnvironment();
ensurePrivateDirectory(dirname(environment.DATABASE_PATH));
const sqlite = openSqlite(environment.DATABASE_PATH);

try {
  const result = migrateDatabase(sqlite, { backupDir: environment.BACKUP_DIR });
  if (result.status === "up-to-date") {
    console.log("Database is up to date; nothing to migrate.");
  } else {
    console.log(`Applied ${result.applied} migration(s).`);
    console.log(
      result.backupPath ? `Backup: ${result.backupPath}` : "New database; no backup needed.",
    );
  }
} finally {
  sqlite.close();
}
