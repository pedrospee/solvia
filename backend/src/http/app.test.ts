import { afterAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "../infrastructure/database/test-fixtures.ts";
import { createApp } from "./app.ts";
import { createTestApp } from "./test-fixtures.ts";

const database = createTestDatabase();
const app = createTestApp(database.db);

afterAll(() => {
  database.sqlite.close();
});

describe("GET /api/health", () => {
  it("reports that the API is up", async () => {
    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});

describe("unknown routes", () => {
  it("return 404 with the standard error shape", async () => {
    const response = await app.request("/api/nothing-here");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "ROUTE_NOT_FOUND", message: "No route for GET /api/nothing-here." },
    });
  });
});
