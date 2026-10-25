// Test helpers. Excluded from the build (tsconfig.build.json).
import type { AppDatabase } from "../infrastructure/database/client.ts";
import { createApp } from "./app.ts";

/**
 * The app as route tests call it: `app.request("/api/...")` builds the URL
 * http://localhost/api/..., so its host is plain `localhost`. The real server only
 * answers to its loopback host and port (local-request-guard.test.ts).
 */
export function createTestApp(db: AppDatabase) {
  return createApp({ db, allowedHosts: ["localhost"] });
}
