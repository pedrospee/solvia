import { afterAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "../infrastructure/database/test-fixtures.ts";
import { MAX_BODY_SIZE } from "./app.ts";
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

describe("request body size", () => {
  const oversized = JSON.stringify({ name: "x".repeat(MAX_BODY_SIZE) });

  it("rejects a body whose Content-Length is over the limit", async () => {
    const response = await app.request("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": String(oversized.length) },
      body: oversized,
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: { code: "PAYLOAD_TOO_LARGE", message: "The request body is too large." },
    });
  });

  it("rejects an oversized body sent without a Content-Length", async () => {
    const response = await app.request("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: oversized,
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
  });

  it("lets a body within the limit reach validation", async () => {
    const response = await app.request("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x".repeat(MAX_BODY_SIZE - 100) }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });
});
