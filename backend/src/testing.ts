// Test-only entry point: `@solvia/backend/testing` lets the frontend's tests run the real
// API in process (ADR-0005, D10). Excluded from the build, and forbidden outside tests by
// Biome, so it never reaches the browser bundle.

export { createTestApp } from "./http/test-fixtures.ts";
export { createTestDatabase, type TestDatabase } from "./infrastructure/database/test-fixtures.ts";
