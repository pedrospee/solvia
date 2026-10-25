import type { TransactionResponse } from "@solvia/contracts";
import { hc, type InferRequestType } from "hono/client";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
} from "../../infrastructure/database/test-fixtures.ts";
import { type AppType, createApp } from "../app.ts";

let database: TestDatabase;
let app: ReturnType<typeof createApp>;
let ids: Record<"bank" | "wiseEur" | "wiseBrl" | "card" | "salary" | "food" | "fees", string>;

function send(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}

async function created(path: string, body: unknown): Promise<string> {
  const response = await send("POST", path, body);
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function errorOf(response: Response) {
  const { error } = (await response.json()) as { error: { code: string } };
  return [response.status, error.code];
}

const eur = (amountMinor: string) => ({ amountMinor, currency: "EUR" });
const brl = (amountMinor: string) => ({ amountMinor, currency: "BRL" });
const details = { date: "2026-09-15", description: "Fictitious" };

beforeEach(async () => {
  database = createTestDatabase();
  app = createApp({ db: database.db });
  ids = {
    bank: await created("/api/accounts", {
      name: "Demo Bank",
      kind: "BANK",
      currency: "EUR",
      overdraftLimit: eur("50000"),
    }),
    wiseEur: await created("/api/accounts", { name: "Wise EUR", kind: "WISE", currency: "EUR" }),
    wiseBrl: await created("/api/accounts", { name: "Wise BRL", kind: "WISE", currency: "BRL" }),
    card: await created("/api/accounts", { name: "Card", kind: "CREDIT_CARD", currency: "EUR" }),
    salary: await created("/api/categories", { name: "Salary", nature: "INCOME" }),
    food: await created("/api/categories", { name: "Food", nature: "EXPENSE" }),
    fees: await created("/api/categories", { name: "Fees", nature: "EXPENSE" }),
  };
});

afterEach(() => {
  database.sqlite.close();
  vi.restoreAllMocks();
});

function expense(amountMinor = "4590") {
  return {
    type: "EXPENSE",
    ...details,
    paidFromAccountId: ids.bank,
    categoryId: ids.food,
    amount: eur(amountMinor),
  };
}

function conversion(receivedMinor = "62000") {
  return {
    type: "CONVERSION",
    ...details,
    fromAccountId: ids.wiseEur,
    toAccountId: ids.wiseBrl,
    sentAmount: eur("10000"),
    receivedAmount: brl(receivedMinor),
    fee: { categoryId: ids.fees, amount: eur("100") },
  };
}

async function postTransaction(body: unknown): Promise<TransactionResponse> {
  const response = await send("POST", "/api/transactions", body);
  expect(response.status).toBe(201);
  return (await response.json()) as TransactionResponse;
}

describe("POST /api/transactions", () => {
  it("creates an operation and returns it with its postings, amounts as strings", async () => {
    const body = await postTransaction(expense());

    expect(body).toEqual({
      id: expect.any(String),
      type: "EXPENSE",
      date: "2026-09-15",
      description: "Fictitious",
      postings: [
        { target: { kind: "CATEGORY", categoryId: ids.food }, amount: eur("4590") },
        { target: { kind: "ACCOUNT", accountId: ids.bank }, amount: eur("-4590") },
      ],
      exchangeRate: null,
      voidedAt: null,
      createdAt: expect.any(String),
      updatedAt: body.createdAt,
    });
  });

  it("derives the rate of a two-currency operation, recorded at updatedAt", async () => {
    const body = await postTransaction(conversion());

    expect(body.exchangeRate).toEqual({
      baseCurrency: "EUR",
      quoteCurrency: "BRL",
      rate: "6.2",
      effectiveDate: "2026-09-15",
      source: "TRANSACTION",
      recordedAt: body.updatedAt,
    });
  });

  it("maps each failure to its status and code", async () => {
    const cases: [unknown, [number, string]][] = [
      [{ ...expense(), postings: [] }, [400, "VALIDATION_FAILED"]],
      [{ ...expense(), amount: eur("45.90") }, [400, "VALIDATION_FAILED"]],
      [{ ...expense(), paidFromAccountId: "missing" }, [404, "ACCOUNT_NOT_FOUND"]],
      [{ ...expense(), categoryId: "missing" }, [404, "CATEGORY_NOT_FOUND"]],
      [{ ...expense(), categoryId: ids.salary }, [422, "INVALID_TRANSACTION"]],
      [{ ...expense(), amount: eur("-100") }, [422, "INVALID_AMOUNT"]],
      [{ ...expense(), date: "2026-02-30" }, [422, "INVALID_DATE"]],
      [{ ...expense(), chargedAmount: eur("9900") }, [422, "INVALID_TRANSACTION"]],
    ];

    for (const [body, expected] of cases) {
      expect(await errorOf(await send("POST", "/api/transactions", body))).toEqual(expected);
    }
    const list = await (await app.request("/api/transactions?includeVoided=true")).json();
    expect(list).toEqual({ items: [] });
  });

  it("rejects a new reference to an archived account with 409", async () => {
    await send("POST", `/api/accounts/${ids.bank}/archive`);

    expect(await errorOf(await send("POST", "/api/transactions", expense()))).toEqual([
      409,
      "ACCOUNT_ARCHIVED",
    ]);
  });
});

describe("GET /api/transactions", () => {
  it("lists effective transactions, and voided ones only with includeVoided=true", async () => {
    const kept = await postTransaction(expense("100"));
    const voided = await postTransaction(expense("200"));
    await send("POST", `/api/transactions/${voided.id}/void`);

    const effective = await (await app.request("/api/transactions")).json();
    const all = (await (await app.request("/api/transactions?includeVoided=true")).json()) as {
      items: TransactionResponse[];
    };

    expect(effective).toEqual({ items: [kept] });
    expect(all.items.map(({ id }) => id)).toEqual([kept.id, voided.id]);
    expect(await errorOf(await app.request("/api/transactions/missing"))).toEqual([
      404,
      "TRANSACTION_NOT_FOUND",
    ]);
  });
});

describe("PUT /api/transactions/:id", () => {
  it("replaces the operation and recalculates the rate", async () => {
    const original = await postTransaction(conversion());

    const response = await send("PUT", `/api/transactions/${original.id}`, conversion("61000"));
    const body = (await response.json()) as TransactionResponse;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ id: original.id, createdAt: original.createdAt });
    expect(body.exchangeRate).toMatchObject({ rate: "6.1", recordedAt: body.updatedAt });
  });

  it("returns 409 for a change of type or an edit of a voided transaction", async () => {
    const { id } = await postTransaction(expense());
    const income = {
      type: "INCOME",
      ...details,
      accountId: ids.bank,
      categoryId: ids.salary,
      amount: eur("100"),
    };

    expect(await errorOf(await send("PUT", `/api/transactions/${id}`, income))).toEqual([
      409,
      "TRANSACTION_TYPE_IMMUTABLE",
    ]);
    await send("POST", `/api/transactions/${id}/void`);
    expect(await errorOf(await send("PUT", `/api/transactions/${id}`, expense()))).toEqual([
      409,
      "TRANSACTION_VOIDED",
    ]);
  });

  it("rejects a partial body: an edit is a full replacement", async () => {
    const { id } = await postTransaction(expense());

    const response = await send("PUT", `/api/transactions/${id}`, { amount: eur("100") });

    expect(await errorOf(response)).toEqual([400, "VALIDATION_FAILED"]);
  });
});

describe("POST /api/transactions/:id/void", () => {
  it("voids once, keeps updatedAt, and answers the same on a second void", async () => {
    const original = await postTransaction(expense());

    const first = (await (
      await send("POST", `/api/transactions/${original.id}/void`)
    ).json()) as TransactionResponse;
    const second = await send("POST", `/api/transactions/${original.id}/void`);

    expect(first).toEqual({ ...original, voidedAt: expect.any(String) });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(first);
  });

  it("offers no DELETE: a transaction is never physically deleted", async () => {
    const { id } = await postTransaction(expense());

    expect(await errorOf(await send("DELETE", `/api/transactions/${id}`))).toEqual([
      404,
      "ROUTE_NOT_FOUND",
    ]);
    expect((await app.request(`/api/transactions/${id}`)).status).toBe(200);
  });
});

describe("GET /api/accounts/:id/balance", () => {
  it("derives balance and overdraft from the effective ledger", async () => {
    await postTransaction({
      type: "OPENING_BALANCE",
      ...details,
      accountId: ids.bank,
      balance: eur("10000"),
    });
    await postTransaction(expense("30000"));
    const mistake = await postTransaction(expense("99900"));
    await send("POST", `/api/transactions/${mistake.id}/void`);

    const response = await app.request(`/api/accounts/${ids.bank}/balance`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accountId: ids.bank,
      balance: eur("-20000"),
      overdraft: {
        limit: eur("50000"),
        used: eur("20000"),
        remaining: eur("30000"),
        exceeded: eur("0"),
        availableIncludingOverdraft: eur("30000"),
      },
    });
    const card = await (await app.request(`/api/accounts/${ids.card}/balance`)).json();
    expect(card).toEqual({ accountId: ids.card, balance: eur("0"), overdraft: null });
  });
});

describe("accounts and categories in use", () => {
  it("returns 409 *_IN_USE on delete, voided transactions included", async () => {
    const { id } = await postTransaction(expense());
    await send("POST", `/api/transactions/${id}/void`);

    expect(await errorOf(await send("DELETE", `/api/accounts/${ids.bank}`))).toEqual([
      409,
      "ACCOUNT_IN_USE",
    ]);
    expect(await errorOf(await send("DELETE", `/api/categories/${ids.food}`))).toEqual([
      409,
      "CATEGORY_IN_USE",
    ]);
  });

  it("returns a generic 500, never a 409, when a foreign key violation reaches the handler", async () => {
    // A missing service check is simulated by a trigger that deletes a referenced account.
    const { id } = await postTransaction(expense());
    database.sqlite.exec(
      `CREATE TEMP TRIGGER sabotage AFTER UPDATE ON transactions BEGIN DELETE FROM accounts WHERE id = '${ids.bank}'; END`,
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await send("PUT", `/api/transactions/${id}`, expense("100"));

    expect(response.status).toBe(500);
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/FOREIGN KEY constraint failed/) }),
    );
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
    });
    expect(
      (await (await app.request(`/api/transactions/${id}`)).json()) as TransactionResponse,
    ).toMatchObject({ postings: [{ amount: eur("4590") }, { amount: eur("-4590") }] });
  });
});

describe("AppType", () => {
  it("carries the transaction routes for hono/client", () => {
    const client = hc<AppType>("http://localhost");

    expectTypeOf<
      InferRequestType<(typeof client.api.transactions)[":id"]["void"]["$post"]>
    >().toEqualTypeOf<{ param: { id: string } }>();
    expectTypeOf<
      InferRequestType<typeof client.api.transactions.$post>["json"]["type"]
    >().toEqualTypeOf<
      "OPENING_BALANCE" | "INCOME" | "EXPENSE" | "TRANSFER" | "CARD_PAYMENT" | "CONVERSION"
    >();
  });
});
