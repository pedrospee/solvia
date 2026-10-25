import type { AccountResponse, CreateAccountRequest } from "@solvia/contracts";
import { hc, type InferRequestType, type InferResponseType } from "hono/client";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
} from "../../infrastructure/database/test-fixtures.ts";
import type { AppType, createApp } from "../app.ts";
import { createTestApp } from "../test-fixtures.ts";

const ABOVE_MAX_SAFE_INTEGER = "90071992547409930";

let database: TestDatabase;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  database = createTestDatabase();
  app = createTestApp(database.db);
});

afterEach(() => {
  database.sqlite.close();
});

function send(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}

async function createAccount(body: Record<string, unknown> = {}) {
  const response = await send("POST", "/api/accounts", {
    name: "Demo Bank",
    kind: "BANK",
    currency: "EUR",
    ...body,
  });
  return (await response.json()) as { id: string };
}

describe("POST /api/accounts", () => {
  it("creates an account and returns it with 201", async () => {
    const response = await send("POST", "/api/accounts", {
      name: "Demo Bank",
      institution: "Example Bank",
      kind: "BANK",
      currency: "EUR",
      overdraftLimit: { amountMinor: ABOVE_MAX_SAFE_INTEGER, currency: "EUR" },
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { createdAt: string };
    expect(body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: "Demo Bank",
      institution: "Example Bank",
      kind: "BANK",
      currency: "EUR",
      overdraftLimit: { amountMinor: ABOVE_MAX_SAFE_INTEGER, currency: "EUR" },
      archivedAt: null,
      createdAt: expect.any(String),
      updatedAt: body.createdAt,
    });
  });

  it("rejects a request that breaks the contract with 400 VALIDATION_FAILED", async () => {
    const response = await send("POST", "/api/accounts", { name: "Demo", kind: "SAVINGS" });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("rejects an overdraft limit on a non-BANK account with the core's 422 INVALID_ACCOUNT", async () => {
    const response = await send("POST", "/api/accounts", {
      name: "Demo Cash",
      kind: "CASH",
      currency: "EUR",
      overdraftLimit: { amountMinor: "50000", currency: "EUR" },
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_ACCOUNT" } });
  });
});

describe("GET /api/accounts", () => {
  it("lists active accounts, and archived ones only with includeArchived=true", async () => {
    const active = await createAccount({ name: "Active" });
    const archived = await createAccount({ name: "Archived" });
    await send("POST", `/api/accounts/${archived.id}/archive`);

    const names = async (path: string) =>
      ((await (await app.request(path)).json()) as { items: { name: string }[] }).items.map(
        ({ name }) => name,
      );

    expect(await names("/api/accounts")).toEqual(["Active"]);
    // Order is covered by the repository test, where the creation times are controlled.
    expect((await names("/api/accounts?includeArchived=true")).sort()).toEqual([
      "Active",
      "Archived",
    ]);
    expect(active.id).not.toBe(archived.id);
  });

  it("returns one account, or 404 ACCOUNT_NOT_FOUND", async () => {
    const { id } = await createAccount();

    expect((await app.request(`/api/accounts/${id}`)).status).toBe(200);
    const missing = await app.request("/api/accounts/missing");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "ACCOUNT_NOT_FOUND" } });
  });
});

describe("PATCH /api/accounts/:id", () => {
  it("updates editable fields", async () => {
    const { id } = await createAccount({ institution: "Example Bank" });

    const response = await send("PATCH", `/api/accounts/${id}`, {
      name: "Renamed",
      institution: null,
      overdraftLimit: { amountMinor: "20000", currency: "EUR" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      name: "Renamed",
      institution: null,
      overdraftLimit: { amountMinor: "20000", currency: "EUR" },
    });
  });

  it("rejects changes to kind or currency explicitly with 400", async () => {
    const { id } = await createAccount();

    for (const change of [{ kind: "CASH" }, { currency: "BRL" }]) {
      const response = await send("PATCH", `/api/accounts/${id}`, change);

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
    }
    expect(await (await app.request(`/api/accounts/${id}`)).json()).toMatchObject({
      kind: "BANK",
      currency: "EUR",
    });
  });

  it("rejects a body without a JSON Content-Type instead of ignoring it", async () => {
    const { id } = await createAccount();

    const response = await app.request(`/api/accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(await (await app.request(`/api/accounts/${id}`)).json()).toMatchObject({
      name: "Demo Bank",
    });
  });
});

describe("archiving", () => {
  it("archives and unarchives an account", async () => {
    const { id } = await createAccount();

    const archived = await send("POST", `/api/accounts/${id}/archive`);
    expect(archived.status).toBe(200);
    expect(await archived.json()).toMatchObject({ archivedAt: expect.any(String) });

    const restored = await send("POST", `/api/accounts/${id}/unarchive`);
    expect(await restored.json()).toMatchObject({ archivedAt: null });
  });
});

describe("DELETE /api/accounts/:id", () => {
  it("deletes an account with 204, then reports it as not found", async () => {
    const { id } = await createAccount();

    const response = await send("DELETE", `/api/accounts/${id}`);

    expect(response.status).toBe(204);
    expect((await send("DELETE", `/api/accounts/${id}`)).status).toBe(404);
  });
});

describe("AppType", () => {
  it("carries the account routes for hono/client", () => {
    const client = hc<AppType>("http://127.0.0.1");

    expectTypeOf<InferRequestType<typeof client.api.accounts.$post>>().toEqualTypeOf<{
      json: CreateAccountRequest;
    }>();
    expectTypeOf<
      InferResponseType<(typeof client.api.accounts)[":id"]["$get"], 200>
    >().toEqualTypeOf<AccountResponse>();
  });
});
