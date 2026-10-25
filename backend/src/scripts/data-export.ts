import { existsSync } from "node:fs";
import { loadEnvironment } from "../infrastructure/config/environment.ts";
import { createDatabase, openSqlite } from "../infrastructure/database/client.ts";
import {
  assertNoPendingMigrations,
  PendingMigrationsError,
} from "../infrastructure/database/migrations.ts";
import { writeDataExport } from "../modules/data-export/data-export.ts";

// npm run data:export — every record as JSON in EXPORT_DIR, readable without Solvia.
const environment = loadEnvironment();
if (!existsSync(environment.DATABASE_PATH)) {
  console.error("No database found at DATABASE_PATH; there is nothing to export.");
  process.exit(1);
}

const sqlite = openSqlite(environment.DATABASE_PATH, { fileMustExist: true });
try {
  assertNoPendingMigrations(sqlite);
  console.log(`Export: ${writeDataExport(createDatabase(sqlite), environment.EXPORT_DIR)}`);
} catch (error) {
  if (error instanceof PendingMigrationsError) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  sqlite.close();
}
