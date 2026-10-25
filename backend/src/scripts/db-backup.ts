import { existsSync } from "node:fs";
import { loadEnvironment } from "../infrastructure/config/environment.ts";
import { backupDatabase } from "../infrastructure/database/backup.ts";
import { openSqlite } from "../infrastructure/database/client.ts";

// npm run db:backup — a verified copy of the database in BACKUP_DIR. It reads the file,
// not the schema, so it also works while migrations are pending.
const environment = loadEnvironment();
if (!existsSync(environment.DATABASE_PATH)) {
  console.error("No database found at DATABASE_PATH; there is nothing to back up.");
  process.exit(1);
}

const sqlite = openSqlite(environment.DATABASE_PATH, { fileMustExist: true });
try {
  console.log(`Backup: ${backupDatabase(sqlite, environment.BACKUP_DIR, "manual")}`);
} finally {
  sqlite.close();
}
