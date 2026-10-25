import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./http/app.ts";
import { localHosts } from "./http/local-request-guard.ts";
import { loadEnvironment } from "./infrastructure/config/environment.ts";
import { createDatabase, openSqlite } from "./infrastructure/database/client.ts";
import {
  assertNoPendingMigrations,
  PendingMigrationsError,
} from "./infrastructure/database/migrations.ts";

// Single user, no authentication: the API must never be reachable from the network.
const HOSTNAME = "127.0.0.1";

const environment = loadEnvironment();

// The server never creates or migrates the database; that is `npm run db:migrate`.
if (!existsSync(environment.DATABASE_PATH)) {
  console.error("No database found at DATABASE_PATH. Run `npm run db:migrate` to create it.");
  process.exit(1);
}
const sqlite = openSqlite(environment.DATABASE_PATH, { fileMustExist: true });
try {
  assertNoPendingMigrations(sqlite);
} catch (error) {
  sqlite.close();
  if (error instanceof PendingMigrationsError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const app = createApp({
  db: createDatabase(sqlite),
  allowedHosts: localHosts(environment.PORT),
});
const server = serve({ fetch: app.fetch, hostname: HOSTNAME, port: environment.PORT }, (info) => {
  console.log(`Solvia API on http://${info.address}:${info.port} (${environment.NODE_ENV}).`);
});

function shutdown(): void {
  server.close(() => {
    sqlite.close();
    process.exit(0);
  });
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
