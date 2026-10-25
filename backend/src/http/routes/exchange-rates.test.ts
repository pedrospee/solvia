import type { CreateExchangeRateRequest, ExchangeRateResponse } from "@solvia/contracts";
import { hc, type InferRequestType, type InferResponseType } from "hono/client";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
} from "../../infrastructure/database/test-fixtures.ts";
import { type AppType, createApp } from "../app.ts";

let database: TestDatabase;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  database = createTestDatabase();
  app = createApp({ db: database.db });
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

const eurBrl = { baseCurrency: "EUR", quoteCurrency: "BRL", effectiveDate: "2026-09-30" };

async function create(body: Record<string, unknown>) {
  const response = await send("POST", "/api/exchange-rates", { ...eurBrl, ...body });
  return (await response.json()) as ExchangeRateResponse;
}

async function errorCode(response: Response) {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

async function storedRates() {
  const response = await app.request("/api/exchange-rates");
  return ((await response.json()) as { items: ExchangeRateResponse[] }).items;
}

describe("POST /api/exchange-rates", () => {
  it("records a manual EUR/BRL rate in canonical form with 201", async () => {
    const response = await send("POST", "/api/exchange-rates", { ...eurBrl, rate: "6.20" });

    expect(response.status).toBe(201);
    const body = (await response.json()) as ExchangeRateResponse;
    expect(body).toMatchObject({
      baseCurrency: "EUR",
      quoteCurrency: "BRL",
      rate: "6.2",
      effectiveDate: "2026-09-30",
      source: "MANUAL",
    });
    expect(body.id).toEqual(expect.any(String));
    expect(Date.parse(body.recordedAt)).not.toBeNaN();
  });

  it("returns the extremes of the precision exactly, as strings", async () => {
    expect((await create({ rate: "0.0000000001" })).rate).toBe("0.0000000001");
    expect((await create({ rate: "10000000000" })).rate).toBe("10000000000");
  });

  it("maps each failure to its status and code, and records nothing", async () => {
    const cases: [Record<string, unknown>, number, string][] = [
      [{ baseCurrency: "BRL", quoteCurrency: "EUR", rate: "0.16" }, 422, "INVALID_EXCHANGE_RATE"],
      [{ quoteCurrency: "EUR", rate: "1" }, 422, "INVALID_EXCHANGE_RATE"],
      [{ rate: "0" }, 422, "INVALID_EXCHANGE_RATE"],
      [{ rate: "6.12345678901" }, 422, "INVALID_EXCHANGE_RATE"],
      [{ rate: "6.2", effectiveDate: "2026-02-30" }, 422, "INVALID_DATE"],
      [{ rate: 6.2 }, 400, "VALIDATION_FAILED"],
      [{ rate: "-6.2" }, 400, "VALIDATION_FAILED"],
      [{ rate: "6.2", quoteCurrency: "USD" }, 400, "VALIDATION_FAILED"],
      [{ rate: "6.2", source: "TRANSACTION" }, 400, "VALIDATION_FAILED"],
      [{ rate: "6.2", recordedAt: "2020-01-01T00:00:00.000Z" }, 400, "VALIDATION_FAILED"],
      [{ rate: "6.2", id: "chosen-by-client" }, 400, "VALIDATION_FAILED"],
    ];

    for (const [body, status, code] of cases) {
      const response = await send("POST", "/api/exchange-rates", { ...eurBrl, ...body });
      expect([response.status, await errorCode(response)], JSON.stringify(body)).toEqual([
        status,
        code,
      ]);
    }
    expect(await storedRates()).toEqual([]);
  });

  it("rejects a body that is not JSON instead of reading it as empty", async () => {
    const plainText = await app.request("/api/exchange-rates", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ ...eurBrl, rate: "6.2" }),
    });
    const malformed = await app.request("/api/exchange-rates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not json",
    });

    expect([plainText.status, await errorCode(plainText)]).toEqual([400, "INVALID_REQUEST"]);
    expect([malformed.status, await errorCode(malformed)]).toEqual([400, "INVALID_REQUEST"]);
    expect(await storedRates()).toEqual([]);
  });
});

describe("GET /api/exchange-rates", () => {
  it("lists the whole history, corrections included", async () => {
    await create({ rate: "6.20" });
    await create({ rate: "6.25" });
    await create({ rate: "6.10", effectiveDate: "2026-09-01" });

    expect((await storedRates()).map(({ rate }) => rate)).toEqual(["6.1", "6.2", "6.25"]);
  });

  it("rejects unknown query parameters", async () => {
    const response = await app.request("/api/exchange-rates?source=MANUAL");

    expect([response.status, await errorCode(response)]).toEqual([400, "VALIDATION_FAILED"]);
  });

  it("returns one rate, or 404 EXCHANGE_RATE_NOT_FOUND", async () => {
    const rate = await create({ rate: "6.2" });

    expect(await (await app.request(`/api/exchange-rates/${rate.id}`)).json()).toEqual(rate);
    const missing = await app.request("/api/exchange-rates/missing");
    expect([missing.status, await errorCode(missing)]).toEqual([404, "EXCHANGE_RATE_NOT_FOUND"]);
  });
});

describe("GET /api/exchange-rates/applicable", () => {
  it("returns the rate recorded last among those in force on the date", async () => {
    await create({ rate: "6.10", effectiveDate: "2026-09-01" });
    await create({ rate: "6.20" });
    const correction = await create({ rate: "6.25" });

    const response = await app.request("/api/exchange-rates/applicable?on=2026-10-15");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(correction);
    const older = await app.request("/api/exchange-rates/applicable?on=2026-09-15");
    expect(((await older.json()) as ExchangeRateResponse).rate).toBe("6.1");
  });

  it("maps a missing rate, a missing date and an impossible date", async () => {
    const none = await app.request("/api/exchange-rates/applicable?on=2026-09-30");
    const noDate = await app.request("/api/exchange-rates/applicable");
    const impossible = await app.request("/api/exchange-rates/applicable?on=2026-02-30");

    expect([none.status, await errorCode(none)]).toEqual([404, "EXCHANGE_RATE_NOT_FOUND"]);
    expect([noDate.status, await errorCode(noDate)]).toEqual([400, "VALIDATION_FAILED"]);
    expect([impossible.status, await errorCode(impossible)]).toEqual([422, "INVALID_DATE"]);
  });
});

describe("append-only (BR-81)", () => {
  it("has no PATCH and no DELETE: the rate stays as it was recorded", async () => {
    const rate = await create({ rate: "6.2" });

    const patch = await send("PATCH", `/api/exchange-rates/${rate.id}`, { rate: "9.99" });
    const remove = await send("DELETE", `/api/exchange-rates/${rate.id}`);

    expect([patch.status, await errorCode(patch)]).toEqual([404, "ROUTE_NOT_FOUND"]);
    expect([remove.status, await errorCode(remove)]).toEqual([404, "ROUTE_NOT_FOUND"]);
    expect(await storedRates()).toEqual([rate]);
  });
});

describe("AppType", () => {
  it("carries the exchange rate routes for hono/client", () => {
    const client = hc<AppType>("http://127.0.0.1");

    expectTypeOf<InferRequestType<(typeof client.api)["exchange-rates"]["$post"]>>().toEqualTypeOf<{
      json: CreateExchangeRateRequest;
    }>();
    expectTypeOf<
      InferResponseType<(typeof client.api)["exchange-rates"]["applicable"]["$get"], 200>
    >().toEqualTypeOf<ExchangeRateResponse>();
  });
});
