import type { CategoryResponse, CreateCategoryRequest } from "@solvia/contracts";
import { hc, type InferRequestType, type InferResponseType } from "hono/client";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
} from "../../infrastructure/database/test-fixtures.ts";
import type { AppType, createApp } from "../app.ts";
import { createTestApp } from "../test-fixtures.ts";

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

async function create(body: Record<string, unknown>) {
  const response = await send("POST", "/api/categories", body);
  return (await response.json()) as CategoryResponse;
}

async function errorCode(response: Response) {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

describe("POST /api/categories", () => {
  it("creates a parent and a child with 201", async () => {
    const food = await create({ name: "Food", nature: "EXPENSE" });
    const response = await send("POST", "/api/categories", {
      name: "Groceries",
      nature: "EXPENSE",
      parentId: food.id,
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      name: "Groceries",
      nature: "EXPENSE",
      parentId: food.id,
      archivedAt: null,
    });
  });

  it("maps each failure to its status and code", async () => {
    const food = await create({ name: "Food", nature: "EXPENSE" });

    const invalid = await send("POST", "/api/categories", { name: "X", nature: "SAVING" });
    expect([invalid.status, await errorCode(invalid)]).toEqual([400, "VALIDATION_FAILED"]);

    const missing = await send("POST", "/api/categories", {
      name: "X",
      nature: "EXPENSE",
      parentId: "missing",
    });
    expect([missing.status, await errorCode(missing)]).toEqual([404, "CATEGORY_NOT_FOUND"]);

    const otherNature = await send("POST", "/api/categories", {
      name: "Bonus",
      nature: "INCOME",
      parentId: food.id,
    });
    expect([otherNature.status, await errorCode(otherNature)]).toEqual([422, "INVALID_CATEGORY"]);
  });
});

describe("GET /api/categories", () => {
  it("lists active categories as a flat list, and archived ones only when asked", async () => {
    await create({ name: "Food", nature: "EXPENSE" });
    const old = await create({ name: "Old", nature: "EXPENSE" });
    await send("POST", `/api/categories/${old.id}/archive`);

    const names = async (path: string) =>
      ((await (await app.request(path)).json()) as { items: CategoryResponse[] }).items
        .map(({ name }) => name)
        .sort();

    expect(await names("/api/categories")).toEqual(["Food"]);
    expect(await names("/api/categories?includeArchived=true")).toEqual(["Food", "Old"]);
  });

  it("returns 404 CATEGORY_NOT_FOUND for an unknown id", async () => {
    const response = await app.request("/api/categories/missing");

    expect([response.status, await errorCode(response)]).toEqual([404, "CATEGORY_NOT_FOUND"]);
  });
});

describe("PATCH /api/categories/:id", () => {
  it("renames and moves a category to the top level", async () => {
    const food = await create({ name: "Food", nature: "EXPENSE" });
    const child = await create({ name: "Groceries", nature: "EXPENSE", parentId: food.id });

    const response = await send("PATCH", `/api/categories/${child.id}`, {
      name: "Supermarket",
      parentId: null,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: "Supermarket", parentId: null });
  });

  it("rejects a change of nature explicitly with 400", async () => {
    const food = await create({ name: "Food", nature: "EXPENSE" });

    const response = await send("PATCH", `/api/categories/${food.id}`, { nature: "INCOME" });

    expect([response.status, await errorCode(response)]).toEqual([400, "VALIDATION_FAILED"]);
  });

  it("rejects a body without a JSON Content-Type instead of ignoring it", async () => {
    const food = await create({ name: "Food", nature: "EXPENSE" });

    const response = await app.request(`/api/categories/${food.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed" }),
    });

    expect([response.status, await errorCode(response)]).toEqual([400, "INVALID_REQUEST"]);
    expect(await (await app.request(`/api/categories/${food.id}`)).json()).toMatchObject({
      name: "Food",
    });
  });

  it("rejects making a parent a child with 422 INVALID_CATEGORY", async () => {
    const food = await create({ name: "Food", nature: "EXPENSE" });
    await create({ name: "Groceries", nature: "EXPENSE", parentId: food.id });
    const housing = await create({ name: "Housing", nature: "EXPENSE" });

    const response = await send("PATCH", `/api/categories/${food.id}`, { parentId: housing.id });

    expect([response.status, await errorCode(response)]).toEqual([422, "INVALID_CATEGORY"]);
  });
});

describe("archiving and deleting", () => {
  it("returns 409 for a parent with active children, and archives otherwise", async () => {
    const food = await create({ name: "Food", nature: "EXPENSE" });
    const child = await create({ name: "Groceries", nature: "EXPENSE", parentId: food.id });

    const blocked = await send("POST", `/api/categories/${food.id}/archive`);
    expect([blocked.status, await errorCode(blocked)]).toEqual([
      409,
      "CATEGORY_HAS_ACTIVE_CHILDREN",
    ]);

    expect((await send("POST", `/api/categories/${child.id}/archive`)).status).toBe(200);
    expect((await send("POST", `/api/categories/${food.id}/archive`)).status).toBe(200);
    const unarchiveChild = await send("POST", `/api/categories/${child.id}/unarchive`);
    expect([unarchiveChild.status, await errorCode(unarchiveChild)]).toEqual([
      409,
      "CATEGORY_PARENT_ARCHIVED",
    ]);
  });

  it("returns 409 CATEGORY_HAS_CHILDREN for a parent, and 204 for a leaf", async () => {
    const food = await create({ name: "Food", nature: "EXPENSE" });
    const child = await create({ name: "Groceries", nature: "EXPENSE", parentId: food.id });

    const blocked = await send("DELETE", `/api/categories/${food.id}`);
    expect([blocked.status, await errorCode(blocked)]).toEqual([409, "CATEGORY_HAS_CHILDREN"]);

    expect((await send("DELETE", `/api/categories/${child.id}`)).status).toBe(204);
    expect((await send("DELETE", `/api/categories/${food.id}`)).status).toBe(204);
  });
});

describe("AppType", () => {
  it("carries the category routes for hono/client", () => {
    const client = hc<AppType>("http://127.0.0.1");

    expectTypeOf<InferRequestType<typeof client.api.categories.$post>>().toEqualTypeOf<{
      json: CreateCategoryRequest;
    }>();
    expectTypeOf<
      InferResponseType<(typeof client.api.categories)[":id"]["$get"], 200>
    >().toEqualTypeOf<CategoryResponse>();
  });
});
