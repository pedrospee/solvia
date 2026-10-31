import { afterAll, describe, expect, it } from "vitest";
import { createTestApi, createUnreachableApi } from "../test-fixtures.tsx";
import { ApiRequestError, callApi, NETWORK_ERROR, UNEXPECTED_RESPONSE } from "./call-api.ts";
import { createApiClient } from "./client.ts";

const api = createTestApi();

afterAll(() => {
  api.close();
});

async function failureOf(request: Promise<unknown>): Promise<ApiRequestError> {
  const error = await request.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ApiRequestError);
  return error as ApiRequestError;
}

describe("callApi", () => {
  it("returns the typed JSON body of a successful answer", async () => {
    const health = await callApi(api.client.api.health.$get());

    expect(health).toEqual({ status: "ok" });
  });

  it("returns undefined for a 204", async () => {
    const account = await callApi(
      api.client.api.accounts.$post({ json: { name: "Demo Bank", kind: "BANK", currency: "EUR" } }),
    );

    const deleted = await callApi(
      api.client.api.accounts[":id"].$delete({ param: { id: account.id } }),
    );

    expect(deleted).toBeUndefined();
  });

  it("throws the API's status, code and message", async () => {
    const error = await failureOf(
      callApi(api.client.api.accounts[":id"].$get({ param: { id: "no-such-account" } })),
    );

    expect(error).toMatchObject({ status: 404, code: "ACCOUNT_NOT_FOUND" });
    expect(error.message).not.toBe("");
  });

  it("keeps the details of a contract violation", async () => {
    const error = await failureOf(
      callApi(
        api.client.api.accounts.$post({
          // Deliberately outside the contract, which the types would otherwise prevent.
          json: { name: "Demo Bank", kind: "BANK", currency: "USD" as "EUR" },
        }),
      ),
    );

    expect(error).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
    expect(error.details).toHaveProperty("issues");
  });

  it("passes a financial rule's code through unchanged", async () => {
    // An empty name fits the contract; refusing it is a rule of @solvia/core (422).
    const error = await failureOf(
      callApi(api.client.api.accounts.$post({ json: { name: "", kind: "BANK", currency: "EUR" } })),
    );

    expect(error).toMatchObject({ status: 422, code: "INVALID_ACCOUNT" });
  });

  it("reports NETWORK_ERROR, status 0, when no answer arrives", async () => {
    const error = await failureOf(callApi(createUnreachableApi().api.health.$get()));

    expect(error).toMatchObject({ status: 0, code: NETWORK_ERROR });
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  it("reports UNEXPECTED_RESPONSE for an answer without the API's error shape", async () => {
    // What the Vite proxy answers while the API is stopped.
    const proxy = createApiClient(
      "http://localhost",
      async () => new Response("", { status: 502 }),
    );

    const error = await failureOf(callApi(proxy.api.health.$get()));

    expect(error).toMatchObject({ status: 502, code: UNEXPECTED_RESPONSE });
  });
});
