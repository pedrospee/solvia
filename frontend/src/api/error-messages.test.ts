import { describe, expect, it } from "vitest";
import { ApiRequestError, NETWORK_ERROR } from "./call-api.ts";
import { errorMessage } from "./error-messages.ts";

describe("errorMessage", () => {
  it("chooses the message by code, never showing the API's own text", () => {
    const error = new ApiRequestError(409, "ACCOUNT_IN_USE", "The account has transactions.");

    expect(errorMessage(error)).toMatch(/^Esta conta tem transações/);
    expect(errorMessage(new ApiRequestError(0, NETWORK_ERROR, "fetch failed"))).toMatch(
      /^Não foi possível conectar à API/,
    );
  });

  it("names an unknown code instead of guessing", () => {
    expect(errorMessage(new ApiRequestError(409, "SOMETHING_NEW", "…"))).toBe(
      "Algo deu errado (SOMETHING_NEW).",
    );
    expect(errorMessage(new Error("boom"))).toBe("Algo deu errado.");
  });
});
